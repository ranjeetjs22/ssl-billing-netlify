import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Download, Calendar, Loader2, Columns3 } from 'lucide-react';
import { apiRequest, API_BASE, getToken } from '../services/api.js';
import { formatINR } from '../utils/format.js';
import { useAuth } from '../context/AuthContext.js';
import { Button, Card, Input, EmptyState, ErrorState, Toast, StatusBadge, cx } from './ui.js';

/* ------------------------------------------------------------------ types */
interface Summary {
  range: { from: string; to: string; label: string };
  invoice_count: number;
  gst_invoice_count?: number;
  non_gst_invoice_count?: number;
  revenue?: number;
  taxable: number;
  gst_taxable_sales?: number;
  non_gst_sales?: number;
  gst_total: number;
  cgst: number; sgst: number; igst: number;
  grand_total: number;
  received: number;
  outstanding: number;
  overdue_count?: number;
  gross_profit?: number;
  margin_pct?: number | null;
  input_gst?: number;
  gst_payable?: number;
  costed_count?: number;
  uncosted_count?: number;
  b2b_count: number;
  b2c_count: number;
}

type Kind = 'text' | 'money' | 'num' | 'date' | 'pct' | 'status' | 'mono';
interface Col { key: string; label: string; kind?: Kind }
interface Section { id: string; title: string; note?: string; columns: Col[]; rows: Record<string, any>[]; total?: Record<string, any> }
interface Report { key: string; title: string; sections: Section[]; footnotes?: string[] }

type Preset = 'this_month' | 'last_month' | 'last_3_months' | 'this_fy' | 'last_fy' | 'custom';
const PRESETS: { key: Preset; label: string }[] = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'last_3_months', label: '3 months' },
  { key: 'this_fy', label: 'This FY' },
  { key: 'last_fy', label: 'Last FY' },
  { key: 'custom', label: 'Custom' },
];

const REPORTS: { key: string; label: string; hint: string; module?: string }[] = [
  { key: 'invoices', label: 'Sales', hint: 'Every bill, GST and non-GST, with tax split, paid, balance and profit' },
  { key: 'gst', label: 'GST (GSTR-1)', hint: 'GST tax invoices only: B2B, B2C and rate-wise summary. Non-GST bills never appear here.' },
  { key: 'payments', label: 'Payments', hint: 'Receipts dated in the period and the bill each belongs to', module: 'payments' },
  { key: 'outstanding', label: 'Outstanding', hint: 'Unpaid bills from the period, most overdue first' },
  { key: 'profit', label: 'Profit', hint: 'One row per LR with vendor, cost and margin' },
];

/**
 * Columns shown when "compact" is on. Everything else is one click away and is
 * always in the CSV. Keys not listed for a section show in full.
 */
const COMPACT: Record<string, string[]> = {
  sales: ['type', 'no', 'date', 'customer', 'lr', 'taxable', 'cgst', 'sgst', 'igst', 'total', 'balance', 'status', 'profit'],
  profit: ['type', 'no', 'customer', 'lr', 'vendor', 'lr_freight', 'lr_cost', 'revenue', 'cost', 'profit', 'margin'],
  payments: ['date', 'customer', 'no', 'amount', 'method', 'ref'],
  outstanding: ['customer', 'phone', 'no', 'date', 'days', 'value', 'paid', 'balance', 'status'],
  b2b: ['gstin', 'name', 'no', 'date', 'value', 'pos', 'rate', 'taxable', 'cgst', 'sgst', 'igst'],
};

/* ------------------------------------------------------------------ cells */
const isNum = (v: any) => typeof v === 'number' && Number.isFinite(v);

