import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Wallet, FileText, Plus, Building2, TriangleAlert, ArrowRight, CalendarRange,
} from 'lucide-react';
import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadialBarChart, RadialBar, PolarAngleAxis,
} from 'recharts';
import { apiRequest } from '../services/api.js';
import { Invoice, CompanySettings } from '../types.js';
import { formatINR } from '../utils/format.js';
import {
  Button, Card, EmptyState, ErrorState, StatusBadge, Input, Field, RingGauge, AvatarChip, cx,
} from './ui.js';

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

/* ---------------------------------------------------------------- tiles ---- */
/** One compact KPI. Label, figure, one line of context. Nothing else. */
const Tile: React.FC<{
  label: string;
  value: string;
  title?: string;
  sub?: React.ReactNode;
  tone?: 'default' | 'positive' | 'warning' | 'danger';
  onClick?: () => void;
  loading?: boolean;
  aside?: React.ReactNode;
}> = ({ label, value, title, sub, tone = 'default', onClick, loading, aside }) => {
  const Tag: any = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={cx(
      'text-left min-w-0 px-3.5 py-3 flex items-start justify-between gap-2',
      onClick && 'cursor-pointer hover:bg-surface-muted transition-colors duration-[140ms]',
    )}>
      <div className="min-w-0">
        <div className="text-[10.5px] uppercase tracking-[0.06em] text-ink-faint font-medium truncate">{label}</div>
        {loading
          ? <div className="skeleton h-5 w-20 mt-1.5" />
          : <div title={title} className={cx('numeral text-[1.05rem] sm:text-[1.15rem] leading-tight mt-1 truncate', {
              default: 'text-ink', positive: 'text-positive-ink', warning: 'text-warning-ink', danger: 'text-danger-ink',
            }[tone])}>{value}</div>}
        {sub && !loading && <div className="text-[11px] text-ink-faint mt-0.5 truncate">{sub}</div>}
      </div>
      {aside && !loading && <div className="shrink-0 hidden sm:block">{aside}</div>}
    </Tag>
  );
};

/** A small titled panel with tight padding. */
const Panel: React.FC<{
  title: string; right?: React.ReactNode; className?: string; children: React.ReactNode; flush?: boolean;
}> = ({ title, right, className, children, flush }) => (
  <Card padded={false} className={className}>
    <div className="flex items-center justify-between gap-2 px-3.5 pt-3 pb-2">
      <h2 className="text-[13px] font-semibold text-ink tracking-[-0.01em]">{title}</h2>
      {right && <div className="text-[11px] text-ink-faint">{right}</div>}
    </div>
    <div className={flush ? '' : 'px-3.5 pb-3.5'}>{children}</div>
  </Card>
);

