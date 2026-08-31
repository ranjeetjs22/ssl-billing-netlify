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
  Trash2
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
}

export const CustomerDetailModal: React.FC<CustomerDetailModalProps> = ({
  customer: initialCustomer,
  onClose,
  onNewInvoice,
  companySettings,
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
      text += `*IFSC:* ${defaultBank.ifsc || '—'}\n`;
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
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-5xl w-full max-h-[94vh] flex flex-col shadow-2xl text-slate-800 my-auto overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600 font-bold shrink-0 shadow-xs">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold text-slate-900">{customer.name}</h2>
                <span className="text-[10px] bg-slate-200/80 text-slate-700 font-semibold px-2 py-0.5 rounded-md">
                  {customer.payment_terms || 'Net 15 Days'}
                </span>
                {customer.credit_limit ? (
                  <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 font-semibold px-2 py-0.5 rounded-md">
                    Limit: ₹{formatINR(customer.credit_limit)}
                  </span>
                ) : null}
              </div>
              <div className="text-[11px] text-slate-500 flex items-center gap-3 mt-1 flex-wrap font-sans">
                <span>GSTIN: <strong className="text-slate-800 font-mono">{customer.gstin || 'Unregistered'}</strong></span>
                <span>·</span>
                <span>Location: <strong className="text-slate-700">{[customer.city, customer.state].filter(Boolean).join(', ') || 'Gujarat'}</strong></span>
                {customer.phone && (
                  <>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <Phone className="w-3 h-3 text-slate-400" />
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
              className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
              title="Download official PDF statement"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Statement PDF</span>
            </button>

            <button
              onClick={handleShareWhatsApp}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
              title="Share statement breakdown directly via WhatsApp"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Share WhatsApp</span>
            </button>

            <button
              onClick={handleCopyText}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-xl text-xs font-medium transition cursor-pointer"
              title="Copy statement summary to clipboard"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied!' : 'Copy Summary'}</span>
            </button>

            <button
              onClick={() => {
                onClose();
                onNewInvoice(customer);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Bill</span>
            </button>

            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition ml-1 cursor-pointer">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Period Filter Toolbar */}
        <div className="bg-slate-100/70 border-b border-slate-200 px-4 py-2.5 flex flex-col md:flex-row md:items-center justify-between gap-2.5 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-600 flex items-center gap-1 text-[11px]">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <span>Statement Period:</span>
            </span>

            <div className="inline-flex rounded-lg bg-white p-0.5 border border-slate-200 shadow-2xs">
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
                      ? 'bg-orange-600 text-white font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
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
                className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-800"
                required
              />
              <span className="text-slate-400">to</span>
              <input
                type="date"
                value={customEndDate}
                onChange={e => setCustomEndDate(e.target.value)}
                className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-800"
                required
              />
              <button
                type="submit"
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                Apply
              </button>
            </form>
          )}

          <div className="text-[11px] font-semibold text-slate-600 bg-white border border-slate-200 px-2.5 py-1 rounded-lg">
            Active Range: <span className="text-orange-600 font-bold">{periodLabel}</span>
          </div>
        </div>

        {/* Financial Summary Dashboard Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-white p-4 border-b border-slate-200">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <span className="text-slate-500 font-medium text-[11px] block">Opening Balance (B/F)</span>
            <div className="text-base font-bold text-slate-800 font-mono mt-0.5">
              ₹{formatINR(summary.opening_balance)}
            </div>
            <span className="text-[10px] text-slate-400 block mt-0.5">Prior to period start</span>
          </div>

          <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-3">
            <div className="flex items-center justify-between">
              <span className="text-blue-700 font-medium text-[11px]">Period Invoiced Sales</span>
              <span className="text-[10px] font-semibold bg-blue-100 text-blue-800 px-1.5 py-0.2 rounded">
                {invoices.length} Bills
              </span>
            </div>
            <div className="text-base font-bold text-blue-900 font-mono mt-0.5">
              ₹{formatINR(summary.period_invoiced)}
            </div>
            <span className="text-[10px] text-blue-600/70 block mt-0.5">
              Tax: ₹{formatINR(summary.period_gst)}
            </span>
          </div>

          <div className="bg-emerald-50/50 border border-emerald-100 rounded-xl p-3">
            <div className="flex items-center justify-between">
              <span className="text-emerald-700 font-medium text-[11px]">Payments Realised</span>
              <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded">
                {payments.length} Receipts
              </span>
            </div>
            <div className="text-base font-bold text-emerald-700 font-mono mt-0.5">
              ₹{formatINR(summary.period_received)}
            </div>
            <span className="text-[10px] text-emerald-600/70 block mt-0.5">Settled in period</span>
          </div>

          <div className={`rounded-xl p-3 border ${
            (summary.closing_balance || 0) > 0.01 
              ? 'bg-orange-50/80 border-orange-200' 
              : 'bg-slate-50 border-slate-200'
          }`}>
            <span className="text-slate-600 font-semibold text-[11px] block">Net Outstanding Balance</span>
            <div className={`text-lg font-extrabold font-mono mt-0.5 ${
              (summary.closing_balance || 0) > 0.01 ? 'text-orange-600' : 'text-emerald-600'
            }`}>
              ₹{formatINR(summary.closing_balance)}
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-500 mt-0.5">
              <span>Overall: ₹{formatINR(summary.total_overall_outstanding)}</span>
              {summary.overdue_amount > 0 && (
                <span className="text-rose-600 font-semibold">Overdue: ₹{formatINR(summary.overdue_amount)}</span>
              )}
            </div>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="px-5 pt-3 bg-slate-50/50 border-b border-slate-200 flex gap-6 text-xs font-semibold">
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
                    ? 'border-orange-600 text-orange-600 font-bold'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
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
            <div className="py-16 text-center text-slate-400">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600 mx-auto"></div>
              <p className="mt-2 text-xs text-slate-500">Calculating period ledger & outstanding balance...</p>
            </div>
          ) : (
            <>
              {/* TAB 1: Itemized Invoices Breakdown */}
              {activeTab === 'invoices' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-slate-500 text-[11px]">
                    <span>Detailed transport bills issued during {periodLabel}</span>
                    <span className="font-semibold text-slate-700">
                      Total Invoiced: <strong className="text-slate-900 font-mono">₹{formatINR(summary.period_invoiced)}</strong>
                    </span>
                  </div>

                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-600 font-semibold uppercase text-[10px] border-b border-slate-200">
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
                        <tbody className="divide-y divide-slate-100">
                          {invoices.length > 0 ? (
                            invoices.map((inv) => (
                              <tr key={inv.id} className="hover:bg-slate-50/80 transition">
                                <td className="py-2.5 px-3 text-slate-500 font-mono">{inv.invoice_date}</td>
                                <td className="py-2.5 px-3 font-mono font-bold text-orange-600">
                                  {inv.invoice_no}
                                </td>
                                <td className="py-2.5 px-3 text-slate-700 font-mono">
                                  {inv.lr_no ? `#${inv.lr_no}` : '—'}
                                </td>
                                <td className="py-2.5 px-3 text-slate-600">
                                  {inv.origin && inv.destination ? (
                                    <span>{inv.origin} → {inv.destination}</span>
                                  ) : inv.vehicle_no ? (
                                    <span className="font-mono">{inv.vehicle_no}</span>
                                  ) : (
                                    <span className="text-slate-400">Logistics Service</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                                  ₹{formatINR(inv.taxable_amount || inv.totals?.taxable_amount)}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                                  ₹{formatINR(inv.gst_amount || inv.totals?.gst_amount)}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                                  ₹{formatINR(inv.grand_total || inv.totals?.grand_total)}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono text-emerald-600 font-semibold">
                                  ₹{formatINR(inv.paid ?? 0)}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono font-bold text-orange-600">
                                  ₹{formatINR(inv.balance ?? inv.grand_total)}
                                </td>
                                <td className="py-2.5 px-3 text-center">
                                  <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                                    inv.display_status === 'paid' 
                                      ? 'text-emerald-700 bg-emerald-50 border border-emerald-200' 
                                      : inv.display_status === 'overdue'
                                      ? 'text-rose-700 bg-rose-50 border border-rose-200'
                                      : 'text-orange-700 bg-orange-50 border border-orange-200'
                                  }`}>
                                    {inv.display_status || 'issued'}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 text-center">
                                  <div className="flex items-center justify-center gap-1">
                                    <button
                                      onClick={() => printInvoicePDF(inv, companySettings, defaultBank)}
                                      className="p-1 hover:bg-slate-200 text-slate-600 hover:text-slate-900 rounded transition cursor-pointer"
                                      title="Print Single Invoice PDF"
                                    >
                                      <Printer className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => setInvoiceToDelete(inv)}
                                      className="p-1 hover:bg-rose-100 text-rose-500 hover:text-rose-700 rounded transition cursor-pointer"
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
                              <td colSpan={11} className="py-10 text-center text-slate-400">
                                No tax invoices issued for this customer in {periodLabel}.
                              </td>
                            </tr>
                          )}
                        </tbody>
                        {invoices.length > 0 && (
                          <tfoot className="bg-slate-50 font-semibold text-slate-900 border-t border-slate-200">
                            <tr>
                              <td colSpan={4} className="py-2.5 px-3 text-right uppercase text-[10px] text-slate-500">
                                Period Invoices Total:
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono">
                                ₹{formatINR(summary.period_taxable)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono">
                                ₹{formatINR(summary.period_gst)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                                ₹{formatINR(summary.period_invoiced)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-emerald-600">
                                ₹{formatINR(summary.period_received)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-orange-600">
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
              {activeTab === 'ledger' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-slate-500 text-[11px]">
                    <span>Chronological running ledger statement for {periodLabel}</span>
                    <span className="font-semibold text-slate-700">
                      Closing Balance: <strong className="text-orange-600 font-mono">₹{formatINR(summary.closing_balance)}</strong>
                    </span>
                  </div>

                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-600 font-semibold uppercase text-[10px] border-b border-slate-200">
                        <tr>
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">Particulars & Transaction Details</th>
                          <th className="py-2.5 px-3 text-right">Debit (Invoice)</th>
                          <th className="py-2.5 px-3 text-right">Credit (Receipt)</th>
                          <th className="py-2.5 px-3 text-right">Running Balance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {ledger.length > 0 ? (
                          ledger.map((item, idx) => (
                            <tr key={idx} className={`hover:bg-slate-50/80 ${item.type === 'opening' ? 'bg-slate-50/60 font-semibold' : ''}`}>
                              <td className="py-2.5 px-3 text-slate-500 font-mono">{item.date}</td>
                              <td className="py-2.5 px-3 text-slate-900 font-medium">
                                <div className="flex items-center gap-1.5">
                                  {item.type === 'invoice' && <FileText className="w-3.5 h-3.5 text-orange-500 shrink-0" />}
                                  {item.type === 'payment' && <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                                  {item.type === 'opening' && <Calendar className="w-3.5 h-3.5 text-blue-500 shrink-0" />}
                                  <span>{item.particulars}</span>
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-slate-800">
                                {item.debit ? `₹${formatINR(item.debit)}` : '—'}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-emerald-600 font-semibold">
                                {item.credit ? `₹${formatINR(item.credit)}` : '—'}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                                ₹{formatINR(item.balance)}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5} className="py-8 text-center text-slate-400">
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
                  <div className="flex items-center justify-between text-slate-500 text-[11px]">
                    <span>Collections and payments received during {periodLabel}</span>
                    <span className="font-semibold text-slate-700">
                      Total Received: <strong className="text-emerald-600 font-mono">₹{formatINR(summary.period_received)}</strong>
                    </span>
                  </div>

                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-600 font-semibold uppercase text-[10px] border-b border-slate-200">
                        <tr>
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">Mode & UTR / Cheque Ref</th>
                          <th className="py-2.5 px-3">Invoice Ref</th>
                          <th className="py-2.5 px-3 text-right">Amount Received (₹)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {payments.length > 0 ? (
                          payments.map((p) => (
                            <tr key={p.id} className="hover:bg-slate-50/80">
                              <td className="py-2.5 px-3 text-slate-500 font-mono">{p.payment_date}</td>
                              <td className="py-2.5 px-3 text-slate-900 font-medium">
                                <span>{p.method}</span>
                                {p.reference && (
                                  <span className="text-slate-500 ml-1.5 font-mono text-[11px]">
                                    (Ref: {p.reference})
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 font-mono text-slate-600">
                                {p.invoice_no ? `Invoice #${p.invoice_no}` : 'General Settlement'}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-600">
                                ₹{formatINR(p.amount)}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={4} className="py-8 text-center text-slate-400">
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

          {/* Bank Remittance Info Card */}
          {defaultBank && defaultBank.account_number && (
            <div className="mt-4 bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-600">
              <div>
                <div className="font-semibold text-slate-800 flex items-center gap-1.5 text-[11px]">
                  <CreditCard className="w-3.5 h-3.5 text-orange-600" />
                  <span>Company Remittance Bank Account</span>
                </div>
                <div className="text-slate-500 text-[11px] mt-0.5">
                  Bank: <strong className="text-slate-700">{defaultBank.bank_name}</strong> · 
                  A/C: <strong className="text-slate-700 font-mono">{defaultBank.account_number}</strong> · 
                  IFSC: <strong className="text-slate-700 font-mono">{defaultBank.ifsc || '—'}</strong>
                  {defaultBank.upi_id && ` · UPI: ${defaultBank.upi_id}`}
                </div>
              </div>

              <button
                onClick={handleShareWhatsApp}
                className="text-orange-600 hover:text-orange-700 font-semibold text-xs flex items-center gap-1 shrink-0 cursor-pointer"
              >
                <span>Share Account Details</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3.5 sm:p-4 border-t border-slate-200 bg-slate-50/60 flex items-center justify-between">
          <div className="text-[11px] text-slate-500">
            Total Statement Period: <strong className="text-slate-800">{periodLabel}</strong> · Outstanding: <strong className="text-orange-600 font-mono font-bold">₹{formatINR(summary.closing_balance)}</strong>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
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