function Cell({ v, kind }: { v: any; kind?: Kind }) {
  if (v === '' || v === null || v === undefined) return <span className="text-ink-faint">-</span>;
  if (kind === 'status') return <StatusBadge status={String(v)} />;
  if (kind === 'money' && isNum(v)) {
    return <span className={cx('font-mono', v < 0 && 'text-danger-ink')}>{formatINR(v)}</span>;
  }
  if (kind === 'pct' && isNum(v)) return <span className="font-mono">{v}%</span>;
  if (kind === 'num' && isNum(v)) return <span className="font-mono">{v}</span>;
  if (kind === 'mono') return <span className="font-mono">{String(v)}</span>;
  if (v === 'Non-GST') return <span className="text-[10px] font-semibold border border-line rounded-[3px] px-1 py-px text-ink-soft">NON-GST</span>;
  if (v === 'GST') return <span className="text-[10px] font-semibold text-ink-faint">GST</span>;
  if (v === 'Not costed') return <span className="text-ink-faint">Not costed</span>;
  return <>{String(v)}</>;
}

const right = (k?: Kind) => k === 'money' || k === 'num' || k === 'pct';

/** One report section as a dense table with a sticky header and a total row. */
const SectionTable: React.FC<{ sec: Section; compact: boolean; multi: boolean }> = ({ sec, compact, multi }) => {
  const cols = compact && COMPACT[sec.id] ? sec.columns.filter(c => COMPACT[sec.id].includes(c.key)) : sec.columns;
  return (
    <div className="min-w-0">
      {multi && (
        <div className="flex items-baseline justify-between gap-2 px-3 pt-3 pb-1.5">
          <h3 className="text-[12.5px] font-bold text-ink">{sec.title}</h3>
          <span className="text-[11px] text-ink-faint">{sec.rows.length} row{sec.rows.length === 1 ? '' : 's'}{sec.note ? ` · ${sec.note}` : ''}</span>
        </div>
      )}
      {sec.rows.length === 0 ? (
        <p className="px-3 py-5 text-[12px] text-ink-faint text-center border-t border-line">Nothing in this period.</p>
      ) : (
        <div className="overflow-auto max-h-[62vh] border-t border-line">
          <table className="w-full text-[12px] border-collapse">
            <thead className="sticky top-0 z-[1]">
              <tr className="sheet">
                {cols.map(c => (
                  <th key={c.key} scope="col"
                    className={cx('px-2.5 py-2 font-medium text-[10.5px] uppercase tracking-[0.04em] text-ink-faint whitespace-nowrap border-b border-line',
                      right(c.kind) ? 'text-right' : 'text-left')}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sec.rows.map((row, i) => (
                <tr key={i} className="border-b border-line/70 hover:bg-surface-muted transition-colors">
                  {cols.map(c => (
                    <td key={c.key} className={cx('px-2.5 py-1.5 whitespace-nowrap text-ink-soft',
                      right(c.kind) && 'text-right', c.key === 'customer' || c.key === 'name' ? 'max-w-[220px] truncate text-ink' : '')}>
                      <Cell v={row[c.key]} kind={c.kind} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {sec.total && (
              <tfoot className="sticky bottom-0">
                <tr className="sheet font-semibold text-ink">
                  {cols.map(c => (
                    <td key={c.key} className={cx('px-2.5 py-2 whitespace-nowrap border-t border-line-strong', right(c.kind) && 'text-right')}>
                      {sec.total![c.key] === undefined ? '' : <Cell v={sec.total![c.key]} kind={isNum(sec.total![c.key]) ? c.kind : 'text'} />}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ tiles */
const Tile: React.FC<{ label: string; value: string; sub?: string; tone?: string; loading?: boolean }> = ({ label, value, sub, tone, loading }) => (
  <div className="px-3 py-2.5 min-w-0">
    <div className="text-[10.5px] uppercase tracking-[0.06em] text-ink-faint font-medium truncate">{label}</div>
    {loading ? <div className="skeleton h-5 w-20 mt-1" /> :
      <div className={cx('numeral text-[1.02rem] leading-tight mt-0.5 truncate', tone || 'text-ink')}>{value}</div>}
    {sub && !loading && <div className="text-[10.5px] text-ink-faint truncate">{sub}</div>}
  </div>
);

/* ------------------------------------------------------------------ page */
export const Reports: React.FC = () => {
  const { user } = useAuth();
  const can = (mod?: string) => !mod || user?.role === 'admin' || !!user?.modules?.includes(mod);
  const available = REPORTS.filter(r => can(r.module));

  const [preset, setPreset] = useState<Preset>('this_month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [active, setActive] = useState(available[0]?.key || 'invoices');
  const [compact, setCompact] = useState(true);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingReport, setLoadingReport] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const needsDates = preset === 'custom' && (!from || !to);

  const rangeQuery = useCallback(() => {
    if (preset === 'custom') {
      const p = new URLSearchParams();
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      return p.toString();
    }
    return `preset=${preset}`;
  }, [preset, from, to]);

  useEffect(() => {
    if (needsDates) { setSummary(null); setLoadingSummary(false); return; }
    let alive = true;
    const t = setTimeout(async () => {
      setLoadingSummary(true);
      try {
        const s = await apiRequest<Summary>(`/reports/summary?${rangeQuery()}`);
        if (alive) setSummary(s);
      } catch (e: any) {
        if (alive) setError(e.message || 'Could not load the summary');
      } finally {
        if (alive) setLoadingSummary(false);
      }
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [rangeQuery, needsDates]);

  const loadReport = useCallback(async () => {
    if (needsDates) { setReport(null); setLoadingReport(false); return; }
    setLoadingReport(true);
    setError(null);
    try {
      setReport(await apiRequest<Report>(`/reports/${active}?format=json&${rangeQuery()}`));
    } catch (e: any) {
      setError(e.message || 'Could not load the report');
      setReport(null);
    } finally {
      setLoadingReport(false);
    }
  }, [active, rangeQuery, needsDates]);

  useEffect(() => {
    const t = setTimeout(loadReport, 200);
    return () => clearTimeout(t);
  }, [loadReport]);

  /** The CSV endpoints need the bearer token, so fetch the blob ourselves. */
  const download = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`${API_BASE}/reports/${active}?${rangeQuery()}`, {
        headers: { Authorization: `Bearer ${getToken()}` }, cache: 'no-store',
      });
      if (!res.ok) {
        let detail = `Download failed (${res.status})`;
        try { detail = (await res.json()).detail || detail; } catch { /* not json */ }
        throw new Error(detail);
      }
      const blob = await res.blob();
      const name = /filename=([^;]+)/.exec(res.headers.get('content-disposition') || '')?.[1]?.trim() || `${active}-report.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setToast(`${name} downloaded.`);
    } catch (e: any) {
      setToast(e.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const meta = available.find(r => r.key === active);
  const hasCompactView = useMemo(() => !!report?.sections.some(s => COMPACT[s.id]), [report]);
  const s = summary;

  return (
    <div className="space-y-3">
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

      {/* ------------------------------------------ period */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Report period"
          className="flex items-center gap-0.5 p-0.5 rounded-control bg-surface-sunken border border-line overflow-x-auto scrollbar-none max-w-full">
          {PRESETS.map(p => (
            <button key={p.key} role="tab" aria-selected={preset === p.key} onClick={() => setPreset(p.key)}
              className={cx('px-2.5 h-7 rounded-[6px] text-[12px] whitespace-nowrap cursor-pointer transition-colors',
                preset === p.key ? 'bg-surface-muted text-ink font-medium shadow-card' : 'text-ink-faint hover:text-ink')}>
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-1.5">
            <Input type="date" aria-label="From" value={from} onChange={e => setFrom(e.target.value)} className="!min-h-[32px] !py-1 w-[150px]" />
            <span className="text-ink-faint text-xs">to</span>
            <Input type="date" aria-label="To" value={to} onChange={e => setTo(e.target.value)} className="!min-h-[32px] !py-1 w-[150px]" />
          </div>
        )}
        {s && !needsDates && (
          <span className="text-[11.5px] text-ink-faint ml-auto">{s.range.label} · {s.range.from} to {s.range.to}</span>
        )}
      </div>

      {needsDates ? (
        <Card padded={false}>
          <EmptyState icon={<Calendar className="w-5 h-5" />} title="Pick a date range"
            message="Choose a start and end date to see the reports." />
        </Card>
      ) : (
        <>
          {/* ------------------------------------------ summary strip */}
          <div className="panel overflow-hidden grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 divide-line
                          [&>*]:border-line [&>*]:border-b xl:[&>*]:border-b-0 [&>*:not(:last-child)]:border-r">
            <Tile label="Bills" value={String(s?.invoice_count ?? 0)} loading={loadingSummary}
              sub={s ? `${s.gst_invoice_count ?? 0} GST · ${s.non_gst_invoice_count ?? 0} non-GST` : undefined} />
            <Tile label="Sales (ex-GST)" value={`₹${formatINR(s?.revenue ?? s?.taxable)}`} loading={loadingSummary}
              sub={s ? `Non-GST ₹${formatINR(s.non_gst_sales)}` : undefined} />
            <Tile label="GST payable" value={`₹${formatINR(s?.gst_payable ?? s?.gst_total)}`} loading={loadingSummary}
              sub={s ? (s.input_gst ? `₹${formatINR(s.gst_total)} − ₹${formatINR(s.input_gst)} credit` : `${s.b2b_count} B2B · ${s.b2c_count} B2C`) : undefined} />
            <Tile label="Collected" value={`₹${formatINR(s?.received)}`} tone="text-positive-ink" loading={loadingSummary}
              sub={s && s.grand_total ? `${Math.min(100, (s.received / s.grand_total) * 100).toFixed(0)}% of ₹${formatINR(s.grand_total)}` : undefined} />
            <Tile label="Outstanding" value={`₹${formatINR(s?.outstanding)}`} tone="text-warning-ink" loading={loadingSummary}
              sub={s?.overdue_count ? `${s.overdue_count} overdue` : 'None overdue'} />
            <Tile label="Gross profit" value={s?.costed_count ? `₹${formatINR(s.gross_profit)}` : '-'} tone="text-positive-ink"
              loading={loadingSummary}
              sub={s ? (s.costed_count ? `${s.margin_pct ?? 0}% margin${s.uncosted_count ? ` · ${s.uncosted_count} uncosted` : ''}` : 'No costs entered') : undefined} />
          </div>

          {/* ------------------------------------------ report tabs + table */}
          <Card padded={false} className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-3 pt-2.5 pb-2">
              <div role="tablist" aria-label="Report"
                className="flex items-center gap-0.5 p-0.5 rounded-control bg-surface-sunken border border-line overflow-x-auto scrollbar-none max-w-full">
                {available.map(r => (
                  <button key={r.key} role="tab" aria-selected={active === r.key} onClick={() => setActive(r.key)}
                    className={cx('px-2.5 h-7 rounded-[6px] text-[12px] whitespace-nowrap cursor-pointer transition-colors',
                      active === r.key ? 'bg-surface-muted text-ink font-medium shadow-card' : 'text-ink-faint hover:text-ink')}>
                    {r.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5 ml-auto">
                {hasCompactView && (
                  <Button variant="ghost" size="sm" icon={<Columns3 className="w-3.5 h-3.5" />}
                    onClick={() => setCompact(c => !c)} className="!min-h-[30px] !py-1 !text-[12px]"
                    aria-pressed={!compact}>
                    {compact ? 'All columns' : 'Fewer columns'}
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={download} disabled={downloading || loadingReport}
                  icon={downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  className="!min-h-[30px] !py-1 !text-[12px]">
                  Download CSV
                </Button>
              </div>
            </div>
            {meta && <p className="px-3 pb-2 text-[11.5px] text-ink-faint">{meta.hint}</p>}

            {error ? <ErrorState message={error} onRetry={loadReport} /> : loadingReport || !report ? (
              <div className="px-3 pb-3 space-y-1.5 border-t border-line pt-3" aria-hidden="true">
                {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-6" />)}
              </div>
            ) : (
              <div className="pb-1">
                {report.sections.map(sec => (
                  <SectionTable key={sec.id} sec={sec} compact={compact} multi={report.sections.length > 1} />
                ))}
                {(report.footnotes || []).map((f, i) => (
                  <p key={i} className="px-3 py-2 text-[11px] text-ink-faint border-t border-line">{f}</p>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
};
