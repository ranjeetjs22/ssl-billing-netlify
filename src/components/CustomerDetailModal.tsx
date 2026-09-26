import React, { useState, useEffect } from 'react';
import { 
  X,
  Building2,
  MapPin,
  Phone,
  Mail,
  Printer,
  Plus,
  FileText,
  CreditCard,
  Calendar,
  ArrowUpRight,
  Share2,
  Copy,
  Check,
  Download,
  AlertCircle,
  TrendingDown,
  TrendingUp,
  Receipt,
  Truck,
  DollarSign,
  Trash2,
  AlertTriangle,
  Loader2
} from 'lucide-react';
import { Customer, Invoice, Payment, CompanySettings, BankAccount, CustomerStatementResponse, CustomerLedgerEntry } from '../types.js';
import { formatINR } from '../utils/format.js';
import { printStatementPDF, printInvoicePDF } from '../utils/pdf.js';
import { apiRequest } from '../services/api.js';
import { DeleteInvoiceModal } from './DeleteInvoiceModal.js';

interface CustomerDetailModalProps {
  customer: Customer;
  onClose: () => void;
  onNewInvoice: (customer: Customer) => void;
  companySettings: CompanySettings;
  /** Called after a change that affects balances, so the screens behind refresh too. */
  onRefresh?: () => void;
}

