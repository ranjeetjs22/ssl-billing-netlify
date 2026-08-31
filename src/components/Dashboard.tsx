import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  TrendingUp, CreditCard, Users, FileText, Plus, Receipt,
  AlertTriangle, RotateCcw, Wallet, Percent,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { apiRequest } from '../services/api.js';
import { Invoice, CompanySettings } from '../types.js';
import { formatINR } from '../utils/format.js';
import {
  Button, Card, StatCard, DataTable, Column, EmptyState, ErrorState,
  Badge, StatusBadge, Input, Field, SectionHeading,
} from './ui.js';

interface DashboardProps {
  onNewInvoice: () => void;
  onNewCustomer: () => void;
  onReceivePayment: () => void;
  onViewOverdue: () => void;
  onSelectInvoice: (inv: Invoice) => void;
  companySettings?: CompanySettings;
}

const compactINR = (val: number | undefined) => {
  if (!val) return '₹0';
  if (val >= 10000000) return `₹${(val / 10000000).toFixed(2)}Cr`;
  if (val >= 100000) return `₹${(val / 100000).toFixed(2)}L`;
  if (val >= 1000) return `₹${(val / 1000).toFixed(1)}K`;
  return `₹${val.toFixed(0)}`;
};

export const Dashboard: React.FC<DashboardProps> = ({
  onNewInvoice, onNewCustomer, onReceivePayment, onViewOverdue, onSelectInvoice,
}) => {
  const [metrics, setMetrics] = useState<any>(null);
  const [recentInvoices, setRecentInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const loadData = useCallback(async (fDate = '', tDate = '') => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      if (fDate) params.append('from', fDate);
      if (tDate) params.append('to', tDate);
      const qs = params.toString();
      const res = await apiRequest<any>(`/dashboard/summary${qs ? `?${qs}` : ''}`);
      setMetrics(res);
      setRecentInvoices(res.recent_invoices || []);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const recoveryPct = metrics?.total_sales
    ? Math.min(100, (metrics.payments_received / metrics.total_sales) * 100)
    : 0;

  const chartData = useMemo(
    () => (metrics?.chart_data || []).slice(-6).map((d: any) => ({
      month: d.month?.slice(5) || d.month,
      Billed: d.sales,
      Collected: d.collected,
    })),
    [metrics]
  );

  const columns: Column<Invoice>[] = [
    {
      key: 'invoice_no',
      header: 'Invoice',
      cell: (inv) => (
        <div className="min-w-0">
          <div className="font-mono font-bold text-accent-ink truncate">{inv.invoice_no}</div>
          <div className="text-xs text-ink-faint">{inv.invoice_date}</div>
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      cell: (inv) => (
        <span className="font-semibold text-ink truncate block max-w-[200px]">
          {inv.buyer_name || inv.buyer?.name || '—'}
        </span>
      ),
    },
    {
      key: 'route',
      header: 'Route',
      hideBelow: 'lg',
      cell: (inv) => (
        <span className="text-ink-soft truncate block max-w-[180px]">
          {inv.from_city || inv.origin} → {inv.to_city || inv.destination}
        </span>
      ),
    },
    {
      key: 'taxable',
      header: 'Taxable',
      align: 'right',
      hideBelow: 'md',
      cell: (inv) => <span className="font-mono text-ink-soft">₹{formatINR(inv.totals?.taxable_amount)}</span>,
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      cell: (inv) => <span className="font-mono font-bold text-ink">₹{formatINR(inv.totals?.grand_total)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      cell: (inv) => <StatusBadge status={String(inv.status || '').toLowerCase().replace('partial', 'partially_paid')} />,
    },
  ];

  const mobileCard = (inv: Invoice) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono font-bold text-accent-ink text-sm truncate">{inv.invoice_no}</div>
          <div className="font-semibold text-ink truncate">{inv.buyer_name || inv.buyer?.name || '—'}</div>
        </div>
        <StatusBadge status={String(inv.status || '').toLowerCase().replace('partial', 'partially_paid')} />
      </div>
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-line">
        <span className="text-xs text-ink-faint truncate">
          {inv.from_city || inv.origin} → {inv.to_city || inv.destination}
        </span>
        <span className="font-mono font-bold text-ink shrink-0">₹{formatINR(inv.totals?.grand_total)}</span>
      </div>
    </div>
  );

  if (loadError && !metrics) {
    return <Card padded={false}><ErrorState message={loadError} onRetry={() => loadData(fromDate, toDate)} /></Card>;
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Quick actions — thumb-reachable on mobile, one primary CTA */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={onNewInvoice}>
          New Invoice
        </Button>
        <Button variant="secondary" icon={<Receipt className="w-4 h-4" />} onClick={onReceivePayment}>
          Record Payment
        </Button>
        <Button variant="secondary" icon={<Users className="w-4 h-4" />} onClick={onNewCustomer} className="hidden sm:inline-flex">
          Add Customer
        </Button>
        {(metrics?.overdue || 0) > 0 && (
          <Button
            variant="secondary"
            icon={<AlertTriangle className="w-4 h-4 text-danger" />}
            onClick={onViewOverdue}
            className="sm:ml-auto"
          >
            {metrics.overdue} overdue
          </Button>
        )}
      </div>

      {/* Primary metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          label="Total Sales"
          value={`₹${formatINR(metrics?.total_sales)}`}
          sub={`${metrics?.invoices || 0} invoices`}
          icon={<TrendingUp className="w-4 h-4" />}
          loading={loading}
        />
        <StatCard
          label="Collected"
          value={`₹${formatINR(metrics?.payments_received)}`}
          sub={`${metrics?.paid || 0} fully settled`}
          tone="positive"
          icon={<CreditCard className="w-4 h-4" />}
          loading={loading}
        />
        <StatCard
          label="Outstanding"
          value={`₹${formatINR(metrics?.outstanding)}`}
          sub={`${metrics?.pending || 0} pending`}
          tone="warning"
          icon={<Wallet className="w-4 h-4" />}
          loading={loading}
        />
        <StatCard
          label="GST Liability"
          value={`₹${formatINR(metrics?.gst)}`}
          sub={`CGST ${compactINR(metrics?.cgst)} · SGST ${compactINR(metrics?.sgst)}`}
          icon={<Percent className="w-4 h-4" />}
          loading={loading}
        />
      </div>

      {/* Period filter */}
      <Card>
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="grid grid-cols-2 gap-3 sm:contents">
            <Field label="From" htmlFor="dash-from" className="sm:flex-1 sm:max-w-[190px]">
              <Input id="dash-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </Field>
            <Field label="To" htmlFor="dash-to" className="sm:flex-1 sm:max-w-[190px]">
              <Input id="dash-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </Field>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="primary" onClick={() => loadData(fromDate, toDate)} loading={loading}>
              Apply
            </Button>
            {(fromDate || toDate) && (
              <Button
                variant="ghost"
                icon={<RotateCcw className="w-4 h-4" />}
                onClick={() => { setFromDate(''); setToDate(''); loadData('', ''); }}
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Chart + collection health */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2">
          <SectionHeading title="Billed vs Collected" hint="Last 6 months" />
          {chartData.length === 0 ? (
            <EmptyState title="No data yet" message="Charts appear once you raise your first invoice." />
          ) : (
            <div className="h-[260px] sm:h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: 'var(--color-ink-faint)' }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fontSize: 12, fill: 'var(--color-ink-faint)' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => compactINR(v)}
                    width={64}
                  />
                  <Tooltip
                    formatter={(v: any) => `₹${formatINR(Number(v))}`}
                    contentStyle={{
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-line)',
                      borderRadius: 12,
                      color: 'var(--color-ink)',
                      fontSize: 13,
                    }}
                    cursor={{ fill: 'var(--color-surface-sunken)' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: 'var(--color-ink-soft)' }} />
                  <Bar dataKey="Billed" fill="var(--color-info)" radius={[6, 6, 0, 0]} maxBarSize={38} />
                  <Bar dataKey="Collected" fill="var(--color-positive)" radius={[6, 6, 0, 0]} maxBarSize={38} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card>
          <SectionHeading title="Collection health" hint="Recovery ratio and tax split" />

          <div className="mb-4">
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-sm text-ink-soft">Payment recovery</span>
              <span className="font-mono font-bold text-ink">{recoveryPct.toFixed(1)}%</span>
            </div>
            <div
              className="w-full bg-surface-sunken rounded-full h-2.5 overflow-hidden"
              role="progressbar"
              aria-valuenow={Math.round(recoveryPct)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Payment recovery ratio"
            >
              <div
                className="bg-positive h-full rounded-full transition-[width] duration-500 ease-out"
                style={{ width: `${recoveryPct}%` }}
              />
            </div>
          </div>

          <dl className="space-y-2 text-sm border-t border-line pt-3">
            {[
              ['CGST', metrics?.cgst],
              ['SGST', metrics?.sgst],
              ['IGST', metrics?.igst || 0],
            ].map(([label, val]) => (
              <div key={String(label)} className="flex justify-between gap-2">
                <dt className="text-ink-soft">{label}</dt>
                <dd className="font-mono font-semibold text-ink">₹{formatINR(val as number)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-2 pt-2 border-t border-line font-bold">
              <dt className="text-ink">Total tax</dt>
              <dd className="font-mono text-accent-ink">₹{formatINR(metrics?.gst)}</dd>
            </div>
          </dl>

          <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-line text-center">
            <div>
              <div className="text-xl font-bold font-mono text-ink">{metrics?.customers ?? 0}</div>
              <div className="text-xs text-ink-faint">Customers</div>
            </div>
            <div>
              <div className="text-xl font-bold font-mono text-ink">{metrics?.invoices ?? 0}</div>
              <div className="text-xs text-ink-faint">Invoices</div>
            </div>
          </div>
        </Card>
      </div>

      {/* Recent invoices */}
      <Card padded={false} className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 p-4 sm:p-5 border-b border-line">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-ink">Recent invoices</h2>
            <p className="text-sm text-ink-faint">Latest consignment bills</p>
          </div>
          <Badge tone="accent">SAC 996511</Badge>
        </div>

        <DataTable
          rows={recentInvoices}
          columns={columns}
          loading={loading}
          onRowClick={onSelectInvoice}
          mobileCard={mobileCard}
          caption="Recent invoices"
          empty={
            <EmptyState
              icon={<FileText className="w-6 h-6" />}
              title="No invoices yet"
              message="Create your first GST tax invoice to see activity here."
              action={<Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={onNewInvoice}>New Invoice</Button>}
            />
          }
        />
      </Card>
    </div>
  );
};
