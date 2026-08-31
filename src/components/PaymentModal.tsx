import React, { useState, useEffect } from 'react';
import { X, CreditCard, Save, Receipt, Building2 } from 'lucide-react';
import { apiRequest } from '../services/api.js';
import { Invoice, BankAccount } from '../types.js';
import { formatINR } from '../utils/format.js';

interface PaymentModalProps {
  initialInvoice?: Invoice | null;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Values MUST match the server's accepted list (server/routes/payments.ts → METHODS).
 * Labels are what the user sees.
 */
const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: 'Bank Transfer', label: 'Bank Transfer (NEFT / RTGS / IMPS)' },
  { value: 'UPI', label: 'UPI / QR' },
  { value: 'Cheque', label: 'Cheque / DD' },
  { value: 'Cash', label: 'Cash' },
  { value: 'Other', label: 'Other' },
];

export const PaymentModal: React.FC<PaymentModalProps> = ({
  initialInvoice,
  onClose,
  onSuccess,
}) => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(initialInvoice?.id || '');
  const [amount, setAmount] = useState<number>(initialInvoice?.balance ?? initialInvoice?.grand_total ?? 0);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState(PAYMENT_METHODS[0].value);
  const [methods, setMethods] = useState(PAYMENT_METHODS);
  const [reference, setReference] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const invRes = await apiRequest<{ items: Invoice[] }>('/invoices?status=pending&page_size=500');
        let list = invRes.items || [];
        if (initialInvoice && !list.find(i => i.id === initialInvoice.id)) {
          list = [initialInvoice, ...list];
        }
        setInvoices(list);

        if (!selectedInvoiceId && list.length > 0) {
          setSelectedInvoiceId(list[0].id);
          setAmount(list[0].balance ?? list[0].grand_total);
        }

      } catch (err) {
        console.error('Init error in payment modal', err);
      }

      // Bank accounts (endpoint returns a plain array; tolerate {accounts}/{items} too)
      try {
        const bankRes = await apiRequest<any>('/settings/banks');
        const list: BankAccount[] = Array.isArray(bankRes) ? bankRes : (bankRes?.accounts || bankRes?.items || []);
        setBankAccounts(list);
        const def = list.find(b => b.is_default) || list[0];
        if (def?.id) setBankAccountId(def.id);
      } catch (err) {
        console.warn('Bank accounts unavailable in payment modal', err);
      }

      // Keep the method list in sync with whatever the server accepts
      try {
        const m = await apiRequest<{ methods: string[] }>('/payments/methods');
        if (Array.isArray(m?.methods) && m.methods.length > 0) {
          const merged = m.methods.map(v => PAYMENT_METHODS.find(x => x.value === v) || { value: v, label: v });
          setMethods(merged);
          if (!m.methods.includes(PAYMENT_METHODS[0].value)) setMethod(m.methods[0]);
        }
      } catch {
        // keep defaults
      }
    };
    init();
  }, []);

  const handleInvoiceChange = (invId: string) => {
    setSelectedInvoiceId(invId);
    const found = invoices.find(i => i.id === invId);
    if (found) {
      setAmount(found.balance ?? found.grand_total);
    }
  };

  const curInvoice = invoices.find(i => i.id === selectedInvoiceId);
  const curBalance = curInvoice ? (curInvoice.balance ?? curInvoice.grand_total ?? 0) : 0;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoiceId) {
      setError('Please select an invoice to record payment against.');
      return;
    }
    if (amount <= 0) {
      setError('Payment amount must be greater than 0.');
      return;
    }
    const outstanding = curInvoice ? (curInvoice.balance ?? curInvoice.grand_total ?? 0) : 0;
    if (curInvoice && amount > outstanding + 0.5) {
      setError(`Amount exceeds the outstanding balance of ₹${formatINR(outstanding)}.`);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const bank = bankAccounts.find(b => b.id === bankAccountId);
      await apiRequest('/payments', {
        method: 'POST',
        body: JSON.stringify({
          invoice_id: selectedInvoiceId,
          amount: Number(amount),
          payment_date: paymentDate,
          method,
          reference,
          bank_account_id: bankAccountId || undefined,
          bank: bank ? `${bank.bank_name} (A/C ••${String(bank.account_number || '').slice(-4)})` : undefined,
          notes,
        }),
      });

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to record payment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full max-h-[92vh] flex flex-col shadow-2xl text-slate-800 my-auto">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
              <Receipt className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Record Payment Receipt</h2>
              <p className="text-[11px] text-slate-500">Credit against pending invoice</p>
            </div>
          </div>

          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 rounded-lg transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700">
              {error}
            </div>
          )}

          {/* Invoice Selection */}
          <div>
            <label className="block text-slate-700 font-semibold mb-1">Select Target Invoice *</label>
            <select
              required
              value={selectedInvoiceId}
              onChange={(e) => handleInvoiceChange(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 text-xs focus:outline-none focus:border-emerald-500 font-mono"
            >
              {invoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoice_no} · {inv.buyer?.name || 'Customer'} (Bal: ₹{formatINR(inv.balance ?? inv.grand_total)})
                </option>
              ))}
            </select>
          </div>

          {curInvoice && (
            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
              <div>
                <span className="text-slate-500">Invoice Total:</span>
                <div className="font-mono text-slate-700 font-semibold">₹{formatINR(curInvoice.grand_total)}</div>
              </div>
              <div>
                <span className="text-slate-500">Already Paid:</span>
                <div className="font-mono text-emerald-600 font-semibold">₹{formatINR(curInvoice.paid || 0)}</div>
              </div>
              <div>
                <span className="text-slate-500">Balance Due:</span>
                <div className="font-mono font-bold text-orange-600">₹{formatINR(curInvoice.balance ?? curInvoice.grand_total)}</div>
              </div>
            </div>
          )}

          {/* Amount & Date */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-slate-700 font-semibold">Received Amount (₹) *</label>
                {curInvoice && (
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold">
                    <button type="button" onClick={() => setAmount(Math.round(curBalance * 50) / 100)} className="text-slate-500 hover:text-emerald-700 cursor-pointer">50%</button>
                    <span className="text-slate-300">·</span>
                    <button type="button" onClick={() => setAmount(curBalance)} className="text-emerald-600 hover:text-emerald-700 cursor-pointer">Full balance</button>
                  </div>
                )}
              </div>
              <input
                type="number"
                step="any"
                required
                min="0.01"
                max={curInvoice ? curBalance + 0.5 : undefined}
                value={amount || ''}
                onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-mono font-bold text-emerald-600 text-sm focus:outline-none focus:border-emerald-500"
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="block text-slate-700 font-semibold mb-1">Receipt Date *</label>
              <input
                type="date"
                required
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Method & Bank */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Payment Method</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 text-xs focus:outline-none focus:border-emerald-500"
              >
                {methods.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-700 font-semibold mb-1">Deposited Bank Account</label>
              <select
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 text-xs focus:outline-none focus:border-emerald-500"
              >
                <option value="">Default Company Account</option>
                {bankAccounts.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.bank_name} - {b.account_number.slice(-4)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Reference */}
          <div>
            <label className="block text-slate-700 font-semibold mb-1">UTR / Cheque / Reference No</label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-mono text-slate-900 text-xs focus:outline-none focus:border-emerald-500"
              placeholder="e.g. UTR-HDFC9982710"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-slate-700 font-semibold mb-1">Remarks / Note</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 text-xs focus:outline-none focus:border-emerald-500"
              placeholder="Payment received against transport consignment"
            />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-medium transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-xs transition flex items-center gap-2 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>
                {saving
                  ? 'Processing...'
                  : curInvoice && amount > 0 && amount < curBalance - 0.5
                  ? 'Record Partial Payment'
                  : 'Record Payment'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
