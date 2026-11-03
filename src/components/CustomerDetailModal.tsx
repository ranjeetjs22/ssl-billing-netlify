import React, { useState, useEffect } from 'react';
import {
  Printer,
  Plus,
  Share2,
  Copy,
  Check,
  ArrowUpRight,
  Trash2,
  Pencil,
} from 'lucide-react';
import { Customer, Invoice, Payment, CompanySettings, BankAccount, CustomerStatementResponse, CustomerLedgerEntry } from '../types.js';
import { formatINR } from '../utils/format.js';
import { printStatementPDF, printInvoicePDF } from '../utils/pdf.js';
import { apiRequest } from '../services/api.js';
import { DeleteInvoiceModal } from './DeleteInvoiceModal.js';
import {
  Modal, Button, IconButton, Badge, StatusBadge, Segmented, MetricStrip, Metric, Input, Select, FormError,
  EmptyState, SkeletonRows, cx,
} from './ui.js';

const inr = (n: number | undefined | null) => `₹${formatINR(n)}`;

const PERIOD_OPTIONS: { value: string; label: string }[] = [
  { value: 'current_month', label: 'This month' },
  { value: 'prev_month', label: 'Last month' },
  { value: 'last_3_months', label: 'Last 3 months' },
  { value: 'fy', label: 'This FY' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom' },
];

/** Phone action: icon over a short label, five across under the header. */
const PhoneAction: React.FC<{
  icon: React.ReactNode;
  label: string;
  title: string;
  onClick: () => void;
  primary?: boolean;
}> = ({ icon, label, title, onClick, primary }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className={cx(
      'flex flex-col items-center justify-center gap-1 h-14 rounded-control border text-[11px] font-medium cursor-pointer',
      'transition-colors duration-[var(--duration-fast)] [&_svg]:w-4 [&_svg]:h-4',
      primary
        ? 'bg-accent-strong border-accent-strong text-on-accent hover:bg-accent-strong-hover'
        : 'bg-surface border-line text-ink hover:bg-surface-muted'
    )}
  >
    <span aria-hidden="true">{icon}</span>
    <span className="leading-none">{label}</span>
  </button>
);

/** Label over value, for the customer info tab. */
const KV: React.FC<{ label: string; value: React.ReactNode; mono?: boolean; wide?: boolean }> = ({ label, value, mono, wide }) => (
  <div className={cx('min-w-0', wide && 'sm:col-span-2')}>
    <dt className="text-xs text-ink-faint">{label}</dt>
    <dd className={cx('mt-0.5 text-sm text-ink break-words', mono && 'font-mono text-[13px]')}>{value || '-'}</dd>
  </div>
);

/** Small "label  figure" pair used in tab toolbars. */
const Total: React.FC<{ label: string; value: React.ReactNode; className?: string }> = ({ label, value, className }) => (
  <span className="text-xs text-ink-faint whitespace-nowrap">
    {label} <span className={cx('tabular-nums font-medium text-sm', className || 'text-ink')}>{value}</span>
  </span>
);

const th = 'h-8 px-2.5 first:pl-4 last:pr-3 text-xs font-medium text-ink-faint whitespace-nowrap';
const td = 'py-2 px-2.5 first:pl-4 last:pr-3 align-middle';

/** LR numbers are stored either bare ("4410") or prefixed ("LR-4410"). */
const lrText = (lr?: string | null) => (lr ? (/^lr/i.test(String(lr)) ? String(lr) : `LR ${lr}`) : '');

interface CustomerDetailModalProps {
  customer: Customer;
  onClose: () => void;
  onNewInvoice: (customer: Customer) => void;
  /** Open the edit form for this customer. */
  onEditCustomer?: (customer: Customer) => void;
  /** Open one of this customer's invoices. */
  onSelectInvoice?: (invoice: Invoice) => void;
  companySettings: CompanySettings;
  /** Called after a change that affects balances, so the screens behind refresh too. */
  onRefresh?: () => void;
}


export const CustomerDetailModal: React.FC<CustomerDetailModalProps> = ({
  customer: initialCustomer,
  onClose,
  onNewInvoice,
  onEditCustomer,
  onSelectInvoice,
  companySettings,
  onRefresh,
}) => {
  const [customer, setCustomer] = useState<Customer>(initialCustomer);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [ledger, setLedger] = useState<CustomerLedgerEntry[]>([]);
  const [summary, setSummary] = useState<any>({
    opening_balance: 0,
    period_invoiced: 0,
    period_taxable: 0,
    period_gst: 0,
    period_received: 0,
    closing_balance: 0,
    total_overall_outstanding: 0,
    overdue_amount: 0,
    invoice_count: 0,
  });
  const [periodLabel, setPeriodLabel] = useState<string>('All Time');
  const [activeTab, setActiveTab] = useState<'invoices' | 'ledger' | 'payments' | 'profile'>('invoices');
  const [invFilter, setInvFilter] = useState<'all' | 'unpaid' | 'overdue' | 'paid'>('all');
  const [rateChart, setRateChart] = useState<{ exists: boolean; use_custom: boolean } | null>(null);
  // Deleting a receipt entered by mistake. Held until confirmed - a payment deletion
  // moves money on the customer's account, so it is never one click.
  const [paymentToDelete, setPaymentToDelete] = useState<
    { id: string; amount: number; date: string; label: string } | null
  >(null);
  const [deletingPayment, setDeletingPayment] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [copied, setCopied] = useState(false);
  const [invoiceToDelete, setInvoiceToDelete] = useState<Invoice | null>(null);

  // Period Filter State
  const today = new Date();
  const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  
  // Calculate previous month
  const prevMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const prevMonthStr = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;

  // Open on the full history so every bill of this customer is listed
  const [periodFilterType, setPeriodFilterType] = useState<string>('all'); // 'current_month' | 'prev_month' | 'last_3_months' | 'fy' | 'all' | 'custom'
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');

  // Fetch Bank Accounts for remittance info
  useEffect(() => {
    const loadBanks = async () => {
      try {
        const res = await apiRequest<any>('/settings/banks');
        const list = Array.isArray(res) ? res : (res?.accounts || res?.items || []);
        setBankAccounts(list);
      } catch (e) {
        console.warn('Failed to fetch bank accounts', e);
        setBankAccounts([]);
      }
    };
    loadBanks();
  }, []);

  const defaultBank = Array.isArray(bankAccounts) && bankAccounts.length > 0 
    ? (bankAccounts.find(b => b.is_default) || bankAccounts[0]) 
    : undefined;

  // Fetch Statement Data based on selected period
  const fetchCustomerStatement = async () => {
    setLoading(true);
    try {
      let queryParams = '';
      if (periodFilterType === 'current_month') {
        queryParams = `?month=${currentMonthStr}`;
      } else if (periodFilterType === 'prev_month') {
        queryParams = `?month=${prevMonthStr}`;
      } else if (periodFilterType === 'last_3_months') {
        const threeMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 2, 1);
        const sDate = `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, '0')}-01`;
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
        const eDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        queryParams = `?start_date=${sDate}&end_date=${eDate}`;
      } else if (periodFilterType === 'fy') {
        // Indian Financial Year: Apr 1 of current or previous year to Mar 31
        const currentYear = today.getFullYear();
        const fyStartYear = today.getMonth() >= 3 ? currentYear : currentYear - 1;
        const sDate = `${fyStartYear}-04-01`;
        const eDate = `${fyStartYear + 1}-03-31`;
        queryParams = `?start_date=${sDate}&end_date=${eDate}`;
      } else if (periodFilterType === 'custom') {
        if (customStartDate && customEndDate) {
          queryParams = `?start_date=${customStartDate}&end_date=${customEndDate}`;
        }
      }

      const res = await apiRequest<CustomerStatementResponse>(`/customers/${initialCustomer.id}/statement${queryParams}`);
      if (res) {
        setCustomer(res.customer || initialCustomer);
        setInvoices(res.invoices || []);
        setPayments(res.payments || []);
        setLedger(res.ledger || []);
        setSummary(res.summary || {});
        setPeriodLabel(res.period?.label || 'Selected Period');
      }
    } catch (err) {
      console.error('Failed to load customer statement', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomerStatement();
  }, [initialCustomer.id, periodFilterType]);

  // Which rate chart this customer is billed on, for the profile tab
  useEffect(() => {
    apiRequest<{ customer_id: string; exists: boolean; use_custom: boolean }[]>('/rates/customer-cards')
      .then(list => {
        const row = (list || []).find(r => r.customer_id === initialCustomer.id);
        setRateChart(row ? { exists: true, use_custom: row.use_custom } : { exists: false, use_custom: false });
      })
      .catch(() => setRateChart(null));
  }, [initialCustomer.id]);

  const shownInvoices = invoices.filter(inv => {
    const st = inv.display_status || 'issued';
    if (invFilter === 'paid') return st === 'paid';
    if (invFilter === 'overdue') return st === 'overdue';
    if (invFilter === 'unpaid') return ['issued', 'partially_paid', 'overdue'].includes(st);
    return true;
  });
  const countBy = (f: typeof invFilter) => invoices.filter(inv => {
    const st = inv.display_status || 'issued';
    if (f === 'paid') return st === 'paid';
    if (f === 'overdue') return st === 'overdue';
    if (f === 'unpaid') return ['issued', 'partially_paid', 'overdue'].includes(st);
    return true;
  }).length;

  useEffect(() => {
    if (!actionMessage) return;
    const t = setTimeout(() => setActionMessage(null), 5000);
    return () => clearTimeout(t);
  }, [actionMessage]);

  /** Remove a receipt. The server re-syncs the invoice status and balance. */
  const confirmDeletePayment = async () => {
    if (!paymentToDelete) return;
    setDeletingPayment(true);
    setDeleteError(null);
    try {
      await apiRequest(`/payments/${paymentToDelete.id}`, { method: 'DELETE' });
      setPaymentToDelete(null);
      setActionMessage(
        `Receipt of ₹${formatINR(paymentToDelete.amount)} dated ${paymentToDelete.date} was removed. Balances updated.`
      );
      await fetchCustomerStatement();
      onRefresh?.();
    } catch (err: any) {
      setDeleteError(err.message || 'Could not remove this payment.');
    } finally {
      setDeletingPayment(false);
    }
  };

  // Handle Custom Date Range Submit
  const handleApplyCustomDates = (e: React.FormEvent) => {
    e.preventDefault();
    if (customStartDate && customEndDate) {
      fetchCustomerStatement();
    }
  };

  // Generate WhatsApp Message
  const generateWhatsAppMessage = () => {
    const compName = companySettings.name || 'SHREE SANWARIYA LOGISTICS';
    let text = `*MONTHLY STATEMENT & OUTSTANDING REPORT*\n`;
    text += `*From:* ${compName}\n`;
    text += `*To:* ${customer.name}\n`;
    text += `*Period:* ${periodLabel}\n`;
    text += `----------------------------------------\n`;
    text += `*Opening Balance:* Rs. ${formatINR(summary.opening_balance)}\n`;
    text += `*Invoices in Period (${invoices.length}):* Rs. ${formatINR(summary.period_invoiced)}\n`;
    text += `*Payments Realised in Period:* Rs. ${formatINR(summary.period_received)}\n`;
    text += `*NET OUTSTANDING BALANCE:* *Rs. ${formatINR(summary.closing_balance)}*\n`;
    text += `----------------------------------------\n\n`;

    if (invoices.length > 0) {
      text += `*Tax Invoices Breakdown:*\n`;
      invoices.forEach((inv, i) => {
        const lr = inv.lr_no ? ` | LR #${inv.lr_no}` : '';
        const route = (inv.origin && inv.destination) ? ` (${inv.origin} → ${inv.destination})` : '';
        text += `${i + 1}. *Inv #${inv.invoice_no}* (${inv.invoice_date})${lr}${route}: Rs. ${formatINR(inv.grand_total)} (Bal: Rs. ${formatINR(inv.balance ?? inv.grand_total)})\n`;
      });
      text += `\n`;
    }

    if (defaultBank && defaultBank.account_number) {
      text += `*Bank Account Details for Remittance:*\n`;
      text += `*Bank:* ${defaultBank.bank_name}\n`;
      text += `*Account Name:* ${defaultBank.account_holder}\n`;
      text += `*A/C No:* ${defaultBank.account_number}\n`;
      text += `*IFSC:* ${defaultBank.ifsc || '-'}\n`;
      if (defaultBank.upi_id) text += `*UPI ID:* ${defaultBank.upi_id}\n`;
      text += `\n`;
    }

    text += `Please verify and confirm the settlement at your earliest convenience. Thank you for your business!`;
    return text;
  };

  const handleShareWhatsApp = () => {
    const text = generateWhatsAppMessage();
    const phone = customer.whatsapp || customer.phone || '';
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const fullPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    const url = fullPhone 
      ? `https://wa.me/${fullPhone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  const handleCopyText = () => {
    const text = generateWhatsAppMessage();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };


  const printStatement = () => printStatementPDF(customer, ledger, summary, companySettings, periodLabel, invoices, defaultBank);
  const newBill = () => {
    onClose();
    onNewInvoice(customer);
  };
  const askDeletePayment = (p: { id: string; amount: number; date: string; label: string }) => {
    setDeleteError(null);
    setPaymentToDelete(p);
  };
  const closing = Number(summary.closing_balance || 0);
  const location = [customer.city, customer.state].filter(Boolean).join(', ') || 'Gujarat';

  const tabs = [
    { key: 'invoices', label: 'Invoices', count: invoices.length },
    { key: 'ledger', label: 'Ledger', count: ledger.length },
    { key: 'payments', label: 'Payments', count: payments.length },
    { key: 'profile', label: 'Customer info' },
  ] as const;

  const invFilterOptions = ([
    ['all', 'All'], ['unpaid', 'Unpaid'], ['overdue', 'Overdue'], ['paid', 'Paid'],
  ] as const).map(([value, label]) => ({ value, label, count: countBy(value) }));

  const deleteBtn = (onClick: () => void, aria: string) => (
    <IconButton
      label={aria}
      title="Delete this receipt"
      onClick={onClick}
      className="text-ink-faint hover:text-danger-ink hover:bg-danger-soft"
    >
      <Trash2 />
    </IconButton>
  );

  return (
    <>
      <Modal
        onClose={onClose}
        title={customer.name}
        subtitle={periodLabel}
        size="xl"
        headerActions={
          <div className="hidden md:flex items-center gap-1.5 mr-1">
            <Button size="sm" variant="primary" icon={<Printer />} onClick={printStatement} title="Download official PDF statement">
              Print statement
            </Button>
            <Button size="sm" icon={<Share2 />} onClick={handleShareWhatsApp} title="Share statement breakdown directly via WhatsApp">
              WhatsApp
            </Button>
            <Button size="sm" icon={copied ? <Check className="text-positive-ink" /> : <Copy />} onClick={handleCopyText}
              title="Copy statement summary to clipboard">
              {copied ? 'Copied' : 'Copy'}
            </Button>
            {onEditCustomer && (
              <Button size="sm" icon={<Pencil />} onClick={() => onEditCustomer(customer)} title="Edit this customer's details">
                Edit
              </Button>
            )}
            <Button size="sm" icon={<Plus />} onClick={newBill} title="Raise a new bill for this customer">
              New bill
            </Button>
            <span className="w-px h-5 bg-line ml-1" aria-hidden="true" />
          </div>
        }
        footer={
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-ink-faint min-w-0 truncate">
              <span className="hidden sm:inline">{periodLabel} · </span>
              Outstanding{' '}
              <span className={cx('tabular-nums font-medium text-sm', closing > 0.01 ? 'text-warning-ink' : 'text-ink')}>
                {inr(summary.closing_balance)}
              </span>
            </p>
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Who this is */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-faint">
              <span>
                GSTIN <span className="font-mono text-[13px] text-ink">{customer.gstin || 'Unregistered'}</span>
              </span>
              <span className="text-ink-soft">{location}</span>
              {customer.phone && (
                <>
                  <a href={`tel:${customer.phone}`} className="text-ink-soft tabular-nums hover:text-accent-ink">{customer.phone}</a>
                </>
              )}
              <span>
                Total outstanding <span className="tabular-nums font-medium text-sm text-ink">{inr(summary.total_overall_outstanding)}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <Badge>{customer.payment_terms || 'Net 15 Days'}</Badge>
                {customer.credit_limit ? <Badge>Limit {inr(customer.credit_limit)}</Badge> : null}
              </span>
            </div>

            {/* Phone and small tablet: the header actions live here */}
            <div className={cx('md:hidden grid gap-1.5', onEditCustomer ? 'grid-cols-5' : 'grid-cols-4')}>
              <PhoneAction primary icon={<Printer />} label="Print" title="Download official PDF statement" onClick={printStatement} />
              <PhoneAction icon={<Share2 />} label="WhatsApp" title="Share statement on WhatsApp" onClick={handleShareWhatsApp} />
              <PhoneAction icon={copied ? <Check className="text-positive-ink" /> : <Copy />} label={copied ? 'Copied' : 'Copy'}
                title="Copy statement summary" onClick={handleCopyText} />
              {onEditCustomer && (
                <PhoneAction icon={<Pencil />} label="Edit" title="Edit this customer's details" onClick={() => onEditCustomer(customer)} />
              )}
              <PhoneAction icon={<Plus />} label="New bill" title="Raise a new bill" onClick={newBill} />
            </div>
          </div>

          {/* Statement period */}
          <div className="flex flex-col lg:flex-row lg:items-center gap-2">
            <Select
              aria-label="Statement period"
              value={periodFilterType}
              onChange={(e) => setPeriodFilterType(e.target.value)}
              className="sm:hidden"
            >
              {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <div className="hidden sm:block">
              <Segmented
                label="Statement period"
                options={PERIOD_OPTIONS}
                value={periodFilterType}
                onChange={setPeriodFilterType}
              />
            </div>
            {periodFilterType === 'custom' && (
              <form onSubmit={handleApplyCustomDates} className="flex items-center gap-1.5">
                <Input type="date" value={customStartDate} onChange={e => setCustomStartDate(e.target.value)}
                  required aria-label="From date" className="w-auto min-w-0 flex-1 sm:flex-none sm:w-[150px] sm:h-8" />
                <span className="text-xs text-ink-faint">to</span>
                <Input type="date" value={customEndDate} onChange={e => setCustomEndDate(e.target.value)}
                  required aria-label="To date" className="w-auto min-w-0 flex-1 sm:flex-none sm:w-[150px] sm:h-8" />
                <Button type="submit" size="sm">Apply</Button>
              </form>
            )}
          </div>

          {/* Period summary */}
          <MetricStrip>
            <Metric label="Opening balance" value={inr(summary.opening_balance)} compare="Before period start" />
            <Metric
              label="Invoiced"
              value={inr(summary.period_invoiced)}
              compare={`${invoices.length} bill${invoices.length === 1 ? '' : 's'} · GST ${inr(summary.period_gst)}`}
            />
            <Metric
              label="Received"
              tone="positive"
              value={inr(summary.period_received)}
              compare={`${payments.length} receipt${payments.length === 1 ? '' : 's'}`}
            />
            <Metric
              label="Closing balance"
              tone={closing > 0.01 ? 'warning' : 'positive'}
              value={inr(summary.closing_balance)}
              compare={summary.overdue_amount > 0
                ? <span className="text-danger-ink">{inr(summary.overdue_amount)} overdue</span>
                : 'Net outstanding for the period'}
            />
          </MetricStrip>

          {/* Views */}
          <div role="tablist" aria-label="Statement views"
            className="flex gap-5 border-b border-line overflow-x-auto scrollbar-none">
            {tabs.map((t) => {
              const on = activeTab === t.key;
              return (
                <button
                  key={t.key}
                  role="tab"
                  type="button"
                  aria-selected={on}
                  onClick={() => setActiveTab(t.key)}
                  className={cx(
                    'h-9 -mb-px border-b-2 text-sm whitespace-nowrap cursor-pointer inline-flex items-center gap-1.5',
                    'transition-colors duration-[var(--duration-fast)]',
                    on ? 'border-ink text-ink font-medium' : 'border-transparent text-ink-faint hover:text-ink'
                  )}
                >
                  {t.key === 'profile' ? <><span className="sm:hidden">Info</span><span className="hidden sm:inline">{t.label}</span></> : t.label}
                  {'count' in t && <span className="text-xs text-ink-faint tabular-nums">{t.count}</span>}
                </button>
              );
            })}
          </div>

          {actionMessage && (
            <div role="status" aria-live="polite"
              className="px-3 py-2 bg-positive-soft border border-positive-line rounded-control text-positive-ink text-sm flex items-start gap-2">
              <Check className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{actionMessage}</span>
            </div>
          )}

          {loading ? (
            <div className="panel overflow-hidden" role="status" aria-label="Loading statement">
              <SkeletonRows rows={4} />
            </div>
          ) : (
            <>
              {/* Invoices */}
              {activeTab === 'invoices' && (
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Segmented<typeof invFilter> size="sm" label="Filter invoices" options={invFilterOptions} value={invFilter} onChange={setInvFilter} />
                    <div className="flex items-center gap-3">
                      {onSelectInvoice && <span className="hidden lg:inline text-xs text-ink-faint">Click a bill to open it</span>}
                      <Total label="Invoiced" value={inr(summary.period_invoiced)} />
                    </div>
                  </div>

                  <div className="panel overflow-hidden">
                    {shownInvoices.length === 0 ? (
                      <EmptyState
                        title={invoices.length === 0 ? 'No invoices' : 'No invoices match'}
                        message={invoices.length === 0
                          ? `No invoices for this customer in ${periodLabel}.`
                          : 'No invoices match this filter.'}
                      />
                    ) : (
                      <>
                        {/* Phone: one row per bill */}
                        <ul className="md:hidden divide-y divide-line">
                          {shownInvoices.map((inv) => {
                            const bal = inv.balance ?? inv.grand_total;
                            return (
                              <li key={inv.id} className="flex items-center gap-1 pr-1.5">
                                <div
                                  role={onSelectInvoice ? 'button' : undefined}
                                  tabIndex={onSelectInvoice ? 0 : undefined}
                                  onClick={onSelectInvoice ? () => onSelectInvoice(inv) : undefined}
                                  onKeyDown={onSelectInvoice ? (e) => { if (e.key === 'Enter') onSelectInvoice(inv); } : undefined}
                                  className={cx('flex-1 min-w-0 flex items-start gap-3 pl-3 py-2.5', onSelectInvoice && 'cursor-pointer active:bg-surface-muted')}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="font-mono text-[13px] text-ink truncate">{inv.invoice_no}</span>
                                      <StatusBadge status={inv.display_status} />
                                    </div>
                                    <div className="text-xs text-ink-faint truncate mt-0.5">
                                      <span className="tabular-nums">{inv.invoice_date}</span>
                                      {inv.lr_no && <> · <span className="font-mono">{lrText(inv.lr_no)}</span></>}
                                      {inv.origin && inv.destination && <> · {inv.origin} → {inv.destination}</>}
                                    </div>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <div className={cx('tabular-nums font-medium text-sm', (Number(bal) || 0) > 0.01 ? 'text-warning-ink' : 'text-ink')}>
                                      {inr(bal)}
                                    </div>
                                    <div className="text-xs text-ink-faint tabular-nums mt-0.5">
                                      of {inr(inv.grand_total || inv.totals?.grand_total)}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex flex-col shrink-0">
                                  <IconButton label={`Print invoice ${inv.invoice_no}`} onClick={() => printInvoicePDF(inv, companySettings, defaultBank)}>
                                    <Printer />
                                  </IconButton>
                                  <IconButton label={`Cancel or delete invoice ${inv.invoice_no}`} onClick={() => setInvoiceToDelete(inv)}
                                    className="hover:text-danger-ink hover:bg-danger-soft">
                                    <Trash2 />
                                  </IconButton>
                                </div>
                              </li>
                            );
                          })}
                        </ul>

                        {/* Tablet and desktop: the full table */}
                        <div className="hidden md:block overflow-x-auto">
                          <table className="w-full text-left text-sm">
                            <caption className="sr-only">Invoices for {periodLabel}</caption>
                            <thead className="bg-surface-muted border-b border-line">
                              <tr>
                                <th scope="col" className={th}>Date</th>
                                <th scope="col" className={th}>Invoice · LR · route</th>
                                <th scope="col" className={cx(th, 'text-right hidden lg:table-cell')}>Taxable</th>
                                <th scope="col" className={cx(th, 'text-right hidden lg:table-cell')}>GST</th>
                                <th scope="col" className={cx(th, 'text-right')}>Total</th>
                                <th scope="col" className={cx(th, 'text-right')}>Paid</th>
                                <th scope="col" className={cx(th, 'text-right')}>Balance</th>
                                <th scope="col" className={th}>Status</th>
                                <th scope="col" className={th}><span className="sr-only">Actions</span></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                              {shownInvoices.map((inv) => {
                                const bal = inv.balance ?? inv.grand_total;
                                return (
                                  <tr key={inv.id}
                                    onClick={onSelectInvoice ? () => onSelectInvoice(inv) : undefined}
                                    className={cx('transition-colors duration-[var(--duration-fast)]',
                                      onSelectInvoice && 'cursor-pointer hover:bg-surface-muted')}>
                                    <td className={cx(td, 'text-ink-soft tabular-nums whitespace-nowrap')}>{inv.invoice_date}</td>
                                    <td className={cx(td, 'max-w-[260px]')}>
                                      <div className="font-mono text-[13px] text-ink whitespace-nowrap">{inv.invoice_no}</div>
                                      <div className="text-xs text-ink-faint truncate">
                                        {inv.lr_no && <span className="font-mono">{lrText(inv.lr_no)}</span>}
                                        {inv.lr_no && ' · '}
                                        {inv.origin && inv.destination ? (
                                          <span>{inv.origin} → {inv.destination}</span>
                                        ) : inv.vehicle_no ? (
                                          <span className="font-mono">{inv.vehicle_no}</span>
                                        ) : (
                                          <span>Logistics service</span>
                                        )}
                                      </div>
                                    </td>
                                    <td className={cx(td, 'text-right tabular-nums text-ink-soft hidden lg:table-cell whitespace-nowrap')}>
                                      {inr(inv.taxable_amount || inv.totals?.taxable_amount)}
                                    </td>
                                    <td className={cx(td, 'text-right tabular-nums text-ink-soft hidden lg:table-cell whitespace-nowrap')}>
                                      {inr(inv.gst_amount || inv.totals?.gst_amount)}
                                    </td>
                                    <td className={cx(td, 'text-right tabular-nums font-medium text-ink whitespace-nowrap')}>
                                      {inr(inv.grand_total || inv.totals?.grand_total)}
                                    </td>
                                    <td className={cx(td, 'text-right tabular-nums text-ink-soft whitespace-nowrap')}>
                                      {inr(inv.paid ?? 0)}
                                    </td>
                                    <td className={cx(td, 'text-right tabular-nums font-medium whitespace-nowrap',
                                      (Number(bal) || 0) > 0.01 ? 'text-warning-ink' : 'text-ink')}>
                                      {inr(bal)}
                                    </td>
                                    <td className={td}><StatusBadge status={inv.display_status} /></td>
                                    <td className={cx(td, 'text-right whitespace-nowrap')} onClick={(e) => e.stopPropagation()}>
                                      <span className="inline-flex items-center gap-0.5">
                                        <IconButton label="Print single invoice PDF" onClick={() => printInvoicePDF(inv, companySettings, defaultBank)}>
                                          <Printer />
                                        </IconButton>
                                        <IconButton label="Cancel or delete invoice" onClick={() => setInvoiceToDelete(inv)}
                                          className="hover:text-danger-ink hover:bg-danger-soft">
                                          <Trash2 />
                                        </IconButton>
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            {invoices.length > 0 && (
                              <tfoot className="bg-surface-muted border-t border-line">
                                <tr>
                                  <td colSpan={2} className={cx(td, 'text-xs text-ink-faint')}>Period total</td>
                                  <td className={cx(td, 'text-right tabular-nums text-ink-soft hidden lg:table-cell whitespace-nowrap')}>
                                    {inr(summary.period_taxable)}
                                  </td>
                                  <td className={cx(td, 'text-right tabular-nums text-ink-soft hidden lg:table-cell whitespace-nowrap')}>
                                    {inr(summary.period_gst)}
                                  </td>
                                  <td className={cx(td, 'text-right tabular-nums font-semibold text-ink whitespace-nowrap')}>
                                    {inr(summary.period_invoiced)}
                                  </td>
                                  <td className={cx(td, 'text-right tabular-nums font-medium text-positive-ink whitespace-nowrap')}>
                                    {inr(summary.period_received)}
                                  </td>
                                  <td className={cx(td, 'text-right tabular-nums font-semibold whitespace-nowrap',
                                    closing > 0.01 ? 'text-warning-ink' : 'text-ink')}>
                                    {inr(summary.closing_balance)}
                                  </td>
                                  <td colSpan={2} />
                                </tr>
                              </tfoot>
                            )}
                          </table>
                        </div>

                        {/* Phone footer: the period totals in one line */}
                        {invoices.length > 0 && (
                          <div className="md:hidden flex flex-wrap justify-between gap-x-3 gap-y-1 px-3 py-2 border-t border-line bg-surface-muted">
                            <Total label="Taxable" value={inr(summary.period_taxable)} className="text-ink-soft" />
                            <Total label="GST" value={inr(summary.period_gst)} className="text-ink-soft" />
                            <Total label="Total" value={inr(summary.period_invoiced)} />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Running ledger */}
              {activeTab === 'ledger' && (
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-ink-faint">Running ledger for {periodLabel}</span>
                    <Total label="Closing" value={inr(summary.closing_balance)}
                      className={closing > 0.01 ? 'text-warning-ink' : 'text-ink'} />
                  </div>

                  <div className="panel overflow-hidden">
                    {ledger.length === 0 ? (
                      <EmptyState title="No ledger entries" message={`No ledger entries recorded for this customer in ${periodLabel}.`} />
                    ) : (
                      <>
                        <ul className="sm:hidden divide-y divide-line">
                          {ledger.map((item, idx) => (
                            <li key={idx} className={cx('flex items-center gap-1 pr-1.5', item.type === 'opening' && 'bg-surface-muted')}>
                              <div className="flex-1 min-w-0 flex items-start gap-3 pl-3 py-2.5">
                                <div className="min-w-0 flex-1">
                                  <div className={cx('text-sm text-ink truncate', item.type === 'opening' && 'font-medium')}>{item.particulars}</div>
                                  <div className="text-xs text-ink-faint tabular-nums mt-0.5">{item.date}</div>
                                </div>
                                <div className="text-right shrink-0">
                                  {item.debit ? (
                                    <div className="tabular-nums font-medium text-sm text-ink">{inr(item.debit)} <span className="text-xs text-ink-faint font-normal">Dr</span></div>
                                  ) : item.credit ? (
                                    <div className="tabular-nums font-medium text-sm text-positive-ink">{inr(item.credit)} <span className="text-xs text-ink-faint font-normal">Cr</span></div>
                                  ) : <div className="text-sm text-ink-faint">-</div>}
                                  <div className="text-xs text-ink-faint tabular-nums mt-0.5">Bal {inr(item.balance)}</div>
                                </div>
                              </div>
                              <div className="w-8 shrink-0">
                                {item.type === 'payment' && item.payment_id && deleteBtn(
                                  () => askDeletePayment({ id: item.payment_id!, amount: item.credit || 0, date: item.date, label: item.particulars }),
                                  `Delete receipt of ₹${formatINR(item.credit)} dated ${item.date}`
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>

                        <div className="hidden sm:block overflow-x-auto">
                          <table className="w-full text-left text-sm">
                            <caption className="sr-only">Ledger for {periodLabel}</caption>
                            <thead className="bg-surface-muted border-b border-line">
                              <tr>
                                <th scope="col" className={th}>Date</th>
                                <th scope="col" className={th}>Particulars</th>
                                <th scope="col" className={cx(th, 'text-right')}>Debit</th>
                                <th scope="col" className={cx(th, 'text-right')}>Credit</th>
                                <th scope="col" className={cx(th, 'text-right')}>Balance</th>
                                <th scope="col" className={cx(th, 'w-12')}><span className="sr-only">Actions</span></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                              {ledger.map((item, idx) => (
                                <tr key={idx} className={cx('hover:bg-surface-muted', item.type === 'opening' && 'bg-surface-muted')}>
                                  <td className={cx(td, 'text-ink-soft tabular-nums whitespace-nowrap')}>{item.date}</td>
                                  <td className={cx(td, 'text-ink', item.type === 'opening' && 'font-medium')}>{item.particulars}</td>
                                  <td className={cx(td, 'text-right tabular-nums text-ink whitespace-nowrap')}>
                                    {item.debit ? inr(item.debit) : <span className="text-ink-faint">-</span>}
                                  </td>
                                  <td className={cx(td, 'text-right tabular-nums text-positive-ink whitespace-nowrap')}>
                                    {item.credit ? inr(item.credit) : <span className="text-ink-faint">-</span>}
                                  </td>
                                  <td className={cx(td, 'text-right tabular-nums font-medium text-ink whitespace-nowrap')}>
                                    {inr(item.balance)}
                                  </td>
                                  <td className={cx(td, 'text-right')}>
                                    {item.type === 'payment' && item.payment_id && deleteBtn(
                                      () => askDeletePayment({ id: item.payment_id!, amount: item.credit || 0, date: item.date, label: item.particulars }),
                                      `Delete receipt of ₹${formatINR(item.credit)} dated ${item.date}`
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Receipts */}
              {activeTab === 'payments' && (
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-ink-faint">Payments received in {periodLabel}</span>
                    <Total label="Received" value={inr(summary.period_received)} className="text-positive-ink" />
                  </div>

                  <div className="panel overflow-hidden">
                    {payments.length === 0 ? (
                      <EmptyState title="No payments" message={`No payments recorded during ${periodLabel}.`} />
                    ) : (
                      <>
                        <ul className="sm:hidden divide-y divide-line">
                          {payments.map((p) => (
                            <li key={p.id} className="flex items-center gap-1 pr-1.5">
                              <div className="flex-1 min-w-0 flex items-start gap-3 pl-3 py-2.5">
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm text-ink truncate">
                                    {p.method}
                                    {p.reference && <span className="font-mono text-xs text-ink-faint ml-1.5">{p.reference}</span>}
                                  </div>
                                  <div className="text-xs text-ink-faint truncate mt-0.5">
                                    <span className="tabular-nums">{p.payment_date}</span> ·{' '}
                                    {p.invoice_no ? <span className="font-mono">{p.invoice_no}</span> : 'General settlement'}
                                  </div>
                                </div>
                                <div className="tabular-nums font-medium text-sm text-positive-ink shrink-0">{inr(p.amount)}</div>
                              </div>
                              {deleteBtn(
                                () => askDeletePayment({ id: p.id, amount: p.amount, date: p.payment_date, label: `${p.method}${p.reference ? ` · Ref: ${p.reference}` : ''}` }),
                                `Delete receipt of ₹${formatINR(p.amount)} dated ${p.payment_date}`
                              )}
                            </li>
                          ))}
                        </ul>

                        <div className="hidden sm:block overflow-x-auto">
                          <table className="w-full text-left text-sm">
                            <caption className="sr-only">Payments in {periodLabel}</caption>
                            <thead className="bg-surface-muted border-b border-line">
                              <tr>
                                <th scope="col" className={th}>Date</th>
                                <th scope="col" className={th}>Mode</th>
                                <th scope="col" className={th}>UTR / cheque ref</th>
                                <th scope="col" className={th}>Invoice</th>
                                <th scope="col" className={cx(th, 'text-right')}>Amount</th>
                                <th scope="col" className={cx(th, 'w-12')}><span className="sr-only">Actions</span></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                              {payments.map((p) => (
                                <tr key={p.id} className="hover:bg-surface-muted">
                                  <td className={cx(td, 'text-ink-soft tabular-nums whitespace-nowrap')}>{p.payment_date}</td>
                                  <td className={cx(td, 'text-ink')}>{p.method}</td>
                                  <td className={cx(td, 'font-mono text-[13px] text-ink-soft')}>{p.reference || <span className="text-ink-faint">-</span>}</td>
                                  <td className={cx(td, 'text-ink-soft')}>
                                    {p.invoice_no ? <span className="font-mono text-[13px]">{p.invoice_no}</span> : 'General settlement'}
                                  </td>
                                  <td className={cx(td, 'text-right tabular-nums font-medium text-positive-ink whitespace-nowrap')}>{inr(p.amount)}</td>
                                  <td className={cx(td, 'text-right')}>
                                    {deleteBtn(
                                      () => askDeletePayment({ id: p.id, amount: p.amount, date: p.payment_date, label: `${p.method}${p.reference ? ` · Ref: ${p.reference}` : ''}` }),
                                      `Delete receipt of ₹${formatINR(p.amount)} dated ${p.payment_date}`
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Customer profile */}
              {activeTab === 'profile' && (
                <div className="space-y-3">
                  <dl className="panel grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 p-3 sm:p-4">
                    <KV label="Contact person" value={customer.contact_person} />
                    <KV label="Phone" value={customer.phone} />
                    <KV label="WhatsApp" value={customer.whatsapp} />
                    <KV label="Email" value={customer.email} />
                    <KV label="GSTIN" value={customer.gstin || 'Unregistered'} mono={Boolean(customer.gstin)} />
                    <KV label="PAN" value={customer.pan} mono />
                    <KV label="Billing address" wide
                      value={[customer.address, customer.city, customer.state, customer.pin].filter(Boolean).join(', ')} />
                    <KV label="Shipping address"
                      value={customer.shipping_address && customer.shipping_address !== customer.address ? customer.shipping_address : 'Same as billing'} />
                    <KV label="Payment terms" value={customer.payment_terms} />
                    <KV label="Credit days" value={customer.credit_days != null ? `${customer.credit_days} days` : ''} />
                    <KV label="Credit limit" value={customer.credit_limit ? inr(customer.credit_limit) : 'Not set'} />
                    <KV label="Rate chart" value={rateChart === null ? '' : !rateChart.exists ? 'Global chart'
                      : rateChart.use_custom ? 'Personal chart' : 'Global chart (personal chart kept, not in use)'} />
                    <KV label="Bills (all time)" value={<span className="tabular-nums">{summary.invoice_count ?? invoices.length}</span>} />
                    <KV label="Total outstanding" value={<span className="tabular-nums font-medium">{inr(summary.total_overall_outstanding)}</span>} />
                    <KV label="Customer since" value={customer.created_at ? <span className="tabular-nums">{String(customer.created_at).slice(0, 10)}</span> : ''} />
                    {customer.notes && (
                      <div className="min-w-0 sm:col-span-2 lg:col-span-3 pt-3 border-t border-line">
                        <dt className="text-xs text-ink-faint">Notes</dt>
                        <dd className="mt-0.5 text-sm text-ink whitespace-pre-line break-words">{customer.notes}</dd>
                      </div>
                    )}
                  </dl>
                  {onEditCustomer && (
                    <Button size="sm" icon={<Pencil />} onClick={() => onEditCustomer(customer)}>Edit details</Button>
                  )}
                </div>
              )}
            </>
          )}

          {/* Where the customer should pay */}
          {defaultBank && defaultBank.account_number && (
            <div className="panel px-3 sm:px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs text-ink-faint">Remittance account</div>
                <div className="text-sm text-ink mt-0.5 flex flex-wrap gap-x-2">
                  <span>{defaultBank.bank_name}</span>
                  <span className="text-ink-faint">A/C <span className="font-mono text-[13px] text-ink">{defaultBank.account_number}</span></span>
                  <span className="text-ink-faint">IFSC <span className="font-mono text-[13px] text-ink">{defaultBank.ifsc || '-'}</span></span>
                  {defaultBank.upi_id && <span className="text-ink-faint">UPI <span className="font-mono text-[13px] text-ink">{defaultBank.upi_id}</span></span>}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={handleShareWhatsApp} className="self-start sm:self-auto -ml-2.5 sm:ml-0 text-accent-ink">
                Share account details <ArrowUpRight />
              </Button>
            </div>
          )}
        </div>
      </Modal>

      {/* Delete-receipt confirmation. Money is leaving the customer's account, so this
          spells out exactly what will change before anything is removed. */}
      {paymentToDelete && (
        <Modal
          size="sm"
          title="Delete this receipt?"
          onClose={() => { if (!deletingPayment) setPaymentToDelete(null); }}
          footer={
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <Button variant="ghost" onClick={() => setPaymentToDelete(null)} disabled={deletingPayment}>Keep it</Button>
              <Button variant="danger" onClick={confirmDeletePayment} loading={deletingPayment} icon={<Trash2 />}>
                {deletingPayment ? 'Deleting…' : 'Delete receipt'}
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-ink-soft">
              This permanently removes the payment. The invoice balance and the customer&rsquo;s
              outstanding will go back up by this amount.
            </p>
            <dl className="rounded-control border border-line divide-y divide-line text-sm">
              <div className="flex justify-between gap-3 px-3 py-2">
                <dt className="text-ink-faint">Amount</dt>
                <dd className="tabular-nums font-medium text-danger-ink">{inr(paymentToDelete.amount)}</dd>
              </div>
              <div className="flex justify-between gap-3 px-3 py-2">
                <dt className="text-ink-faint">Date</dt>
                <dd className="tabular-nums text-ink">{paymentToDelete.date}</dd>
              </div>
              <div className="flex justify-between gap-3 px-3 py-2">
                <dt className="text-ink-faint shrink-0">Details</dt>
                <dd className="text-ink text-right truncate">{paymentToDelete.label}</dd>
              </div>
            </dl>
            <FormError message={deleteError} />
          </div>
        </Modal>
      )}

      {/* Delete / Cancel Invoice Confirmation Modal */}
      {invoiceToDelete && (
        <DeleteInvoiceModal
          invoice={invoiceToDelete}
          onClose={() => setInvoiceToDelete(null)}
          onSuccess={() => {
            setInvoiceToDelete(null);
            fetchCustomerStatement();
          }}
        />
      )}
    </>
  );
};
