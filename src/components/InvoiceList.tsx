import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Search, Download, FileText, Printer, CreditCard, Trash2,
  Edit3, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { apiRequest } from '../services/api.js';
import { Invoice, CompanySettings, BankAccount } from '../types.js';
import { formatINR } from '../utils/format.js';
import { printInvoicePDF } from '../utils/pdf.js';
import { DeleteInvoiceModal } from './DeleteInvoiceModal.js';
import {
  Button, IconButton, Card, MetricStrip, Metric, DataTable, Column, EmptyState, ErrorState,
  Toast, StatusBadge, Badge, Segmented, Input, Select, cx,
} from './ui.js';

interface InvoiceListProps {
  onNewInvoice: () => void;
  onSelectInvoice: (inv: Invoice) => void;
  onEditInvoice?: (inv: Invoice) => void;
  onRecordPayment: (inv: Invoice) => void;
  companySettings: CompanySettings;
  defaultBank?: BankAccount;
  highlightInvoiceId?: string | null;
  initialToastMessage?: string | null;
}

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Unpaid' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'paid', label: 'Paid' },
  { key: 'cancelled', label: 'Cancelled' },
];

const PAGE_SIZE = 20;

/** Local-time YYYY-MM-DD; toISOString() would shift IST dates back a day. */
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

type Period = 'all' | 'today' | 'this_month' | 'last_month' | 'last_3_months' | 'fy' | 'custom';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'all', label: 'All dates' },
  { key: 'today', label: 'Today' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'last_3_months', label: 'Last 3 months' },
  { key: 'fy', label: 'This financial year' },
  { key: 'custom', label: 'Custom range…' },
];

/** The from/to dates a preset stands for ('' = open-ended). */
function periodRange(p: Period): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (p) {
    case 'today': return { from: isoDay(now), to: isoDay(now) };
    case 'this_month': return { from: isoDay(new Date(y, m, 1)), to: isoDay(new Date(y, m + 1, 0)) };
    case 'last_month': return { from: isoDay(new Date(y, m - 1, 1)), to: isoDay(new Date(y, m, 0)) };
    case 'last_3_months': return { from: isoDay(new Date(y, m - 2, 1)), to: isoDay(new Date(y, m + 1, 0)) };
    case 'fy': {
      const start = m >= 3 ? y : y - 1;   // Indian FY: 1 Apr - 31 Mar
      return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
    }
    default: return { from: '', to: '' };
  }
}

