import React, { useState, useEffect, useCallback } from 'react';
import { CreditCard, Plus, Search, Printer, ChevronLeft, ChevronRight, Receipt } from 'lucide-react';
import { apiRequest } from '../services/api.js';
import { Payment, CompanySettings } from '../types.js';
import { formatINR } from '../utils/format.js';
import { printReceiptPDF } from '../utils/pdf.js';
import {
  Button, IconButton, Card, StatCard, DataTable, Column, EmptyState, ErrorState, Badge, Input,
} from './ui.js';

interface PaymentListProps {
  onNewPayment: () => void;
  companySettings: CompanySettings;
}

const PAGE_SIZE = 20;

export const PaymentList: React.FC<PaymentListProps> = ({ onNewPayment, companySettings }) => {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [received, setReceived] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      let url = `/payments?page=${page}&page_size=${PAGE_SIZE}`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      const res = await apiRequest<{ items: Payment[]; total: number; summary?: { received: number } }>(url);
      setPayments(res.items || []);
      setTotal(res.total || 0);
      setReceived(res.summary?.received ?? (res.items || []).reduce((a, p) => a + (p.amount || 0), 0));
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load payments');
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => { fetchPayments(); }, [fetchPayments]);

  const columns: Column<Payment>[] = [
    {
      key: 'date',
      header: 'Date',
      cell: (p) => <span className="font-mono text-ink-soft">{p.payment_date}</span>,
    },
    {
      key: 'customer',
      header: 'Customer',
      cell: (p) => <span className="font-semibold text-ink truncate block max-w-[220px]">{p.customer_name || '—'}</span>,
    },
    {
      key: 'invoice',
      header: 'Invoice',
      cell: (p) => <span className="font-mono font-bold text-accent-ink">{p.invoice_no || '—'}</span>,
    },
    {
      key: 'method',
      header: 'Method',
      hideBelow: 'md',
      cell: (p) => <Badge>{p.method}</Badge>,
    },
    {
      key: 'reference',
      header: 'Reference',
      hideBelow: 'lg',
      cell: (p) => <span className="font-mono text-xs text-ink-faint truncate block max-w-[150px]">{p.reference || '—'}</span>,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (p) => <span className="font-mono font-bold text-positive-ink">₹{formatINR(p.amount)}</span>,
    },
    {
      key: 'actions',
      header: 'Receipt',
      align: 'right',
      cell: (p) => (
        <IconButton label={`Print receipt for ${p.invoice_no || 'payment'}`} onClick={() => printReceiptPDF(p, companySettings)}>
          <Printer className="w-4 h-4" />
        </IconButton>
      ),
    },
  ];

  const mobileCard = (p: Payment) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-ink truncate">{p.customer_name || '—'}</div>
          <div className="font-mono text-xs text-accent-ink">{p.invoice_no || '—'}</div>
        </div>
        <span className="font-mono font-bold text-positive-ink text-base shrink-0">+₹{formatINR(p.amount)}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs text-ink-faint min-w-0">
          <span className="font-mono">{p.payment_date}</span>
          <Badge>{p.method}</Badge>
        </span>
        <IconButton
          label={`Print receipt for ${p.invoice_no || 'payment'}`}
          onClick={(e) => { e.stopPropagation(); printReceiptPDF(p, companySettings); }}
        >
          <Printer className="w-4 h-4" />
        </IconButton>
      </div>
    </div>
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <StatCard label="Receipts" value={total} icon={<Receipt className="w-4 h-4" />} loading={loading} />
        <StatCard label="Amount realised" value={`₹${formatINR(received)}`} tone="positive" loading={loading} />
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none z-10" aria-hidden="true" />
          <Input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search reference, customer or invoice"
            aria-label="Search payments"
            className="pl-9"
          />
        </div>
        <Button variant="success" size="sm" icon={<Plus className="w-4 h-4" />} onClick={onNewPayment} className="sm:ml-auto">
          Record Payment
        </Button>
      </div>

      <Card padded={false} className="overflow-hidden">
        {loadError ? (
          <ErrorState message={loadError} onRetry={fetchPayments} />
        ) : (
          <DataTable
            rows={payments}
            columns={columns}
            loading={loading}
            mobileCard={mobileCard}
            caption="Payment receipts"
            empty={
              <EmptyState
                icon={<CreditCard className="w-6 h-6" />}
                title={search ? 'No matching payments' : 'No payments recorded'}
                message={search ? 'Try a different search term.' : 'Payments you record against invoices will appear here.'}
                action={
                  search ? (
                    <Button variant="secondary" onClick={() => setSearchInput('')}>Clear search</Button>
                  ) : (
                    <Button variant="success" icon={<Plus className="w-4 h-4" />} onClick={onNewPayment}>Record Payment</Button>
                  )
                }
              />
            }
          />
        )}

        {totalPages > 1 && !loadError && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-line bg-surface-muted">
            <span className="text-xs text-ink-faint">
              Page <strong className="text-ink">{page}</strong> of {totalPages} · {total} receipts
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
    </div>
  );
};