/** One line of the P&L: label left, figure right. */
const PLRow: React.FC<{ label: string; value: string; strong?: boolean; tone?: string; indent?: boolean; hint?: string }> = ({
  label, value, strong, tone, indent, hint,
}) => (
  <div className={cx('flex items-baseline justify-between gap-3 py-1', strong && 'border-t border-line pt-1.5 mt-0.5')}>
    <span className={cx('text-[12px] truncate', indent ? 'pl-3 text-ink-faint' : strong ? 'text-ink font-medium' : 'text-ink-soft')}>
      {label}{hint && <span className="text-ink-faint"> · {hint}</span>}
    </span>
    <span className={cx('font-mono text-[12.5px] shrink-0', strong && 'font-semibold', tone || 'text-ink')}>{value}</span>
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

  const gstRings = useMemo(() => {
    const cgst = Number(m?.cgst || 0), sgst = Number(m?.sgst || 0), igst = Number(m?.igst || 0);
    const total = cgst + sgst + igst;
    if (!total) return [];
    return [
      { name: 'IGST', value: igst, pct: (igst / total) * 100, fill: 'var(--color-ink-faint)' },
      { name: 'SGST', value: sgst, pct: (sgst / total) * 100, fill: 'var(--color-ember-300)' },
      { name: 'CGST', value: cgst, pct: (cgst / total) * 100, fill: 'var(--color-accent)' },
    ];
  }, [m]);

  const tooltipStyle = {
    background: 'color-mix(in oklab, var(--color-sheet) 92%, transparent)',
    border: '1px solid var(--color-line-strong)', borderRadius: 10,
    color: 'var(--color-ink)', fontSize: 11.5, boxShadow: 'var(--shadow-raised)', padding: '6px 9px',
  };

  if (loadError && !m) {
    return <Card padded={false}><ErrorState message={loadError} onRetry={() => loadData(fromDate, toDate)} /></Card>;
  }

  return (
    <div className="space-y-3 stagger">
      {/* ------------------------------------------ toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Reporting period"
          className="flex items-center gap-0.5 p-0.5 rounded-control bg-surface-sunken border border-line overflow-x-auto scrollbar-none max-w-full">
          {PERIODS.map(({ key, label }) => (
            <button key={key} role="tab" aria-selected={period === key} onClick={() => choosePeriod(key)}
              className={cx('px-2.5 h-7 rounded-[6px] text-[12px] whitespace-nowrap cursor-pointer transition-colors',
                period === key ? 'bg-surface-muted text-ink font-medium shadow-card' : 'text-ink-faint hover:text-ink')}>
              {label}
            </button>
          ))}
        </div>

        {overdueCount > 0 && !loading && (
          <button onClick={onViewOverdue}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-control border border-warning-line bg-warning-soft
                       text-warning-ink text-[12px] cursor-pointer hover:border-warning transition-colors">
            <TriangleAlert className="w-3.5 h-3.5" strokeWidth={1.8} />
            {overdueCount} overdue · {inr(m?.overdue_amount)}
            <ArrowRight className="w-3.5 h-3.5 opacity-70" strokeWidth={1.8} />
          </button>
        )}

        <div className="flex items-center gap-1.5 ml-auto">
          <Button variant="secondary" size="sm" icon={<Wallet className="w-3.5 h-3.5" />} onClick={onReceivePayment}
            className="!min-h-[32px] !py-1 !text-[12.5px]">
            Record payment
          </Button>
          <span className="hidden sm:inline-flex">
            <Button variant="ghost" size="sm" icon={<Building2 className="w-3.5 h-3.5" />} onClick={onNewCustomer}
              className="!min-h-[32px] !py-1 !text-[12.5px]">
              Add customer
            </Button>
          </span>
        </div>
      </div>

      {period === 'custom' && (
        <Card className="!p-3">
          <div className="flex flex-col sm:flex-row sm:items-end gap-2.5">
            <div className="grid grid-cols-2 gap-2.5 sm:contents">
              <Field label="From" htmlFor="dash-from" className="sm:w-[170px]">
                <Input id="dash-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </Field>
              <Field label="To" htmlFor="dash-to" className="sm:w-[170px]">
                <Input id="dash-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </Field>
            </div>
            <Button variant="primary" size="sm" icon={<CalendarRange className="w-4 h-4" />}
              onClick={() => loadData(fromDate, toDate)} loading={loading}>
              Apply
            </Button>
          </div>
        </Card>
      )}

      {/* ------------------------------------------ KPI strip: six compact tiles */}
      <div className="panel overflow-hidden grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6
                      divide-y md:divide-y-0 divide-line [&>*]:border-line
                      [&>*:nth-child(odd)]:border-r md:[&>*]:border-r md:[&>*:nth-child(3n)]:border-r-0
                      xl:[&>*:nth-child(3n)]:border-r xl:[&>*:last-child]:border-r-0
                      md:[&>*:nth-child(n+4)]:border-t xl:[&>*:nth-child(n+4)]:border-t-0">
        <Tile label="Total sales" value={inr(sales)} title={full(sales)} loading={loading}
          sub={`GST ${inr(m?.gst_sales)} · Non-GST ${inr(m?.non_gst_sales)}`} />
        <Tile label="Collected" value={inr(collected)} title={full(collected)} tone="positive" loading={loading}
          sub={`${recoveryPct.toFixed(0)}% recovered`}
          aside={<RingGauge value={recoveryPct} size={34} label={`${recoveryPct.toFixed(0)} percent recovered`} />} />
        <Tile label="Outstanding" value={inr(m?.outstanding)} title={full(m?.outstanding)} tone="warning" loading={loading}
          sub={`${m?.pending || 0} pending bill${m?.pending === 1 ? '' : 's'}`}
          onClick={overdueCount > 0 ? onViewOverdue : undefined} />
        <Tile label="GST payable" value={inr(m?.gst_payable)} title={full(m?.gst_payable)} loading={loading}
          tone={Number(m?.gst_payable) < 0 ? 'positive' : 'default'}
          sub={Number(m?.input_gst) > 0
            ? `${inr(m?.gst)} collected − ${inr(m?.input_gst)} credit`
            : `on ${m?.gst_invoices || 0} GST bill${m?.gst_invoices === 1 ? '' : 's'}`} />
        <Tile label="Gross profit" value={m?.costed_invoices ? inr(m?.gross_profit) : '-'} title={full(m?.gross_profit)}
          tone={Number(m?.gross_profit) < 0 ? 'danger' : 'positive'} loading={loading}
          sub={m?.costed_invoices
            ? `${m?.margin_pct ?? 0}% margin${uncosted ? ` · ${uncosted} uncosted` : ''}`
            : 'Add costs to bills to see profit'} />
        <Tile label="Net profit" value={m?.costed_invoices ? inr(m?.net_profit) : '-'} title={full(m?.net_profit)}
          tone={Number(m?.net_profit) < 0 ? 'danger' : 'default'} loading={loading}
          sub={`after ${inr(m?.expenses)} expenses`} />
      </div>

      {/* ------------------------------------------ chart + P&L */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 items-start">
        <Panel title="Billed vs collected" right="Last 6 months" className="xl:col-span-2" flush>
          {loading ? (
            <div className="h-[190px] px-3.5 pb-3 flex items-end gap-2" aria-hidden="true">
              {[58, 82, 45, 92, 66, 74].map((h, i) => <div key={i} className="skeleton flex-1" style={{ height: `${h}%` }} />)}
            </div>
          ) : chartData.length === 0 ? (
            <p className="text-[12px] text-ink-faint text-center py-10">No bills in this period.</p>
          ) : (
            <div className="h-[190px] px-1 pb-2">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 6, right: 10, left: 0, bottom: 0 }} barGap={3}>
                  <defs>
                    <linearGradient id="barBilled" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-ink-faint)" stopOpacity={0.9} />
                      <stop offset="100%" stopColor="var(--color-ink-faint)" stopOpacity={0.15} />
                    </linearGradient>
                    <linearGradient id="barCollected" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={1} />
                      <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0.2} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 6" stroke="var(--color-line)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10.5, fill: 'var(--color-ink-faint)' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10.5, fill: 'var(--color-ink-faint)' }} tickLine={false} axisLine={false}
                    tickFormatter={(v) => inr(v)} width={52} />
                  <Tooltip formatter={(v: any) => full(Number(v))} contentStyle={tooltipStyle}
                    cursor={{ fill: 'var(--color-surface-muted)' }} />
                  <Bar dataKey="Billed" fill="url(#barBilled)" radius={[4, 4, 1, 1]} maxBarSize={22} />
                  <Bar dataKey="Collected" fill="url(#barCollected)" radius={[4, 4, 1, 1]} maxBarSize={22} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="flex items-center gap-3 px-3.5 pb-2.5 text-[11px] text-ink-faint">
            <span className="flex items-center gap-1.5"><span className="status-dot" style={{ background: 'var(--color-ink-faint)' }} />Billed</span>
            <span className="flex items-center gap-1.5"><span className="status-dot bg-accent" />Collected</span>
          </div>
        </Panel>

        <Panel title="Profit and loss" right={period === 'all' ? 'All time' : PERIODS.find(p => p.key === period)?.label}>
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
                tone={Number(m?.gross_profit) < 0 ? 'text-danger-ink' : 'text-positive-ink'} />
              <PLRow label="Operating expenses" value={`-${full(m?.expenses)}`} tone="text-ink-soft" />
              <PLRow label="Net profit" value={m?.costed_invoices ? full(m?.net_profit) : '-'} strong
                tone={Number(m?.net_profit) < 0 ? 'text-danger-ink' : 'text-ink'} />
              {/* GST is not income: shown apart from profit. */}
              <div className="mt-2 pt-2 border-t border-line space-y-0.5 text-[11px] text-ink-faint">
                <div className="flex items-baseline justify-between"><span>GST collected</span><span className="font-mono">{full(m?.gst)}</span></div>
                <div className="flex items-baseline justify-between"><span>Input credit (vendor GST)</span><span className="font-mono">-{full(m?.input_gst)}</span></div>
                <div className="flex items-baseline justify-between text-ink font-medium">
                  <span>{Number(m?.gst_payable) < 0 ? 'GST credit carried forward' : 'GST payable'}</span>
                  <span className="font-mono">{full(Math.abs(Number(m?.gst_payable || 0)))}</span>
                </div>
                {Number(m?.non_gst_vendor_gst) > 0 && (
                  <div className="flex items-baseline justify-between" title="Vendor GST on non-GST bills. Counted in their cost, not claimed as credit.">
                    <span>Vendor GST on non-GST bills (in cost)</span>
                    <span className="font-mono">{full(m?.non_gst_vendor_gst)}</span>
                  </div>
                )}
              </div>
              {uncosted > 0 && (
                <p className="mt-1.5 text-[11px] text-warning-ink">
                  Profit covers only costed bills. Enter the trip cost on {uncosted} bill{uncosted === 1 ? '' : 's'} to complete it.
                </p>
              )}
            </div>
          )}
        </Panel>
      </div>

      {/* ------------------------------------------ activity + tax */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 items-start">
        <Panel title="Recent bills" right={!loading ? `${recent.length} latest` : undefined} className="xl:col-span-2" flush>
          {loading ? (
            <div className="px-3.5 pb-3 space-y-1.5" aria-hidden="true">
              {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-9" />)}
            </div>
          ) : recent.length === 0 ? (
            <EmptyState icon={<FileText className="w-5 h-5" />} title="No bills in this period"
              action={<Button variant="primary" size="sm" icon={<Plus className="w-4 h-4" />} onClick={onNewInvoice}>New invoice</Button>} />
          ) : (
            <ul className="pb-1.5 divide-y divide-line border-t border-line">
              {recent.map((inv: any) => {
                const name = inv.buyer_name || inv.buyer?.name || 'Customer';
                return (
                  <li key={inv.id}>
                    <button onClick={() => onSelectInvoice(inv)}
                      className="w-full text-left flex items-center gap-2.5 px-3.5 py-2 hover:bg-surface-muted transition-colors cursor-pointer">
                      <AvatarChip name={name} square />
                      <span className="min-w-0 flex-1 grid grid-cols-1 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] sm:gap-3 items-center">
                        <span className="min-w-0">
                          <span className="block text-[12.5px] text-ink truncate">{name}</span>
                          <span className="flex items-center gap-1.5 text-[11px] text-ink-faint">
                            <span className="font-mono text-accent-ink">{inv.invoice_no}</span>
                            {inv.doc_type === 'internal' && <span className="text-[9.5px] font-semibold border border-line rounded-[3px] px-1">NON-GST</span>}
                          </span>
                        </span>
                        <span className="hidden sm:block text-[11px] text-ink-faint truncate">
                          {[inv.from_city, inv.to_city].filter(Boolean).join(' → ')}{inv.invoice_date ? ` · ${inv.invoice_date}` : ''}
                        </span>
                      </span>
                      <span className="hidden md:block shrink-0"><StatusBadge status={inv.status} /></span>
                      <span className="font-mono text-[12.5px] text-ink shrink-0 w-[92px] text-right">
                        {full(inv.totals?.grand_total ?? inv.grand_total)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="GST composition" right={!loading ? full(m?.gst) : undefined}>
          {loading ? <div className="skeleton h-[96px]" aria-hidden="true" /> : gstRings.length === 0 ? (
            <p className="text-[12px] text-ink-faint py-4 text-center">No GST in this period.</p>
          ) : (
            <div className="flex items-center gap-3">
              <div className="h-[96px] w-[96px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <RadialBarChart innerRadius="36%" outerRadius="100%" data={gstRings} startAngle={90} endAngle={-270} barSize={8}>
                    <PolarAngleAxis type="number" domain={[0, 100]} dataKey="pct" tick={false} />
                    <RadialBar dataKey="pct" background={{ fill: 'var(--color-line)' }} cornerRadius={5} />
                  </RadialBarChart>
                </ResponsiveContainer>
              </div>
              <dl className="min-w-0 flex-1 space-y-1.5">
                {gstRings.map(g => (
                  <div key={g.name} className="flex items-baseline justify-between gap-2">
                    <dt className="flex items-center gap-1.5 text-[12px] text-ink-soft">
                      <span className="status-dot" style={{ background: g.fill }} aria-hidden="true" />
                      {g.name} <span className="text-ink-faint text-[10.5px]">{g.pct.toFixed(0)}%</span>
                    </dt>
                    <dd className="font-mono text-[12px] text-ink">{full(g.value)}</dd>
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
