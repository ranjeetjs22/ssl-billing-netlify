import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Wallet, FileText, Plus, Building2, ArrowRight, CalendarRange,
} from 'lucide-react';
import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { apiRequest } from '../services/api.js';
import { Invoice, CompanySettings } from '../types.js';
import { formatINR } from '../utils/format.js';
import {
  Button, Card, CardHeader, EmptyState, ErrorState, StatusBadge, Badge, Input, Field, RingGauge,
  Metric, Segmented, DataTable, cx,
} from './ui.js';
import type { Column } from './ui.js';

interface DashboardProps {
  onNewInvoice: () => void;
  onNewCustomer: () => void;
  onReceivePayment: () => void;
  onViewOverdue: () => void;
  onSelectInvoice: (inv: Invoice) => void;
  companySettings?: CompanySettings;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (month: string | undefined) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(month || ''));
  return m ? MONTHS[Number(m[2]) - 1] || m[2] : String(month || '');
};

/** Compact rupees for tight spots: ₹1.98L, ₹35.6K. Full figures go in tooltips. */
const inr = (val: number | undefined | null) => {
  const v = Number(val || 0);
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 10000000) return `${sign}₹${(a / 10000000).toFixed(2)}Cr`;
  if (a >= 100000) return `${sign}₹${(a / 100000).toFixed(2)}L`;
  if (a >= 1000) return `${sign}₹${(a / 1000).toFixed(1)}K`;
  return `${sign}₹${a.toFixed(0)}`;
};
const full = (v: number | undefined | null) => `₹${formatINR(Number(v || 0))}`;

/* --------------------------------------------------------------- period ---- */
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

type PeriodKey = 'all' | 'this_month' | 'last_month' | 'this_fy' | 'custom';
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'this_fy', label: 'This FY' },
  { key: 'custom', label: 'Custom' },
];
/** Shorter labels so the period switch fits a phone without scrolling. */
const SHORT: Partial<Record<PeriodKey, string>> = { all: 'All', this_fy: 'FY' };
const rangeFor = (key: PeriodKey): { from: string; to: string } => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (key) {
    case 'this_month': return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case 'last_month': return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case 'this_fy': {
      const start = m >= 3 ? y : y - 1;
      return { from: iso(new Date(start, 3, 1)), to: iso(new Date(start + 1, 2, 31)) };
    }
    default: return { from: '', to: '' };
  }
};

/* --------------------------------------------------------------- pieces ---- */
/** A titled card: header row with a hairline, then content. */
const Panel: React.FC<{
  title: string; right?: React.ReactNode; className?: string; children: React.ReactNode; flush?: boolean;
}> = ({ title, right, className, children, flush }) => (
  <Card padded={false} className={cx('min-w-0', className)}>
    <CardHeader title={title} actions={right ? <span className="text-xs text-ink-faint">{right}</span> : undefined} />
    <div className={flush ? '' : 'p-3 sm:p-4'}>{children}</div>
  </Card>
);

/** One line of the P&L: label left, figure right. */
const PLRow: React.FC<{ label: string; value: string; strong?: boolean; tone?: string; hint?: string }> = ({
  label, value, strong, tone, hint,
}) => (
  <div className={cx('flex items-baseline justify-between gap-3 py-1', strong && 'border-t border-line pt-1.5 mt-0.5')}>
    <span className={cx('text-sm truncate', strong ? 'text-ink font-medium' : 'text-ink-soft')}>
      {label}{hint && <span className="text-xs text-ink-faint"> · {hint}</span>}
    </span>
    <span className={cx('text-sm tabular-nums shrink-0', strong && 'font-medium', tone || 'text-ink')}>{value}</span>
  </div>
);

/** Small key-value line for the GST block under the P&L. */
const SubRow: React.FC<{ label: string; value: string; strong?: boolean; title?: string }> = ({ label, value, strong, title }) => (
  <div className={cx('flex items-baseline justify-between gap-3', strong ? 'text-ink font-medium' : 'text-ink-faint')} title={title}>
    <span className="truncate">{label}</span>
    <span className="tabular-nums shrink-0">{value}</span>
  </div>
);

