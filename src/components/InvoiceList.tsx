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
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [invoiceToDelete, setInvoiceToDelete] = useState<Invoice | null>(null);
  const [toast, setToast] = useState<string | null>(initialToastMessage || null);
  const [summary, setSummary] = useState({ count: 0, grand_total: 0, taxable: 0, gst: 0, balance: 0 });

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
  }, [statusFilter, search, page]);

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
    inv.lr_items && inv.lr_items.length > 1 ? `${inv.lr_items.length} LRs` : inv.lr_no || '—';

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
      key: 'buyer',
      header: 'Customer',
      cell: (inv) => (
        <div className="min-w-0">
          <div className="font-semibold text-ink truncate max-w-[220px]">{inv.buyer?.name || '—'}</div>
          <div className="text-xs text-ink-faint truncate">{inv.buyer?.city || inv.place_of_supply || '—'}</div>
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
            <div className="font-semibold text-ink truncate">{inv.buyer?.name || '—'}</div>
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
        <StatCard label="Invoices" value={summary.count} loading={loading} />
        <StatCard label="Taxable" value={`₹${formatINR(summary.taxable)}`} loading={loading} />
        <StatCard label="GST" value={`₹${formatINR(summary.gst)}`} loading={loading} />
        <StatCard label="Outstanding" value={`₹${formatINR(summary.balance)}`} tone="warning" loading={loading} />
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div
          role="tablist"
          aria-label="Filter invoices by status"
          className="flex items-center gap-1 bg-surface border border-line rounded-xl p-1 overflow-x-auto shadow-card"
        >
          {TABS.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={statusFilter === tab.key}
              onClick={() => { setStatusFilter(tab.key); setPage(1); }}
              className={cx(
                'px-3 min-h-[38px] rounded-lg text-sm font-medium whitespace-nowrap cursor-pointer transition-colors duration-150',
                statusFilter === tab.key
                  ? 'bg-accent-strong text-on-accent font-semibold'
                  : 'text-ink-soft hover:bg-surface-sunken hover:text-ink'
              )}
            >
              {tab.label}
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