export const CustomerDetailModal: React.FC<CustomerDetailModalProps> = ({
  customer: initialCustomer,
  onClose,
  onNewInvoice,
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
  const [activeTab, setActiveTab] = useState<'invoices' | 'ledger' | 'payments'>('invoices');
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

  const [periodFilterType, setPeriodFilterType] = useState<string>('current_month'); // 'current_month' | 'prev_month' | 'last_3_months' | 'fy' | 'all' | 'custom'
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

  return (
    <div className="fixed inset-0 bg-scrim backdrop-blur-[6px] flex items-center justify-center p-3 sm:p-4 z-50 overflow-y-auto">
      <div className="sheet border border-line rounded-overlay max-w-5xl w-full max-h-[94vh] flex flex-col shadow-overlay text-ink my-auto overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-line flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface-muted">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-card bg-accent-soft border border-accent-line flex items-center justify-center text-accent-ink font-bold shrink-0 shadow-card">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold text-ink">{customer.name}</h2>
                <span className="text-[10px] bg-surface-sunken/80 text-ink-soft font-semibold px-2 py-0.5 rounded-md">
                  {customer.payment_terms || 'Net 15 Days'}
                </span>
                {customer.credit_limit ? (
                  <span className="text-[10px] bg-info-soft text-info-ink border border-info-line font-semibold px-2 py-0.5 rounded-md">
                    Limit: ₹{formatINR(customer.credit_limit)}
                  </span>
                ) : null}
              </div>
              <div className="text-[11px] text-ink-faint flex items-center gap-3 mt-1 flex-wrap font-sans">
                <span>GSTIN: <strong className="text-ink font-mono">{customer.gstin || 'Unregistered'}</strong></span>
                <span>·</span>
                <span>Location: <strong className="text-ink-soft">{[customer.city, customer.state].filter(Boolean).join(', ') || 'Gujarat'}</strong></span>
                {customer.phone && (
                  <>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <Phone className="w-3 h-3 text-ink-faint" />
                      <span>{customer.phone}</span>
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => printStatementPDF(customer, ledger, summary, companySettings, periodLabel, invoices, defaultBank)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-strong hover:bg-accent-strong-hover text-on-accent rounded-card text-xs font-semibold shadow-card transition cursor-pointer"
              title="Download official PDF statement"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Statement PDF</span>
            </button>

            <button
              onClick={handleShareWhatsApp}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface text-positive-ink border border-positive-line hover:bg-positive-soft hover:border-positive rounded-card text-xs font-semibold shadow-card transition cursor-pointer"
              title="Share statement breakdown directly via WhatsApp"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Share WhatsApp</span>
            </button>

            <button
              onClick={handleCopyText}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-sunken hover:bg-surface-sunken text-ink-soft border border-line rounded-card text-xs font-medium transition cursor-pointer"
              title="Copy statement summary to clipboard"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-positive-ink" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied!' : 'Copy Summary'}</span>
            </button>

            <button
              onClick={() => {
                onClose();
                onNewInvoice(customer);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface text-ink border border-line hover:border-line-strong hover:bg-surface-muted rounded-control text-xs font-medium transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Bill</span>
            </button>

            <button onClick={onClose} className="p-1.5 text-ink-faint hover:text-ink hover:bg-surface-sunken rounded-control transition ml-1 cursor-pointer">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Period Filter Toolbar */}
        <div className="bg-surface-sunken border-b border-line px-4 py-2.5 flex flex-col md:flex-row md:items-center justify-between gap-2.5 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-ink-soft flex items-center gap-1 text-[11px]">
              <Calendar className="w-3.5 h-3.5 text-ink-faint" />
              <span>Statement Period:</span>
            </span>

            <div className="inline-flex rounded-control bg-surface p-0.5 border border-line shadow-card">
              {[
                { key: 'current_month', label: 'This Month' },
                { key: 'prev_month', label: 'Last Month' },
                { key: 'last_3_months', label: 'Last 3 Months' },
                { key: 'fy', label: 'Current FY' },
                { key: 'all', label: 'All Time' },
                { key: 'custom', label: 'Custom Range' },
              ].map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setPeriodFilterType(opt.key)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition cursor-pointer ${
                    periodFilterType === opt.key
                      ? 'bg-accent-soft text-accent-ink border border-accent-line font-semibold shadow-card'
                      : 'text-ink-soft hover:text-ink hover:bg-surface-muted'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {periodFilterType === 'custom' && (
            <form onSubmit={handleApplyCustomDates} className="flex items-center gap-2">
              <input
                type="date"
                value={customStartDate}
                onChange={e => setCustomStartDate(e.target.value)}
                className="bg-surface border border-line rounded-control px-2 py-1 text-xs text-ink"
                required
              />
              <span className="text-ink-faint">to</span>
              <input
                type="date"
                value={customEndDate}
                onChange={e => setCustomEndDate(e.target.value)}
                className="bg-surface border border-line rounded-control px-2 py-1 text-xs text-ink"
                required
              />
              <button
                type="submit"
                className="px-2.5 py-1 bg-surface text-ink border border-line hover:border-line-strong hover:bg-surface-muted rounded-control text-xs font-medium cursor-pointer"
              >
                Apply
              </button>
            </form>
          )}

          <div className="text-[11px] font-semibold text-ink-soft bg-surface border border-line px-2.5 py-1 rounded-control">
            Active Range: <span className="text-accent-ink font-bold">{periodLabel}</span>
          </div>
        </div>

        {/* Financial Summary Dashboard Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-surface p-4 border-b border-line">
          <div className="bg-surface-muted border border-line rounded-card p-3">
            <span className="text-ink-faint font-medium text-[11px] block">Opening Balance (B/F)</span>
            <div className="text-base font-bold text-ink font-mono mt-0.5">
              ₹{formatINR(summary.opening_balance)}
            </div>
            <span className="text-[10px] text-ink-faint block mt-0.5">Prior to period start</span>
          </div>

          <div className="bg-info-soft/50 border border-info-line rounded-card p-3">
            <div className="flex items-center justify-between">
              <span className="text-info-ink font-medium text-[11px]">Period Invoiced Sales</span>
              <span className="text-[10px] font-semibold bg-info-soft text-info-ink px-1.5 py-0.2 rounded">
                {invoices.length} Bills
              </span>
            </div>
            <div className="text-base font-bold text-info-ink font-mono mt-0.5">
              ₹{formatINR(summary.period_invoiced)}
            </div>
            <span className="text-[10px] text-info-ink/70 block mt-0.5">
              Tax: ₹{formatINR(summary.period_gst)}
            </span>
          </div>

          <div className="bg-positive-soft border border-positive-line rounded-card p-3">
            <div className="flex items-center justify-between">
              <span className="text-positive-ink font-medium text-[11px]">Payments Realised</span>
              <span className="text-[10px] font-semibold bg-positive-soft text-positive-ink px-1.5 py-0.2 rounded">
                {payments.length} Receipts
              </span>
            </div>
            <div className="text-base font-bold text-positive-ink font-mono mt-0.5">
              ₹{formatINR(summary.period_received)}
            </div>
            <span className="text-[10px] text-positive-ink/70 block mt-0.5">Settled in period</span>
          </div>

          <div className={`rounded-card p-3 border ${
            (summary.closing_balance || 0) > 0.01 
              ? 'bg-accent-soft border-accent-line' 
              : 'bg-surface-muted border-line'
          }`}>
            <span className="text-ink-soft font-semibold text-[11px] block">Net Outstanding Balance</span>
            <div className={`text-lg font-extrabold font-mono mt-0.5 ${
              (summary.closing_balance || 0) > 0.01 ? 'text-accent-ink' : 'text-positive-ink'
            }`}>
              ₹{formatINR(summary.closing_balance)}
            </div>
            <div className="flex items-center justify-between text-[10px] text-ink-faint mt-0.5">
              <span>Overall: ₹{formatINR(summary.total_overall_outstanding)}</span>
              {summary.overdue_amount > 0 && (
                <span className="text-danger-ink font-semibold">Overdue: ₹{formatINR(summary.overdue_amount)}</span>
              )}
            </div>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="px-5 pt-3 bg-surface-muted border-b border-line flex gap-6 text-xs font-semibold">
          {[
            { key: 'invoices', label: `Period Invoices Breakdown (${invoices.length})`, icon: FileText },
            { key: 'ledger', label: `Statement Ledger (${ledger.length})`, icon: Receipt },
            { key: 'payments', label: `Payment Receipts (${payments.length})`, icon: DollarSign },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`pb-2.5 transition border-b-2 font-medium flex items-center gap-1.5 cursor-pointer ${
                  activeTab === tab.key
                    ? 'border-accent text-accent-ink font-bold'
                    : 'border-transparent text-ink-faint hover:text-ink'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Viewport */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 text-xs">
          {loading ? (
            <div className="py-16 text-center text-ink-faint">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent mx-auto"></div>
              <p className="mt-2 text-xs text-ink-faint">Calculating period ledger & outstanding balance...</p>
            </div>
          ) : (
            <>
              {/* TAB 1: Itemized Invoices Breakdown */}
              {activeTab === 'invoices' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-ink-faint text-[11px]">
                    <span>Detailed transport bills issued during {periodLabel}</span>
                    <span className="font-semibold text-ink-soft">
                      Total Invoiced: <strong className="text-ink font-mono">₹{formatINR(summary.period_invoiced)}</strong>
                    </span>
                  </div>

                  <div className="bg-surface rounded-card border border-line overflow-hidden shadow-card">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-surface-muted text-ink-soft font-semibold uppercase text-[10px] border-b border-line">
                          <tr>
                            <th className="py-2.5 px-3">Date</th>
                            <th className="py-2.5 px-3">Invoice No</th>
                            <th className="py-2.5 px-3">LR / Consignment</th>
                            <th className="py-2.5 px-3">Route / Vehicle</th>
                            <th className="py-2.5 px-3 text-right">Taxable (₹)</th>
                            <th className="py-2.5 px-3 text-right">GST (₹)</th>
                            <th className="py-2.5 px-3 text-right">Total (₹)</th>
                            <th className="py-2.5 px-3 text-right">Paid (₹)</th>
                            <th className="py-2.5 px-3 text-right">Balance Due (₹)</th>
                            <th className="py-2.5 px-3 text-center">Status</th>
                            <th className="py-2.5 px-3 text-center">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {invoices.length > 0 ? (
                            invoices.map((inv) => (
                              <tr key={inv.id} className="hover:bg-surface-muted/80 transition">
                                <td className="py-2.5 px-3 text-ink-faint font-mono">{inv.invoice_date}</td>
                                <td className="py-2.5 px-3 font-mono font-bold text-accent-ink">
                                  {inv.invoice_no}
                                </td>
                                <td className="py-2.5 px-3 text-ink-soft font-mono">
                                  {inv.lr_no ? `#${inv.lr_no}` : '-'}
                                </td>
                                <td className="py-2.5 px-3 text-ink-soft">
                                  {inv.origin && inv.destination ? (
                                    <span>{inv.origin} → {inv.destination}</span>
                                  ) : inv.vehicle_no ? (
                                    <span className="font-mono">{inv.vehicle_no}</span>
                                  ) : (
                                    <span className="text-ink-faint">Logistics Service</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono text-ink-soft">
                                  ₹{formatINR(inv.taxable_amount || inv.totals?.taxable_amount)}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono text-ink-soft">
                                  ₹{formatINR(inv.gst_amount || inv.totals?.gst_amount)}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono font-bold text-ink">
                                  ₹{formatINR(inv.grand_total || inv.totals?.grand_total)}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono text-positive-ink font-semibold">
                                  ₹{formatINR(inv.paid ?? 0)}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono font-bold text-accent-ink">
                                  ₹{formatINR(inv.balance ?? inv.grand_total)}
                                </td>
                                <td className="py-2.5 px-3 text-center">
                                  <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                                    inv.display_status === 'paid' 
                                      ? 'text-positive-ink bg-positive-soft border border-positive-line' 
                                      : inv.display_status === 'overdue'
                                      ? 'text-danger-ink bg-danger-soft border border-danger-line'
                                      : 'text-accent-ink bg-accent-soft border border-accent-line'
                                  }`}>
                                    {inv.display_status || 'issued'}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 text-center">
                                  <div className="flex items-center justify-center gap-1">
                                    <button
                                      onClick={() => printInvoicePDF(inv, companySettings, defaultBank)}
                                      className="p-1 hover:bg-surface-sunken text-ink-soft hover:text-ink rounded transition cursor-pointer"
                                      title="Print Single Invoice PDF"
                                    >
                                      <Printer className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => setInvoiceToDelete(inv)}
                                      className="p-1 hover:bg-danger-soft text-danger hover:text-danger-ink rounded transition cursor-pointer"
                                      title="Cancel or Delete Invoice"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={11} className="py-10 text-center text-ink-faint">
                                No tax invoices issued for this customer in {periodLabel}.
                              </td>
                            </tr>
                          )}
                        </tbody>
                        {invoices.length > 0 && (
                          <tfoot className="bg-surface-muted font-semibold text-ink border-t border-line">
                            <tr>
                              <td colSpan={4} className="py-2.5 px-3 text-right uppercase text-[10px] text-ink-faint">
                                Period Invoices Total:
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono">
                                ₹{formatINR(summary.period_taxable)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono">
                                ₹{formatINR(summary.period_gst)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-ink">
                                ₹{formatINR(summary.period_invoiced)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-positive-ink">
                                ₹{formatINR(summary.period_received)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-accent-ink">
                                ₹{formatINR(summary.closing_balance)}
                              </td>
                              <td colSpan={2}></td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: Statement of Account / Running Ledger */}
              {actionMessage && (
                <div role="status" aria-live="polite"
                  className="mb-3 p-3 bg-positive-soft border border-positive-line rounded-card text-positive-ink text-xs
                             font-medium flex items-start gap-2">
                  <Check className="w-4 h-4 shrink-0 mt-0.5 text-positive-ink" aria-hidden="true" />
                  <span>{actionMessage}</span>
                </div>
              )}

              {activeTab === 'ledger' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-ink-faint text-[11px]">
                    <span>Chronological running ledger statement for {periodLabel}</span>
                    <span className="font-semibold text-ink-soft">
                      Closing Balance: <strong className="text-accent-ink font-mono">₹{formatINR(summary.closing_balance)}</strong>
                    </span>
                  </div>

                  <div className="bg-surface rounded-card border border-line overflow-hidden shadow-card">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-surface-muted text-ink-soft font-semibold uppercase text-[10px] border-b border-line">
                        <tr>
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">Particulars & Transaction Details</th>
                          <th className="py-2.5 px-3 text-right">Debit (Invoice)</th>
                          <th className="py-2.5 px-3 text-right">Credit (Receipt)</th>
                          <th className="py-2.5 px-3 text-right">Running Balance</th>
                          <th className="py-2.5 px-3 text-right w-12"><span className="sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {ledger.length > 0 ? (
                          ledger.map((item, idx) => (
                            <tr key={idx} className={`hover:bg-surface-muted/80 ${item.type === 'opening' ? 'bg-surface-muted font-semibold' : ''}`}>
                              <td className="py-2.5 px-3 text-ink-faint font-mono">{item.date}</td>
                              <td className="py-2.5 px-3 text-ink font-medium">
                                <div className="flex items-center gap-1.5">
                                  {item.type === 'invoice' && <FileText className="w-3.5 h-3.5 text-accent shrink-0" />}
                                  {item.type === 'payment' && <Check className="w-3.5 h-3.5 text-positive shrink-0" />}
                                  {item.type === 'opening' && <Calendar className="w-3.5 h-3.5 text-info shrink-0" />}
                                  <span>{item.particulars}</span>
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-ink">
                                {item.debit ? `₹${formatINR(item.debit)}` : '-'}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-positive-ink font-semibold">
                                {item.credit ? `₹${formatINR(item.credit)}` : '-'}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-ink">
                                ₹{formatINR(item.balance)}
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                {item.type === 'payment' && item.payment_id && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDeleteError(null);
                                      setPaymentToDelete({
                                        id: item.payment_id!,
                                        amount: item.credit || 0,
                                        date: item.date,
                                        label: item.particulars,
                                      });
                                    }}
                                    aria-label={`Delete receipt of ₹${formatINR(item.credit)} dated ${item.date}`}
                                    title="Delete this receipt"
                                    className="inline-flex items-center justify-center w-8 h-8 rounded-control text-danger
                                               hover:text-danger-ink hover:bg-danger-soft transition-colors cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={6} className="py-8 text-center text-ink-faint">
                              No ledger entries recorded for this customer in {periodLabel}.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 3: Payment Receipts */}
              {activeTab === 'payments' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-ink-faint text-[11px]">
                    <span>Collections and payments received during {periodLabel}</span>
                    <span className="font-semibold text-ink-soft">
                      Total Received: <strong className="text-positive-ink font-mono">₹{formatINR(summary.period_received)}</strong>
                    </span>
                  </div>

                  <div className="bg-surface rounded-card border border-line overflow-hidden shadow-card">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-surface-muted text-ink-soft font-semibold uppercase text-[10px] border-b border-line">
                        <tr>
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">Mode & UTR / Cheque Ref</th>
                          <th className="py-2.5 px-3">Invoice Ref</th>
                          <th className="py-2.5 px-3 text-right">Amount Received (₹)</th>
                          <th className="py-2.5 px-3 text-right w-12"><span className="sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {payments.length > 0 ? (
                          payments.map((p) => (
                            <tr key={p.id} className="hover:bg-surface-muted/80">
                              <td className="py-2.5 px-3 text-ink-faint font-mono">{p.payment_date}</td>
                              <td className="py-2.5 px-3 text-ink font-medium">
                                <span>{p.method}</span>
                                {p.reference && (
                                  <span className="text-ink-faint ml-1.5 font-mono text-[11px]">
                                    (Ref: {p.reference})
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 font-mono text-ink-soft">
                                {p.invoice_no ? `Invoice #${p.invoice_no}` : 'General Settlement'}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-positive-ink">
                                ₹{formatINR(p.amount)}
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDeleteError(null);
                                    setPaymentToDelete({
                                      id: p.id,
                                      amount: p.amount,
                                      date: p.payment_date,
                                      label: `${p.method}${p.reference ? ` · Ref: ${p.reference}` : ''}`,
                                    });
                                  }}
                                  aria-label={`Delete receipt of ₹${formatINR(p.amount)} dated ${p.payment_date}`}
                                  title="Delete this receipt"
                                  className="inline-flex items-center justify-center w-8 h-8 rounded-control text-danger
                                             hover:text-danger-ink hover:bg-danger-soft transition-colors cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5} className="py-8 text-center text-ink-faint">
                              No payments recorded during {periodLabel}.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Delete-receipt confirmation. Money is leaving the customer's account, so this
          spells out exactly what will change before anything is removed. */}
      {paymentToDelete && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4 bg-scrim backdrop-blur-[6px]"
          onMouseDown={(e) => { if (e.target === e.currentTarget && !deletingPayment) setPaymentToDelete(null); }}
          onKeyDown={(e) => { if (e.key === 'Escape' && !deletingPayment) setPaymentToDelete(null); }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="del-pay-title"
            aria-describedby="del-pay-desc"
            className="bg-surface w-full sm:max-w-md rounded-t-2xl sm:rounded-card shadow-overlay p-5 space-y-4"
          >
            <div className="flex items-start gap-3">
              <span className="w-10 h-10 rounded-card bg-danger-soft border border-danger-line text-danger-ink flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h3 id="del-pay-title" className="font-bold text-ink">Delete this receipt?</h3>
                <p id="del-pay-desc" className="text-xs text-ink-faint mt-0.5">
                  This permanently removes the payment. The invoice balance and the customer&rsquo;s
                  outstanding will go back up by this amount.
                </p>
              </div>
            </div>

            <div className="bg-surface-muted border border-line rounded-card p-3 text-xs space-y-1">
              <div className="flex justify-between gap-3">
                <span className="text-ink-faint">Amount</span>
                <span className="font-mono font-bold text-danger-ink">₹{formatINR(paymentToDelete.amount)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-ink-faint">Date</span>
                <span className="font-mono text-ink">{paymentToDelete.date}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-ink-faint shrink-0">Details</span>
                <span className="text-ink text-right truncate">{paymentToDelete.label}</span>
              </div>
            </div>

            {deleteError && (
              <div role="alert" className="p-3 bg-danger-soft border border-danger-line rounded-card text-danger-ink text-xs">
                {deleteError}
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPaymentToDelete(null)}
                disabled={deletingPayment}
                className="px-4 py-2.5 min-h-[44px] rounded-card bg-surface-sunken hover:bg-surface-sunken text-ink-soft
                           text-xs font-semibold transition cursor-pointer disabled:opacity-50"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={confirmDeletePayment}
                disabled={deletingPayment}
                className="px-4 py-2.5 min-h-[44px] rounded-card bg-surface text-danger-ink border border-danger-line hover:bg-danger-soft hover:border-danger
                           text-xs font-semibold transition cursor-pointer disabled:opacity-50
                           inline-flex items-center justify-center gap-2"
              >
                {deletingPayment
                  ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />Deleting…</>
                  : <><Trash2 className="w-4 h-4" aria-hidden="true" />Delete receipt</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bank Remittance Info Card */}
          {defaultBank && defaultBank.account_number && (
            <div className="mt-4 bg-surface-muted border border-line rounded-card p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-ink-soft">
              <div>
                <div className="font-semibold text-ink flex items-center gap-1.5 text-[11px]">
                  <CreditCard className="w-3.5 h-3.5 text-accent-ink" />
                  <span>Company Remittance Bank Account</span>
                </div>
                <div className="text-ink-faint text-[11px] mt-0.5">
                  Bank: <strong className="text-ink-soft">{defaultBank.bank_name}</strong> · 
                  A/C: <strong className="text-ink-soft font-mono">{defaultBank.account_number}</strong> · 
                  IFSC: <strong className="text-ink-soft font-mono">{defaultBank.ifsc || '-'}</strong>
                  {defaultBank.upi_id && ` · UPI: ${defaultBank.upi_id}`}
                </div>
              </div>

              <button
                onClick={handleShareWhatsApp}
                className="text-accent-ink hover:text-accent-ink font-semibold text-xs flex items-center gap-1 shrink-0 cursor-pointer"
              >
                <span>Share Account Details</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3.5 sm:p-4 border-t border-line bg-surface-muted flex items-center justify-between">
          <div className="text-[11px] text-ink-faint">
            Total Statement Period: <strong className="text-ink">{periodLabel}</strong> · Outstanding: <strong className="text-accent-ink font-mono font-bold">₹{formatINR(summary.closing_balance)}</strong>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-2 bg-surface-sunken hover:bg-line-strong text-ink-soft rounded-card text-xs font-semibold transition cursor-pointer"
          >
            Close Statement
          </button>
        </div>
      </div>

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
    </div>
  );
};