export const InvoiceList: React.FC<InvoiceListProps> = ({
  onNewInvoice, onSelectInvoice, onEditInvoice, onRecordPayment,
  companySettings, defaultBank, highlightInvoiceId, initialToastMessage,
}) => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [docFilter, setDocFilter] = useState<'all' | 'tax_invoice' | 'internal'>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [invoiceToDelete, setInvoiceToDelete] = useState<Invoice | null>(null);
  // Party and date filters
  const [parties, setParties] = useState<{ id: string; name: string }[]>([]);
  const [partyId, setPartyId] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const range = period === 'custom' ? { from: customFrom, to: customTo } : periodRange(period);
  const hasExtraFilters = Boolean(partyId || range.from || range.to);
  const [toast, setToast] = useState<string | null>(initialToastMessage || null);
  const [summary, setSummary] = useState({
    count: 0, grand_total: 0, taxable: 0, gst: 0, balance: 0,
    gst_count: 0, non_gst_count: 0, total_cost: 0, gross_profit: 0, uncosted: 0,
  });

  // Debounce typing so we issue one request per pause, not one per keystroke
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      let url = `/invoices?page=${page}&page_size=${PAGE_SIZE}&sort=invoice_date&order=desc`;
      if (statusFilter !== 'all') url += `&status=${statusFilter}`;
      if (docFilter !== 'all') url += `&doc_type=${docFilter}`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      if (partyId) url += `&customer_id=${encodeURIComponent(partyId)}`;
      if (range.from) url += `&from_date=${range.from}`;
      if (range.to) url += `&to_date=${range.to}`;
      const res = await apiRequest<{ items: Invoice[]; total: number; summary: any }>(url);
      setInvoices(res.items || []);
      setTotal(res.total || 0);
      if (res.summary) setSummary(res.summary);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, docFilter, search, page, partyId, range.from, range.to]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  useEffect(() => {
    apiRequest<{ items: { id: string; name: string }[] }>('/customers?page=1&page_size=500')
      .then(r => setParties((r.items || []).map(c => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setParties([]));   // no customer access: the party filter just stays empty
  }, []);

  const clearAllFilters = () => {
    setSearchInput(''); setStatusFilter('all'); setDocFilter('all');
    setPartyId(''); setPeriod('all'); setCustomFrom(''); setCustomTo(''); setPage(1);
  };
  useEffect(() => { if (initialToastMessage) setToast(initialToastMessage); }, [initialToastMessage]);

  const handleExportCSV = async () => {
    try {
      const csv = await apiRequest<string>('/invoices/export');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setToast('Invoice CSV downloaded.');
    } catch {
      setToast('Could not export invoices.');
    }
  };

  const lrLabel = (inv: Invoice) =>
    inv.lr_items && inv.lr_items.length > 1 ? `${inv.lr_items.length} LRs` : inv.lr_no || '-';

  const columns: Column<Invoice>[] = [
    {
      key: 'invoice_no',
      header: 'Invoice',
      cell: (inv) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-mono text-[13px] font-medium text-ink truncate">{inv.invoice_no}</span>
            {inv.doc_type === 'internal' && <Badge>Non-GST</Badge>}
          </div>
          <div className="text-xs text-ink-faint tabular-nums">{inv.invoice_date}</div>
        </div>
      ),
    },
    {
      key: 'buyer',
      header: 'Customer',
      cell: (inv) => (
        <div className="min-w-0">
          <div className="font-medium text-ink truncate max-w-[220px]">{inv.buyer?.name || '-'}</div>
          <div className="text-xs text-ink-faint truncate">{inv.buyer?.city || inv.place_of_supply || '-'}</div>
        </div>
      ),
    },
    {
      key: 'lr',
      header: 'LR / route',
      hideBelow: 'lg',
      cell: (inv) => (
        <div className="min-w-0">
          <div className="font-mono text-[13px] text-ink-soft truncate max-w-[160px]" title={inv.lr_no}>{lrLabel(inv)}</div>
          <div className="text-xs text-ink-faint truncate">
            {inv.origin && inv.destination ? `${inv.origin} → ${inv.destination}` : 'Local'}
          </div>
        </div>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      cell: (inv) => (
        <span className="tabular-nums font-medium text-ink whitespace-nowrap">₹{formatINR(inv.totals?.grand_total ?? inv.grand_total)}</span>
      ),
    },
    {
      key: 'balance',
      header: 'Balance',
      align: 'right',
      hideBelow: 'md',
      cell: (inv) => {
        const bal = inv.balance ?? inv.grand_total ?? 0;
        return (
          <span className={cx('tabular-nums whitespace-nowrap', bal > 0.5 ? 'font-medium text-warning-ink' : 'text-ink-faint')}>
            ₹{formatINR(bal)}
          </span>
        );
      },
    },
    {
      key: 'profit',
      header: 'Profit',
      align: 'right',
      hideBelow: 'lg',
      cell: (inv) => {
        const gp = (inv as any).totals?.gross_profit;
        if (gp === null || gp === undefined) return <span className="text-xs text-ink-faint">Not costed</span>;
        const m = (inv as any).totals?.margin_pct;
        return (
          <div className="leading-tight whitespace-nowrap">
            <div className={cx('tabular-nums', gp < 0 ? 'text-danger-ink' : 'text-ink')}>₹{formatINR(gp)}</div>
            {m !== null && m !== undefined && <div className="text-[11px] text-ink-faint tabular-nums">{m}%</div>}
          </div>
        );
      },
    },
    { key: 'status', header: 'Status', cell: (inv) => <StatusBadge status={inv.display_status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (inv) => (
        <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <IconButton label={`Print invoice ${inv.invoice_no}`} onClick={() => printInvoicePDF(inv, companySettings, defaultBank)}>
            <Printer />
          </IconButton>
          {inv.display_status !== 'cancelled' && onEditInvoice && (
            <IconButton label={`Edit invoice ${inv.invoice_no}`} onClick={() => onEditInvoice(inv)}>
              <Edit3 />
            </IconButton>
          )}
          {inv.display_status !== 'paid' && inv.display_status !== 'cancelled' && (
            <IconButton label={`Record payment for ${inv.invoice_no}`} onClick={() => onRecordPayment(inv)}>
              <CreditCard />
            </IconButton>
          )}
          <IconButton
            label={`Delete invoice ${inv.invoice_no}`}
            onClick={() => setInvoiceToDelete(inv)}
            className="hover:text-danger-ink"
          >
            <Trash2 />
          </IconButton>
        </div>
      ),
    },
  ];

  const mobileCard = (inv: Invoice) => {
    const bal = inv.balance ?? inv.grand_total ?? 0;
    return (
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-mono text-[13px] font-medium text-ink truncate">{inv.invoice_no}</span>
            {inv.doc_type === 'internal' && <Badge>Non-GST</Badge>}
          </div>
          <StatusBadge status={inv.display_status} />
        </div>

        {/* LR number with the party it was billed to, on one line */}
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-1.5 min-w-0 text-sm">
            <span className="font-mono text-[13px] text-ink-soft shrink-0 max-w-[45%] truncate">
              {(inv.lr_no || inv.lr_items?.length) ? lrLabel(inv) : 'No LR'}
            </span>
            <span className="text-ink-faint" aria-hidden="true">·</span>
            <span className="text-ink truncate">{inv.buyer?.name || '-'}</span>
          </div>
          <span className="tabular-nums font-medium text-ink shrink-0">
            ₹{formatINR(inv.totals?.grand_total ?? inv.grand_total)}
          </span>
        </div>

        <div className="flex items-baseline justify-between gap-3 text-xs">
          <span className="text-ink-faint tabular-nums">{inv.invoice_date}</span>
          {bal > 0.5 ? (
            <span className="text-warning-ink tabular-nums">Balance ₹{formatINR(bal)}</span>
          ) : (
            <span className="text-ink-faint">No balance</span>
          )}
        </div>
      </div>
    );
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(search || statusFilter !== 'all' || hasExtraFilters);

  return (
    <div className="space-y-3 sm:space-y-4">
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

      <MetricStrip>
        <Metric label="Bills" value={summary.count} loading={loading}
          compare={`${summary.gst_count} GST · ${summary.non_gst_count} non-GST`} />
        <Metric label="Revenue (ex-GST)" value={`₹${formatINR(summary.taxable)}`} loading={loading}
          compare={`GST ₹${formatINR(summary.gst)}`} />
        <Metric label="Gross profit" value={`₹${formatINR(summary.gross_profit)}`} loading={loading}
          compare={summary.uncosted ? `${summary.uncosted} bill(s) not costed` : `Cost ₹${formatINR(summary.total_cost)}`} />
        <Metric label="Outstanding" value={`₹${formatINR(summary.balance)}`} tone={summary.balance > 0.5 ? 'warning' : 'default'} loading={loading} />
      </MetricStrip>

      {/* Toolbar: status and bill type on top, search and party / date below */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Filter invoices by status"
            options={TABS.map(t => ({ value: t.key, label: t.label }))}
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setPage(1); }}
          />
          <Segmented
            label="Filter by bill type"
            options={[
              { value: 'all', label: 'All types' },
              { value: 'tax_invoice', label: 'GST' },
              { value: 'internal', label: 'Non-GST' },
            ] as const}
            value={docFilter}
            onChange={(v) => { setDocFilter(v); setPage(1); }}
          />
          <Button variant="secondary" size="sm" icon={<Download />} onClick={handleExportCSV} className="ml-auto">
            Export
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <div className="relative col-span-2 sm:flex-1 sm:min-w-[220px] sm:max-w-sm">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" aria-hidden="true" />
            <Input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search invoice, LR or customer"
              aria-label="Search invoices"
              className="pl-8"
            />
          </div>
          <Select aria-label="Party" value={partyId} className="sm:w-52"
            onChange={(e) => { setPartyId(e.target.value); setPage(1); }}>
            <option value="">All parties</option>
            {parties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Select aria-label="Invoice date" value={period} className="sm:w-48"
            onChange={(e) => { setPeriod(e.target.value as Period); setPage(1); }}>
            {PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </Select>
          {period === 'custom' && (
            <>
              <Input type="date" aria-label="From date" value={customFrom} max={customTo || undefined} className="sm:w-40"
                onChange={(e) => { setCustomFrom(e.target.value); setPage(1); }} />
              <Input type="date" aria-label="To date" value={customTo} min={customFrom || undefined} className="sm:w-40"
                onChange={(e) => { setCustomTo(e.target.value); setPage(1); }} />
            </>
          )}
          {(hasExtraFilters || (period !== 'all' && period !== 'custom' && range.from)) && (
            <div className="col-span-2 flex items-center gap-2 min-w-0">
              {period !== 'all' && period !== 'custom' && range.from && (
                <span className="text-xs text-ink-faint tabular-nums whitespace-nowrap">{range.from} – {range.to}</span>
              )}
              {hasExtraFilters && (
                <Button variant="ghost" size="sm" onClick={() => { setPartyId(''); setPeriod('all'); setCustomFrom(''); setCustomTo(''); setPage(1); }}>
                  Clear party and date
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <Card padded={false} className="overflow-hidden">
        {loadError ? (
          <ErrorState message={loadError} onRetry={fetchInvoices} />
        ) : (
          <DataTable
            rows={invoices}
            columns={columns}
            loading={loading}
            onRowClick={onSelectInvoice}
            mobileCard={mobileCard}
            caption="Tax invoices"
            rowClassName={(inv) => (highlightInvoiceId && inv.id === highlightInvoiceId ? 'bg-accent-soft' : undefined)}
            empty={
              <EmptyState
                icon={<FileText />}
                title={filtered ? 'No matching invoices' : 'No invoices yet'}
                message={filtered ? 'Try a different search term or filter.' : 'Create your first GST tax invoice to get started.'}
                action={
                  filtered ? (
                    <Button variant="secondary" size="sm" onClick={clearAllFilters}>Clear filters</Button>
                  ) : (
                    <Button variant="secondary" size="sm" icon={<Plus />} onClick={onNewInvoice}>New invoice</Button>
                  )
                }
              />
            }
          />
        )}

        {totalPages > 1 && !loadError && (
          <div className="flex items-center justify-between gap-3 px-3 sm:px-4 py-2 border-t border-line">
            <span className="text-xs text-ink-faint tabular-nums">
              Page {page} of {totalPages} · {total} invoices
            </span>
            <div className="flex items-center gap-1">
              <IconButton label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} variant="secondary">
                <ChevronLeft />
              </IconButton>
              <IconButton label="Next page" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} variant="secondary">
                <ChevronRight />
              </IconButton>
            </div>
          </div>
        )}
      </Card>

      {invoiceToDelete && (
        <DeleteInvoiceModal
          invoice={invoiceToDelete}
          onClose={() => setInvoiceToDelete(null)}
          onSuccess={(msg) => {
            setInvoiceToDelete(null);
            setToast(msg || 'Invoice updated.');
            fetchInvoices();
          }}
        />
      )}
    </div>
  );
};