export const Dashboard: React.FC<DashboardProps> = ({
  onNewInvoice, onNewCustomer, onReceivePayment, onViewOverdue, onSelectInvoice,
}) => {
  const [m, setM] = useState<any>(null);
  const [recent, setRecent] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodKey>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const loadData = useCallback(async (f = '', t = '') => {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = new URLSearchParams();
      if (f) qs.append('from', f);
      if (t) qs.append('to', t);
      const res = await apiRequest<any>(`/dashboard/summary${qs.toString() ? `?${qs}` : ''}`);
      setM(res);
      setRecent(res.recent_invoices || []);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const choosePeriod = (key: PeriodKey) => {
    setPeriod(key);
    if (key === 'custom') return;
    const { from, to } = rangeFor(key);
    setFromDate(from);
    setToDate(to);
    loadData(from, to);
  };

  const sales = Number(m?.total_sales || 0);
  const collected = Number(m?.collected || 0);
  const recoveryPct = sales ? Math.min(100, (collected / sales) * 100) : 0;
  const overdueCount = Number(m?.overdue || 0);
  const uncosted = Number(m?.uncosted_invoices || 0);

  const chartData = useMemo(
    () => (m?.chart_data || []).slice(-6).map((d: any) => ({
      month: monthLabel(d.month), Billed: d.sales, Collected: d.collected,
    })),
    [m]
  );

  const gstParts = useMemo(() => {
    const cgst = Number(m?.cgst || 0), sgst = Number(m?.sgst || 0), igst = Number(m?.igst || 0);
    const total = cgst + sgst + igst;
    if (!total) return [];
    return [
      { name: 'CGST', value: cgst, pct: (cgst / total) * 100, fill: 'var(--color-accent)' },
      { name: 'SGST', value: sgst, pct: (sgst / total) * 100, fill: 'color-mix(in oklab, var(--color-accent) 45%, var(--color-surface))' },
      { name: 'IGST', value: igst, pct: (igst / total) * 100, fill: 'var(--color-ink-faint)' },
    ];
  }, [m]);

  const tooltipStyle = {
    background: 'var(--color-sheet)',
    border: '1px solid var(--color-line)', borderRadius: 6,
    color: 'var(--color-ink)', fontSize: 12, boxShadow: 'var(--shadow-raised)', padding: '6px 8px',
  };
  const axisTick = { fontSize: 11, fill: 'var(--color-ink-faint)' };

  const recentColumns: Column<any>[] = [
    {
      key: 'no', header: 'Invoice', className: 'whitespace-nowrap',
      cell: (inv) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="font-mono text-[13px] text-ink">{inv.invoice_no}</span>
          {inv.doc_type === 'internal' && <Badge>Non-GST</Badge>}
        </span>
      ),
    },
    {
      key: 'customer', header: 'Customer', className: 'max-w-[220px] truncate text-ink',
      cell: (inv) => inv.buyer_name || inv.buyer?.name || 'Customer',
    },
    {
      key: 'route', header: 'Route', hideBelow: 'md', className: 'whitespace-nowrap',
      cell: (inv) => [inv.from_city, inv.to_city].filter(Boolean).join(' → ') || <span className="text-ink-faint">-</span>,
    },
    { key: 'date', header: 'Date', hideBelow: 'lg', className: 'whitespace-nowrap tabular-nums', cell: (inv) => inv.invoice_date || '-' },
    { key: 'status', header: 'Status', cell: (inv) => <StatusBadge status={inv.status} /> },
    {
      key: 'amount', header: 'Amount', align: 'right', className: 'whitespace-nowrap',
      cell: (inv) => <span className="tabular-nums font-medium text-ink">{full(inv.totals?.grand_total ?? inv.grand_total)}</span>,
    },
  ];

  if (loadError && !m) {
    return <Card padded={false}><ErrorState message={loadError} onRetry={() => loadData(fromDate, toDate)} /></Card>;
  }

  const periodLabel = PERIODS.find(p => p.key === period)?.label;

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* ------------------------------------------ toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<PeriodKey> label="Reporting period" value={period} onChange={choosePeriod}
          options={PERIODS.map(p => ({
            value: p.key,
            label: SHORT[p.key]
              ? <><span className="sm:hidden">{SHORT[p.key]}</span><span className="hidden sm:inline">{p.label}</span></>
              : p.label,
          }))} />

        <div className="flex items-center gap-1.5 w-full sm:w-auto sm:ml-auto">
          {overdueCount > 0 && !loading && (
            <button onClick={onViewOverdue}
              className="mr-auto sm:mr-0 inline-flex items-center gap-1.5 h-10 sm:h-8 px-2.5 rounded-control border border-line bg-surface
                         text-sm text-ink-soft cursor-pointer hover:border-line-strong hover:text-ink transition-colors">
              <span className="status-dot bg-danger" aria-hidden="true" />
              <span><span className="font-medium text-danger-ink">{overdueCount} overdue</span>
                <span className="text-ink-faint"> · </span><span className="tabular-nums">{inr(m?.overdue_amount)}</span></span>
              <ArrowRight className="w-3.5 h-3.5 text-ink-faint" aria-hidden="true" />
            </button>
          )}
          <Button variant="secondary" size="sm" icon={<Wallet />} onClick={onReceivePayment}>
            <span className="hidden sm:inline">Record payment</span>
            <span className="sm:hidden">Payment</span>
          </Button>
          <span className="hidden sm:inline-flex">
            <Button variant="ghost" size="sm" icon={<Building2 />} onClick={onNewCustomer}>Add customer</Button>
          </span>
        </div>
      </div>

      {period === 'custom' && (
        <Card>
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="grid grid-cols-2 gap-3 sm:contents">
              <Field label="From" htmlFor="dash-from" className="sm:w-[170px]">
                <Input id="dash-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </Field>
              <Field label="To" htmlFor="dash-to" className="sm:w-[170px]">
                <Input id="dash-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </Field>
            </div>
            <Button variant="secondary" icon={<CalendarRange />} onClick={() => loadData(fromDate, toDate)} loading={loading}>
              Apply range
            </Button>
          </div>
        </Card>
      )}

      {/* ------------------------------------------ KPI band: hairline grid, 2 / 3 / 6 up */}
      <div className="panel overflow-hidden grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-px bg-line [&>*]:bg-surface">
        <Metric label="Total sales" loading={loading}
          value={<span title={full(sales)}>{inr(sales)}</span>}
          compare={`GST ${inr(m?.gst_sales)} · Non-GST ${inr(m?.non_gst_sales)}`} />
        <Metric label="Collected" loading={loading}
          value={<span title={full(collected)}>{inr(collected)}</span>}
          compare={`${recoveryPct.toFixed(0)}% recovered`}
          visual={<RingGauge value={recoveryPct} size={30} label={`${recoveryPct.toFixed(0)} percent recovered`} />} />
        <Metric label="Outstanding" tone={Number(m?.outstanding) > 0 ? 'warning' : 'default'} loading={loading}
          value={<span title={full(m?.outstanding)}>{inr(m?.outstanding)}</span>}
          compare={`${m?.pending || 0} pending bill${m?.pending === 1 ? '' : 's'}`}
          onClick={overdueCount > 0 ? onViewOverdue : undefined} />
        <Metric label={Number(m?.gst_payable) < 0 ? 'GST credit' : 'GST payable'} loading={loading}
          value={<span title={full(m?.gst_payable)}>{inr(m?.gst_payable)}</span>}
          compare={Number(m?.input_gst) > 0
            ? `${inr(m?.gst)} − ${inr(m?.input_gst)} input credit`
            : `on ${m?.gst_invoices || 0} GST bill${m?.gst_invoices === 1 ? '' : 's'}`} />
        <Metric label="Gross profit" loading={loading}
          tone={!m?.costed_invoices ? 'default' : Number(m?.gross_profit) < 0 ? 'danger' : 'default'}
          value={<span title={full(m?.gross_profit)}>{m?.costed_invoices ? inr(m?.gross_profit) : '-'}</span>}
          compare={m?.costed_invoices
            ? `${m?.margin_pct ?? 0}% margin${uncosted ? ` · ${uncosted} uncosted` : ''}`
            : 'Add trip costs to see profit'} />
        <Metric label="Net profit" loading={loading}
          tone={Number(m?.net_profit) < 0 && m?.costed_invoices ? 'danger' : 'default'}
          value={<span title={full(m?.net_profit)}>{m?.costed_invoices ? inr(m?.net_profit) : '-'}</span>}
          compare={`after ${inr(m?.expenses)} expenses`} />
      </div>

      {/* ------------------------------------------ chart + P&L */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 sm:gap-4 items-start">
        <Panel title="Billed vs collected" className="xl:col-span-2" flush
          right={
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-[2px] bg-line-strong" aria-hidden="true" />Billed</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-[2px] bg-accent" aria-hidden="true" />Collected</span>
              <span className="hidden sm:inline">Last 6 months</span>
            </span>
          }>
          {loading ? (
            <div className="h-[200px] xl:h-[300px] p-4 flex items-end gap-3" aria-hidden="true">
              {[58, 82, 45, 92, 66, 74].map((h, i) => <div key={i} className="skeleton flex-1" style={{ height: `${h}%` }} />)}
            </div>
          ) : chartData.length === 0 ? (
            <p className="text-sm text-ink-faint text-center py-12">No bills in this period.</p>
          ) : (
            <div className="h-[200px] xl:h-[300px] pt-3 pr-3 pb-1 pl-1">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={2} barCategoryGap="28%">
                  <CartesianGrid stroke="var(--color-line)" vertical={false} />
                  <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--color-line)' }} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v) => inr(v)} width={48} />
                  <Tooltip formatter={(v: any) => full(Number(v))} contentStyle={tooltipStyle}
                    labelStyle={{ color: 'var(--color-ink-faint)', marginBottom: 2 }}
                    cursor={{ fill: 'var(--color-surface-muted)' }} />
                  <Bar dataKey="Billed" fill="var(--color-line-strong)" radius={[2, 2, 0, 0]} maxBarSize={16} isAnimationActive={false} />
                  <Bar dataKey="Collected" fill="var(--color-accent)" radius={[2, 2, 0, 0]} maxBarSize={16} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="Profit and loss" right={periodLabel}>
          {loading ? (
            <div className="space-y-2" aria-hidden="true">{Array.from({ length: 7 }).map((_, i) => <div key={i} className="skeleton h-3.5" />)}</div>
          ) : (
            <div>
              <PLRow label="GST sales" hint={`${m?.gst_invoices || 0} bills`} value={full(m?.gst_taxable_sales)} />
              <PLRow label="Non-GST sales" hint={`${m?.non_gst_invoices || 0} bills`} value={full(m?.non_gst_sales)} />
              <PLRow label="Revenue (ex-GST)" value={full(m?.revenue)} strong />
              <PLRow label="Direct cost" hint={uncosted ? `${uncosted} uncosted` : undefined}
                value={m?.costed_invoices ? `-${full(m?.total_cost)}` : '-'} tone="text-ink-soft" />
              <PLRow label="Gross profit" value={m?.costed_invoices ? full(m?.gross_profit) : '-'} strong
                tone={m?.costed_invoices && Number(m?.gross_profit) < 0 ? 'text-danger-ink' : 'text-ink'} />
              <PLRow label="Operating expenses" value={`-${full(m?.expenses)}`} tone="text-ink-soft" />
              <PLRow label="Net profit" value={m?.costed_invoices ? full(m?.net_profit) : '-'} strong
                tone={m?.costed_invoices && Number(m?.net_profit) < 0 ? 'text-danger-ink' : 'text-ink'} />
              {/* GST is not income: shown apart from profit. */}
              <div className="mt-2 pt-2 border-t border-line space-y-1 text-xs">
                <SubRow label="GST collected" value={full(m?.gst)} />
                <SubRow label="Input credit (vendor GST)" value={`-${full(m?.input_gst)}`} />
                <SubRow strong label={Number(m?.gst_payable) < 0 ? 'GST credit carried forward' : 'GST payable'}
                  value={full(Math.abs(Number(m?.gst_payable || 0)))} />
                {Number(m?.non_gst_vendor_gst) > 0 && (
                  <SubRow label="Vendor GST on non-GST bills (in cost)" value={full(m?.non_gst_vendor_gst)}
                    title="Vendor GST on non-GST bills. Counted in their cost, not claimed as credit." />
                )}
              </div>
              {uncosted > 0 && (
                <p className="mt-2.5 flex items-start gap-1.5 text-xs text-ink-soft">
                  <span className="status-dot bg-warning mt-[5px]" aria-hidden="true" />
                  <span>Profit covers only costed bills. Enter the trip cost on {uncosted} bill{uncosted === 1 ? '' : 's'} to complete it.</span>
                </p>
              )}
            </div>
          )}
        </Panel>
      </div>

      {/* ------------------------------------------ activity + tax */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 sm:gap-4 items-start">
        <Panel title="Recent bills" right={!loading ? `${recent.length} latest` : undefined} className="xl:col-span-2 overflow-hidden" flush>
          <DataTable
            caption="Recent bills"
            loading={loading}
            rows={recent as any[]}
            columns={recentColumns}
            onRowClick={(inv) => onSelectInvoice(inv)}
            empty={
              <EmptyState icon={<FileText />} title="No bills in this period"
                action={<Button variant="secondary" size="sm" icon={<Plus />} onClick={onNewInvoice}>New invoice</Button>} />
            }
            mobileCard={(inv) => (
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono text-[13px] text-ink truncate">{inv.invoice_no}</span>
                    {inv.doc_type === 'internal' && <Badge>Non-GST</Badge>}
                  </span>
                  <span className="tabular-nums font-medium text-ink text-sm shrink-0">{full(inv.totals?.grand_total ?? inv.grand_total)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="text-xs text-ink-faint truncate">
                    {inv.buyer_name || inv.buyer?.name || 'Customer'}{inv.invoice_date ? ` · ${inv.invoice_date}` : ''}
                  </span>
                  <StatusBadge status={inv.status} />
                </div>
              </div>
            )}
          />
        </Panel>

        <Panel title="GST composition" right={!loading ? <span className="tabular-nums">{full(m?.gst)}</span> : undefined}>
          {loading ? <div className="skeleton h-[72px]" aria-hidden="true" /> : gstParts.length === 0 ? (
            <p className="text-sm text-ink-faint py-4 text-center">No GST in this period.</p>
          ) : (
            <div>
              <div className="flex h-2 rounded-full overflow-hidden bg-surface-sunken gap-px" role="img"
                aria-label={gstParts.map(g => `${g.name} ${g.pct.toFixed(0)}%`).join(', ')}>
                {gstParts.filter(g => g.pct > 0).map(g => (
                  <span key={g.name} style={{ width: `${g.pct}%`, background: g.fill }} />
                ))}
              </div>
              <dl className="mt-3 divide-y divide-line">
                {gstParts.map(g => (
                  <div key={g.name} className="flex items-baseline justify-between gap-2 py-1.5">
                    <dt className="flex items-center gap-2 text-sm text-ink-soft">
                      <span className="w-2 h-2 rounded-[2px] shrink-0" style={{ background: g.fill }} aria-hidden="true" />
                      {g.name}
                      <span className="text-xs text-ink-faint tabular-nums">{g.pct.toFixed(0)}%</span>
                    </dt>
                    <dd className="text-sm tabular-nums font-medium text-ink">{full(g.value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
};
