import React, { useState, useEffect, useMemo } from 'react';
import {
  Wallet, Search, Check, ChevronDown, Landmark, Hash,
} from 'lucide-react';
import { apiRequest } from '../services/api.js';
import { Invoice, BankAccount } from '../types.js';
import { formatINR } from '../utils/format.js';
import {
  Modal, Button, Field, Input, Select, FormError, cx,
} from './ui.js';

interface PaymentModalProps {
  initialInvoice?: Invoice | null;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Values MUST match the server's accepted list (server/routes/payments.ts -> METHODS).
 * Labels are what the user sees; `short` is what fits on a segmented pill.
 */
const PAYMENT_METHODS: { value: string; label: string; short: string }[] = [
  { value: 'Bank Transfer', label: 'Bank Transfer (NEFT / RTGS / IMPS)', short: 'Bank' },
  { value: 'UPI', label: 'UPI / QR', short: 'UPI' },
  { value: 'Cheque', label: 'Cheque / DD', short: 'Cheque' },
  { value: 'Cash', label: 'Cash', short: 'Cash' },
  { value: 'Other', label: 'Other', short: 'Other' },
];

/** Local-time ISO; `toISOString()` shifts to UTC and moves IST dates back a day. */
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const PaymentModal: React.FC<PaymentModalProps> = ({
  initialInvoice,
  onClose,
  onSuccess,
}) => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(initialInvoice?.id || '');
  const [amount, setAmount] = useState<number>(initialInvoice?.balance ?? initialInvoice?.grand_total ?? 0);
  const [paymentDate, setPaymentDate] = useState(iso(new Date()));
  const [method, setMethod] = useState(PAYMENT_METHODS[0].value);
  const [methods, setMethods] = useState(PAYMENT_METHODS);
  const [reference, setReference] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [showDetails, setShowDetails] = useState(false);

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
          const merged = m.methods.map(
            v => PAYMENT_METHODS.find(x => x.value === v) || { value: v, label: v, short: v }
          );
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
  const curTotal = Number(curInvoice?.grand_total || 0);
  const curPaid = Number(curInvoice?.paid || 0);

