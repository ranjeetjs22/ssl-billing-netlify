import React, { useState, useEffect, useCallback } from 'react';
import { CreditCard, Plus, Search, Printer, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiRequest } from '../services/api.js';
import { Payment, CompanySettings } from '../types.js';
import { formatINR } from '../utils/format.js';
import { printReceiptPDF } from '../utils/pdf.js';
import {
  Button, IconButton, Card, Metric, DataTable, Column, EmptyState, ErrorState, Input,
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
      cell: (p) => <span className="tabular-nums text-ink-soft whitespace-nowrap">{p.payment_date}</span>,
    },
    {
      key: 'customer',
      header: 'Customer',
      cell: (p) => <span className="font-medium text-ink truncate block max-w-[240px]">{p.customer_name || '-'}</span>,
    },
    {
      key: 'invoice',
      header: 'Invoice',
      cell: (p) => <span className="font-mono text-[13px] text-ink whitespace-nowrap">{p.invoice_no || '-'}</span>,
    },
    {
      key: 'method',
      header: 'Method',
      hideBelow: 'md',
      cell: (p) => <span className="text-ink-soft whitespace-nowrap">{p.method}</span>,
    },
    {
      key: 'reference',
      header: 'Reference',
      hideBelow: 'lg',
      cell: (p) => <span className="font-mono text-[13px] text-ink-faint truncate block max-w-[170px]">{p.reference || '-'}</span>,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (p) => <span className="tabular-nums font-medium text-positive-ink whitespace-nowrap">₹{formatINR(p.amount)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      className: 'w-12',
      cell: (p) => (
        <IconButton label={`Print receipt for ${p.invoice_no || 'payment'}`} onClick={() => printReceiptPDF(p, companySettings)}>
          <Printer />
        </IconButton>
      ),
    },
  ];

  const mobileCard = (p: Payment) => (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-medium text-sm text-ink truncate">{p.customer_name || '-'}</span>
          <span className="tabular-nums font-medium text-sm text-positive-ink shrink-0">₹{formatINR(p.amount)}</span>
        </div>
        <div className="text-xs text-ink-faint truncate mt-0.5">
          <span className="font-mono">{p.invoice_no || '-'}</span>
          {' · '}<span className="tabular-nums">{p.payment_date}</span>
          {' · '}{p.method}
          {p.reference && <> · <span className="font-mono">{p.reference}</span></>}
        </div>
      </div>
      <IconButton
        label={`Print receipt for ${p.invoice_no || 'payment'}`}
        onClick={(e) => { e.stopPropagation(); printReceiptPDF(p, companySettings); }}
        className="-mr-1"
      >
        <Printer />
      </IconButton>
    </div>
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="panel overflow-hidden grid grid-cols-2 divide-x divide-line">
        <Metric label="Receipts" value={<span className="tabular-nums">{total}</span>} loading={loading} />
        <Metric label="Amount realised" value={`₹${formatINR(received)}`} tone="positive" loading={loading} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-0 sm:max-w-sm">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none z-10" aria-hidden="true" />
          <Input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search UTR, customer or invoice"
            aria-label="Search payments"
            className="pl-8"
          />
        </div>
        <Button variant="primary" icon={<Plus />} onClick={onNewPayment} className="sm:ml-auto">
          <span className="sm:hidden">Record</span>
          <span className="hidden sm:inline">Record payment</span>
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
                icon={<CreditCard />}
                title={search ? 'No matching payments' : 'No payments recorded'}
                message={search ? 'Try a different search term.' : 'Payments you record against invoices will appear here.'}
                action={
                  search ? (
                    <Button variant="secondary" onClick={() => setSearchInput('')}>Clear search</Button>
                  ) : (
                    <Button variant="secondary" icon={<Plus />} onClick={onNewPayment}>Record payment</Button>
                  )
                }
              />
            }
          />
        )}

        {totalPages > 1 && !loadError && (
          <div className="flex items-center justify-between gap-3 px-3 sm:px-4 py-2 border-t border-line">
            <span className="text-xs text-ink-faint tabular-nums">
              Page <span className="text-ink font-medium">{page}</span> of {totalPages} · {total} receipts
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
    </div>
  );
};
