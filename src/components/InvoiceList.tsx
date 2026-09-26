import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Search, Download, FileText, Printer, CreditCard, Trash2,
  Edit3, ChevronLeft, ChevronRight, Truck,
} from 'lucide-react';
import { apiRequest } from '../services/api.js';
import { Invoice, CompanySettings, BankAccount } from '../types.js';
import { formatINR } from '../utils/format.js';
import { printInvoicePDF } from '../utils/pdf.js';
import { DeleteInvoiceModal } from './DeleteInvoiceModal.js';
import {
  Button, IconButton, Card, StatCard, DataTable, Column, EmptyState, ErrorState,
  Toast, StatusBadge, Input, cx,
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
      const res = await apiRequest<{ items: Invoice[]; total: number; summary: any }>(url);
      setInvoices(res.items || []);
      setTotal(res.total || 0);
      if (res.summary) setSummary(res.summary);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, docFilter, search, page]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);
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
            <span className="font-mono font-bold text-accent-ink truncate">{inv.invoice_no}</span>
            {inv.doc_type === 'internal' && (
              <span className="shrink-0 px-1.5 py-px rounded-[4px] border border-line text-[10px] font-semibold text-ink-soft">NON-GST</span>
            )}
          </div>
          <div className="text-xs text-ink-faint">{inv.invoice_date}</div>
        </div>
      ),
    },
    {
      key: 'buyer',
      header: 'Customer',
      cell: (inv) => (
        <div className="min-w-0">
          <div className="font-semibold text-ink truncate max-w-[220px]">{inv.buyer?.name || '-'}</div>
          <div className="text-xs text-ink-faint truncate">{inv.buyer?.city || inv.place_of_supply || '-'}</div>
        </div>
      ),
    },
    {
      key: 'lr',
      header: 'LR / Route',
      hideBelow: 'lg',
      cell: (inv) => (
        <div className="min-w-0">
          <div className="font-mono text-ink-soft truncate max-w-[160px]" title={inv.lr_no}>{lrLabel(inv)}</div>
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
        <span className="font-mono font-bold text-ink">₹{formatINR(inv.totals?.grand_total ?? inv.grand_total)}</span>
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
          <span className={cx('font-mono font-semibold', bal > 0.5 ? 'text-warning-ink' : 'text-positive-ink')}>
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
          <div className="leading-tight">
            <div className={cx('font-mono font-semibold', gp < 0 ? 'text-danger-ink' : 'text-positive-ink')}>₹{formatINR(gp)}</div>
            {m !== null && m !== undefined && <div className="text-[11px] text-ink-faint">{m}%</div>}
          </div>
        );
      },
    },
    { key: 'status', header: 'Status', align: 'center', cell: (inv) => <StatusBadge status={inv.display_status} /> },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (inv) => (
        <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <IconButton label={`Print invoice ${inv.invoice_no}`} onClick={() => printInvoicePDF(inv, companySettings, defaultBank)}>
            <Printer className="w-4 h-4" />
          </IconButton>
          {inv.display_status !== 'cancelled' && onEditInvoice && (
            <IconButton label={`Edit invoice ${inv.invoice_no}`} onClick={() => onEditInvoice(inv)}>
              <Edit3 className="w-4 h-4" />
            </IconButton>
          )}
          {inv.display_status !== 'paid' && inv.display_status !== 'cancelled' && (
            <IconButton
              label={`Record payment for ${inv.invoice_no}`}
              onClick={() => onRecordPayment(inv)}
              className="text-positive hover:bg-positive-soft"
            >
              <CreditCard className="w-4 h-4" />
            </IconButton>
          )}
          <IconButton
            label={`Delete invoice ${inv.invoice_no}`}
            onClick={() => setInvoiceToDelete(inv)}
            className="text-danger hover:bg-danger-soft"
          >
            <Trash2 className="w-4 h-4" />
          </IconButton>
        </div>
      ),
    },
  ];

  const mobileCard = (inv: Invoice) => {
    const bal = inv.balance ?? inv.grand_total ?? 0;
    return (
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono font-bold text-accent-ink text-sm truncate">{inv.invoice_no}</div>
            <div className="font-semibold text-ink truncate">{inv.buyer?.name || '-'}</div>
          </div>
          <StatusBadge status={inv.display_status} />
        </div>

        <div className="flex items-center gap-2 text-xs text-ink-faint">
          <span>{inv.invoice_date}</span>
          {(inv.lr_no || inv.lr_items?.length) ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 truncate">
                <Truck className="w-3 h-3 shrink-0" aria-hidden="true" />
                {lrLabel(inv)}
              </span>
            </>
          ) : null}
        </div>

        <div className="flex items-end justify-between gap-3 pt-2 border-t border-line">
          <span className="text-xs text-ink-faint">
            Total{' '}
            <span className="font-mono font-semibold text-ink">
              ₹{formatINR(inv.totals?.grand_total ?? inv.grand_total)}
            </span>
          </span>
          <span className="text-right">
            <span className="block text-[11px] text-ink-faint">Balance</span>
            <span className={cx('font-mono font-bold', bal > 0.5 ? 'text-warning-ink' : 'text-positive-ink')}>
              ₹{formatINR(bal)}
            </span>
          </span>
        </div>
      </div>
    );
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4 sm:space-y-5">
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Bills" value={summary.count} loading={loading}
          sub={`${summary.gst_count} GST · ${summary.non_gst_count} non-GST`} />
        <StatCard label="Revenue (ex-GST)" value={`₹${formatINR(summary.taxable)}`} loading={loading}
          sub={`GST ₹${formatINR(summary.gst)}`} />
        <StatCard label="Gross profit" value={`₹${formatINR(summary.gross_profit)}`} tone="positive" loading={loading}
          sub={summary.uncosted ? `${summary.uncosted} bill(s) not costed` : `Cost ₹${formatINR(summary.total_cost)}`} />
        <StatCard label="Outstanding" value={`₹${formatINR(summary.balance)}`} tone="warning" loading={loading} />
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div
          role="tablist"
          aria-label="Filter invoices by status"
          className="flex items-center gap-1 bg-surface border border-line rounded-card p-1 overflow-x-auto shadow-card"
        >
          {TABS.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={statusFilter === tab.key}
              onClick={() => { setStatusFilter(tab.key); setPage(1); }}
              className={cx(
                'px-3 min-h-[38px] rounded-control text-sm font-medium whitespace-nowrap cursor-pointer transition-colors duration-150',
                statusFilter === tab.key
                  ? 'bg-accent-strong text-on-accent font-semibold'
                  : 'text-ink-soft hover:bg-surface-sunken hover:text-ink'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div role="tablist" aria-label="Filter by bill type"
          className="flex items-center gap-0.5 p-0.5 rounded-control bg-surface-sunken border border-line shrink-0">
          {([['all', 'All'], ['tax_invoice', 'GST'], ['internal', 'Non-GST']] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={docFilter === k}
              onClick={() => { setDocFilter(k); setPage(1); }}
              className={cx('px-3 h-8 rounded-[6px] text-[13px] whitespace-nowrap cursor-pointer transition-colors',
                docFilter === k ? 'bg-surface-muted text-ink font-medium shadow-card' : 'text-ink-faint hover:text-ink')}>
              {label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 lg:max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none z-10" aria-hidden="true" />
          <Input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search invoice, LR or customer"
            aria-label="Search invoices"
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-2 lg:ml-auto">
          <Button variant="secondary" size="sm" icon={<Download className="w-4 h-4" />} onClick={handleExportCSV}>
            Export CSV
          </Button>
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
                icon={<FileText className="w-6 h-6" />}
                title={search || statusFilter !== 'all' ? 'No matching invoices' : 'No invoices yet'}
                message={
                  search || statusFilter !== 'all'
                    ? 'Try a different search term or filter.'
                    : 'Create your first GST tax invoice to get started.'
                }
                action={
                  search || statusFilter !== 'all' ? (
                    <Button variant="secondary" onClick={() => { setSearchInput(''); setStatusFilter('all'); }}>
                      Clear filters
                    </Button>
                  ) : (
                    <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={onNewInvoice}>
                      New Invoice
                    </Button>
                  )
                }
              />
            }
          />
        )}

        {totalPages > 1 && !loadError && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-line bg-surface-muted">
            <span className="text-xs text-ink-faint">
              Page <strong className="text-ink">{page}</strong> of {totalPages} · {total} invoices
            </span>
            <div className="flex items-center gap-1">
              <IconButton label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} variant="secondary">
                <ChevronLeft className="w-4 h-4" />
              </IconButton>
              <IconButton label="Next page" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} variant="secondary">
                <ChevronRight className="w-4 h-4" />
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