  /** Search over number and customer so a long pending list stays usable. */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter(i =>
      String(i.invoice_no || '').toLowerCase().includes(q) ||
      String(i.buyer?.name || '').toLowerCase().includes(q) ||
      String(i.lr_no || '').toLowerCase().includes(q)
    );
  }, [invoices, query]);

  const remaining = Math.max(0, curBalance - (Number(amount) || 0));
  const isPartial = !!curInvoice && amount > 0 && amount < curBalance - 0.5;
  const needsReference = method === 'Bank Transfer' || method === 'UPI' || method === 'Cheque';

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

  const paidPct = curTotal > 0 ? Math.min(100, (curPaid / curTotal) * 100) : 0;
  const thisPct = curTotal > 0 ? Math.min(100 - paidPct, ((Number(amount) || 0) / curTotal) * 100) : 0;

  return (
    <Modal
      onClose={onClose}
      title="Record payment"
      subtitle={curInvoice ? `Against ${curInvoice.invoice_no}` : 'Credit against a pending invoice'}
      icon={<Wallet className="w-[18px] h-[18px]" strokeWidth={1.8} />}
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-ink-faint hidden sm:block">
            {curInvoice
              ? isPartial
                ? `₹${formatINR(remaining)} will remain outstanding`
                : 'This settles the invoice in full'
              : 'Pick an invoice to continue'}
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="ghost" onClick={onClose} type="button">Cancel</Button>
            <Button
              form="payment-form"
              type="submit"
              variant="primary"
              loading={saving}
              disabled={!selectedInvoiceId || amount <= 0}
              icon={<Check className="w-4 h-4" />}
            >
              {isPartial ? 'Record part payment' : 'Record payment'}
            </Button>
          </div>
        </div>
      }
    >
      <form id="payment-form" onSubmit={handleSave} className="space-y-5">
        {error && <FormError message={error} />}

        {/* ---------------------------------------------- 1. which invoice */}
        <section>
          <div className="flex items-center justify-between gap-3 mb-2">
            <h3 className="label-micro">Invoice</h3>
            <span className="text-[11px] text-ink-faint">
              {filtered.length} pending
            </span>
          </div>

          <div className="relative mb-2">
            <Search
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
              strokeWidth={1.8}
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search invoice number, customer or LR"
              aria-label="Search pending invoices"
              className="pl-9"
            />
          </div>

          <div
            role="radiogroup"
            aria-label="Pending invoices"
            className="rounded-card border border-line divide-y divide-line max-h-[196px] overflow-y-auto overscroll-contain"
          >
            {filtered.length === 0 ? (
              <p className="p-4 text-sm text-ink-faint text-center">
                {invoices.length === 0 ? 'No pending invoices.' : 'Nothing matches that search.'}
              </p>
            ) : filtered.map((inv) => {
              const active = inv.id === selectedInvoiceId;
              const bal = inv.balance ?? inv.grand_total;
              return (
                <button
                  key={inv.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => handleInvoiceChange(inv.id)}
                  className={cx(
                    'w-full flex items-center gap-3 px-3 py-2.5 text-left cursor-pointer',
                    'transition-colors duration-[140ms]',
                    active ? 'bg-accent-soft' : 'hover:bg-surface-muted'
                  )}
                >
                  <span className={cx(
                    'w-4 h-4 rounded-full border shrink-0 flex items-center justify-center',
                    active ? 'border-accent bg-accent text-on-accent' : 'border-line-strong'
                  )} aria-hidden="true">
                    {active && <Check className="w-2.5 h-2.5" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[12px] text-accent-ink truncate">{inv.invoice_no}</span>
                    <span className="block text-[13px] text-ink truncate">{inv.buyer?.name || 'Customer'}</span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block numeral text-[13px] text-ink">₹{formatINR(bal)}</span>
                    <span className="block text-[10px] text-ink-faint">due</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* ---------------------------------------------- 2. how much */}
        {curInvoice && (
          <section>
            <h3 className="label-micro mb-2">Amount</h3>

            <div className="panel p-4">
              {/* where this invoice stands, and what this payment does to it */}
              <div className="flex items-baseline justify-between gap-3 text-[11px] text-ink-faint mb-1.5">
                <span>Invoice ₹{formatINR(curTotal)}</span>
                <span>Already paid ₹{formatINR(curPaid)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-surface-sunken overflow-hidden flex" aria-hidden="true">
                <div className="h-full bg-positive/70 transition-[width] duration-300" style={{ width: `${paidPct}%` }} />
                <div
                  className="h-full transition-[width] duration-300"
                  style={{ width: `${thisPct}%`, background: 'var(--color-accent)' }}
                />
              </div>
              <div className="flex items-baseline justify-between gap-3 text-[11px] mt-1.5">
                <span className="text-accent-ink">This payment ₹{formatINR(Number(amount) || 0)}</span>
                <span className="text-ink-faint">Remaining ₹{formatINR(remaining)}</span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-end gap-3 mt-4">
                <div className="flex-1 min-w-0">
                  <label htmlFor="pay-amount" className="sr-only">Amount received</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint text-lg leading-none pointer-events-none">₹</span>
                    <input
                      id="pay-amount"
                      type="number"
                      step="any"
                      required
                      min="0.01"
                      max={curBalance + 0.5}
                      value={amount || ''}
                      onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                      placeholder="0.00"
                      className="w-full bg-surface-sunken border border-line rounded-control pl-8 pr-3 py-2.5
                                 numeral text-[1.35rem] text-ink min-h-[52px]
                                 transition-[border-color,box-shadow] duration-[var(--duration-fast)]
                                 hover:border-line-strong focus:border-accent focus:outline-none focus:ring-focus"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {[
                    { label: '25%', value: Math.round(curBalance * 25) / 100 },
                    { label: '50%', value: Math.round(curBalance * 50) / 100 },
                    { label: 'Full', value: curBalance },
                  ].map(q => (
                    <button
                      key={q.label}
                      type="button"
                      onClick={() => setAmount(q.value)}
                      className={cx(
                        'px-3 min-h-[38px] rounded-control border text-[12.5px] cursor-pointer',
                        'transition-colors duration-[140ms]',
                        Math.abs((Number(amount) || 0) - q.value) < 0.01
                          ? 'border-accent-line bg-accent-soft text-accent-ink font-medium'
                          : 'border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink'
                      )}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ---------------------------------------------- 3. how it was paid */}
        <section>
          <h3 className="label-micro mb-2">Method and date</h3>

          <div
            role="radiogroup"
            aria-label="Payment method"
            className="flex items-center gap-1 p-1 rounded-control bg-surface-sunken border border-line overflow-x-auto scrollbar-none"
          >
            {methods.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={method === m.value}
                title={m.label}
                onClick={() => setMethod(m.value)}
                className={cx(
                  'flex-1 min-w-[68px] min-h-[36px] px-3 rounded-[6px] text-[12.5px] whitespace-nowrap cursor-pointer',
                  'transition-[background-color,color] duration-[140ms]',
                  method === m.value
                    ? 'bg-surface-muted text-ink font-medium shadow-card'
                    : 'text-ink-faint hover:text-ink'
                )}
              >
                {m.short}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <Field label="Receipt date" htmlFor="pay-date" required>
              <Input
                id="pay-date"
                type="date"
                required
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </Field>

            <Field
              label="UTR / cheque / reference"
              htmlFor="pay-ref"
              hint={needsReference ? 'Recommended so the receipt can be traced' : undefined}
            >
              <div className="relative">
                <Hash className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
                  strokeWidth={1.8} aria-hidden="true" />
                <Input
                  id="pay-ref"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="UTR-HDFC9982710"
                  className="pl-9 font-mono"
                />
              </div>
            </Field>
          </div>
        </section>

        {/* ---------------------------------------------- 4. the rest, folded away */}
        <section>
          <button
            type="button"
            onClick={() => setShowDetails(v => !v)}
            aria-expanded={showDetails}
            className="flex items-center gap-1.5 text-[12.5px] text-ink-faint hover:text-ink
                       cursor-pointer transition-colors duration-[140ms]"
          >
            <ChevronDown
              className={cx('w-4 h-4 transition-transform duration-[200ms]', showDetails && 'rotate-180')}
              strokeWidth={1.8}
              aria-hidden="true"
            />
            Deposit account and remarks
          </button>

          {showDetails && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 animate-fade-in">
              <Field label="Deposited to" htmlFor="pay-bank">
                <div className="relative">
                  <Landmark className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none z-10"
                    strokeWidth={1.8} aria-hidden="true" />
                  <Select
                    id="pay-bank"
                    value={bankAccountId}
                    onChange={(e) => setBankAccountId(e.target.value)}
                    className="pl-9"
                  >
                    <option value="">Default company account</option>
                    {bankAccounts.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.bank_name} · {String(b.account_number || '').slice(-4)}
                      </option>
                    ))}
                  </Select>
                </div>
              </Field>

              <Field label="Remarks" htmlFor="pay-notes">
                <Input
                  id="pay-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Received against transport consignment"
                />
              </Field>
            </div>
          )}
        </section>
      </form>
    </Modal>
  );
};
