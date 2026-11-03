import React, { useState, useEffect, useMemo } from 'react';
import {
  Wallet, Search, Check, ChevronDown, Landmark, Hash,
} from 'lucide-react';
import { apiRequest } from '../services/api.js';
import { Invoice, BankAccount } from '../types.js';
import { formatINR } from '../utils/format.js';
import {
  Modal, Button, Field, Input, Select, Segmented, FormError, cx,
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

  // ---- one receipt over several invoices ----
  const [mode, setMode] = useState<'single' | 'multi'>('single');
  const [bulkCustomerId, setBulkCustomerId] = useState('');
  const [bulkTotal, setBulkTotal] = useState<number>(0);
  const [alloc, setAlloc] = useState<Record<string, number>>({});

  /** Customers with something due, from the pending list. */
  const dueCustomers = useMemo(() => {
    const map = new Map<string, { id: string; name: string; due: number; count: number }>();
    for (const i of invoices) {
      const id = i.customer_id || '';
      if (!id) continue;
      const cur = map.get(id) || { id, name: i.buyer?.name || 'Customer', due: 0, count: 0 };
      cur.due += Number(i.balance ?? i.grand_total ?? 0);
      cur.count += 1;
      map.set(id, cur);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [invoices]);

  /** That customer's unpaid bills, oldest first - the order money is applied in. */
  const bulkInvoices = useMemo(() => invoices
    .filter(i => i.customer_id === bulkCustomerId)
    .sort((a, b) => (a.invoice_date || '').localeCompare(b.invoice_date || '') || String(a.invoice_no).localeCompare(String(b.invoice_no))),
  [invoices, bulkCustomerId]);

  const dueOf = (i: Invoice) => Number(i.balance ?? i.grand_total ?? 0);
  const allocatedTotal = Math.round(Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0) * 100) / 100;

  /** Spread an amount over the bills, settling the oldest first. */
  const autoAllocate = (total: number, list = bulkInvoices) => {
    let left = Math.round(total * 100) / 100;
    const next: Record<string, number> = {};
    for (const i of list) {
      if (left <= 0) break;
      const take = Math.min(left, dueOf(i));
      next[i.id] = Math.round(take * 100) / 100;
      left = Math.round((left - take) * 100) / 100;
    }
    setAlloc(next);
  };

  const pickBulkCustomer = (id: string) => {
    setBulkCustomerId(id);
    setAlloc({});
    setBulkTotal(0);
  };

  const toggleBulkInvoice = (i: Invoice) => {
    setAlloc(prev => {
      const next = { ...prev };
      if (next[i.id]) delete next[i.id]; else next[i.id] = dueOf(i);
      return next;
    });
  };
  const bulkOver = bulkInvoices.find(i => (alloc[i.id] || 0) > dueOf(i) + 0.5);

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
    if (mode === 'multi') return saveBulk();
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

  const saveBulk = async () => {
    const allocations = Object.entries(alloc)
      .filter(([, v]) => (Number(v) || 0) > 0)
      .map(([invoice_id, amount]) => ({ invoice_id, amount: Number(amount) }));
    if (allocations.length === 0) { setError('Enter an amount against at least one invoice.'); return; }
    if (bulkOver) { setError(`The amount on ${bulkOver.invoice_no} is more than its balance of ₹${formatINR(dueOf(bulkOver))}.`); return; }
    setSaving(true);
    setError(null);
    try {
      const bank = bankAccounts.find(b => b.id === bankAccountId);
      await apiRequest('/payments/bulk', {
        method: 'POST',
        body: JSON.stringify({
          allocations,
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

  const bulkCount = Object.values(alloc).filter(v => (Number(v) || 0) > 0).length;
  const paidPct = curTotal > 0 ? Math.min(100, (curPaid / curTotal) * 100) : 0;
  const thisPct = curTotal > 0 ? Math.min(100 - paidPct, ((Number(amount) || 0) / curTotal) * 100) : 0;

  return (
    <Modal
      onClose={onClose}
      title="Record payment"
      subtitle={mode === 'multi'
        ? 'One receipt split across several invoices'
        : curInvoice ? `Against ${curInvoice.invoice_no}` : 'Credit against a pending invoice'}
      icon={<Wallet className="w-[18px] h-[18px]" strokeWidth={1.8} />}
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-ink-faint hidden sm:block">
            {mode === 'multi'
              ? bulkCount ? `₹${formatINR(allocatedTotal)} over ${bulkCount} invoice${bulkCount === 1 ? '' : 's'}` : 'Pick a customer and the invoices paid'
              : curInvoice
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
              disabled={mode === 'multi' ? bulkCount === 0 : !selectedInvoiceId || amount <= 0}
              icon={<Check className="w-4 h-4" />}
            >
              {mode === 'multi'
                ? `Record ${bulkCount || ''} payment${bulkCount === 1 ? '' : 's'}`.replace('  ', ' ')
                : isPartial ? 'Record part payment' : 'Record payment'}
            </Button>
          </div>
        </div>
      }
    >
      <form id="payment-form" onSubmit={handleSave} className="space-y-4">
        {error && <FormError message={error} />}

        <Segmented<'single' | 'multi'>
          label="Payment against"
          options={[{ value: 'single', label: 'One invoice' }, { value: 'multi', label: 'Multiple invoices' }]}
          value={mode}
          onChange={(v) => {
            setMode(v);
            setError(null);
            // Start the multi view on the customer of the invoice already picked
            if (v === 'multi' && !bulkCustomerId && curInvoice?.customer_id) pickBulkCustomer(curInvoice.customer_id);
          }}
        />

        {mode === 'multi' && (
          <section className="space-y-3">
            <Field label="Customer" htmlFor="bulk-cust" required>
              <Select id="bulk-cust" value={bulkCustomerId} onChange={(e) => pickBulkCustomer(e.target.value)}>
                <option value="">Select a customer with dues</option>
                {dueCustomers.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.count} bill{c.count === 1 ? '' : 's'} · ₹{formatINR(c.due)} due
                  </option>
                ))}
              </Select>
            </Field>

            {bulkCustomerId && (
              <>
                <div className="panel p-3 sm:p-4 space-y-2">
                  <label htmlFor="bulk-total" className="text-xs font-medium text-ink-soft block">Total amount received</label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint text-base leading-none pointer-events-none">₹</span>
                      <input
                        id="bulk-total"
                        type="number" step="any" min="0" inputMode="decimal"
                        value={bulkTotal || ''}
                        onChange={(e) => { const v = parseFloat(e.target.value) || 0; setBulkTotal(v); autoAllocate(v); }}
                        placeholder="0.00"
                        className="w-full bg-surface border border-line rounded-control pl-7 pr-3 h-11 sm:h-10 numeral text-lg text-ink
                                   hover:border-line-strong focus:border-accent focus:outline-none focus:ring-focus"
                      />
                    </div>
                    <Button type="button" variant="secondary" onClick={() => {
                      const all = Math.round(bulkInvoices.reduce((s, i) => s + dueOf(i), 0) * 100) / 100;
                      setBulkTotal(all); autoAllocate(all);
                    }}>
                      Pay all due
                    </Button>
                  </div>
                  <p className="text-xs text-ink-faint">
                    Applied to the oldest bills first. Tick bills or edit the amounts below to change it.
                    {bulkTotal > 0 && Math.abs(bulkTotal - allocatedTotal) > 0.01 && (
                      <span className="text-warning-ink">
                        {' '}Allocated ₹{formatINR(allocatedTotal)} of ₹{formatINR(bulkTotal)}
                        {bulkTotal > allocatedTotal ? ` - ₹${formatINR(bulkTotal - allocatedTotal)} is more than these bills owe.` : '.'}
                      </span>
                    )}
                  </p>
                </div>

                <div className="rounded-card border border-line divide-y divide-line max-h-[260px] overflow-y-auto overscroll-contain">
                  {bulkInvoices.map(inv => {
                    const on = (alloc[inv.id] || 0) > 0;
                    const over = (alloc[inv.id] || 0) > dueOf(inv) + 0.5;
                    return (
                      <div key={inv.id} className={cx('flex items-center gap-3 px-3 py-2', on && 'bg-accent-soft')}>
                        <input type="checkbox" checked={on} onChange={() => toggleBulkInvoice(inv)}
                          aria-label={`Include ${inv.invoice_no}`}
                          className="w-4 h-4 accent-[var(--color-accent-strong)] shrink-0 cursor-pointer" />
                        <span className="min-w-0 flex-1">
                          <span className="block font-mono text-[13px] text-ink truncate">{inv.invoice_no}</span>
                          <span className="block text-xs text-ink-faint truncate">
                            <span className="tabular-nums">{inv.invoice_date}</span>{inv.lr_no ? ` · ${/^lr/i.test(String(inv.lr_no)) ? inv.lr_no : `LR ${inv.lr_no}`}` : ''} · <span className="tabular-nums">₹{formatINR(dueOf(inv))}</span> due
                          </span>
                        </span>
                        <input
                          type="number" step="any" min="0" inputMode="decimal"
                          aria-label={`Amount for ${inv.invoice_no}`}
                          value={alloc[inv.id] || ''}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value) || 0;
                            setAlloc(prev => { const n = { ...prev }; if (v > 0) n[inv.id] = v; else delete n[inv.id]; return n; });
                          }}
                          placeholder="0"
                          className={cx('w-24 sm:w-28 shrink-0 text-right tabular-nums font-medium bg-surface border rounded-control px-2 h-9 text-sm text-ink focus:outline-none focus:border-accent focus:ring-focus',
                            over ? 'border-danger' : 'border-line')}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink-faint">{bulkCount} of {bulkInvoices.length} bills selected</span>
                  <span className="text-ink-faint">Total <span className="tabular-nums font-semibold text-ink">₹{formatINR(allocatedTotal)}</span></span>
                </div>
              </>
            )}
          </section>
        )}

        {mode === 'single' && (<>
        {/* ---------------------------------------------- 1. which invoice */}
        <section>
          <div className="flex items-center justify-between gap-3 mb-2">
            <h3 className="text-sm font-semibold text-ink">Invoice</h3>
            <span className="text-xs text-ink-faint tabular-nums">
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
                    active ? 'border-accent-strong bg-accent-strong text-on-accent' : 'border-line-strong'
                  )} aria-hidden="true">
                    {active && <Check className="w-2.5 h-2.5" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[13px] text-ink truncate">{inv.invoice_no}</span>
                    <span className="block text-xs text-ink-faint truncate">{inv.buyer?.name || 'Customer'}</span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block tabular-nums font-medium text-sm text-ink">₹{formatINR(bal)}</span>
                    <span className="block text-xs text-ink-faint">due</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* ---------------------------------------------- 2. how much */}
        {curInvoice && (
          <section>
            <h3 className="text-sm font-semibold text-ink mb-2">Amount</h3>

            <div className="panel p-3 sm:p-4">
              {/* where this invoice stands, and what this payment does to it */}
              <div className="flex items-baseline justify-between gap-3 text-xs text-ink-faint tabular-nums mb-1.5">
                <span>Invoice ₹{formatINR(curTotal)}</span>
                <span>Already paid ₹{formatINR(curPaid)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-surface-sunken overflow-hidden flex" aria-hidden="true">
                <div className="h-full bg-positive transition-[width] duration-300" style={{ width: `${paidPct}%` }} />
                <div
                  className="h-full transition-[width] duration-300"
                  style={{ width: `${thisPct}%`, background: 'var(--color-accent)' }}
                />
              </div>
              <div className="flex items-baseline justify-between gap-3 text-xs tabular-nums mt-1.5">
                <span className="text-accent-ink">This payment ₹{formatINR(Number(amount) || 0)}</span>
                <span className="text-ink-faint">Remaining ₹{formatINR(remaining)}</span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2 mt-3">
                <div className="flex-1 min-w-0">
                  <label htmlFor="pay-amount" className="sr-only">Amount received</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint text-base leading-none pointer-events-none">₹</span>
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
                      className="w-full bg-surface border border-line rounded-control pl-7 pr-3 h-11 sm:h-10
                                 numeral text-xl text-ink
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
                        'flex-1 sm:flex-none px-3 h-10 sm:h-9 rounded-control border text-sm cursor-pointer',
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

        </>)}

        {/* ---------------------------------------------- 3. how it was paid */}
        <section>
          <h3 className="text-sm font-semibold text-ink mb-2">Method and date</h3>

          <Segmented
            label="Payment method"
            options={methods.map((m) => ({ value: m.value, label: <span title={m.label}>{m.short}</span> }))}
            value={method}
            onChange={setMethod}
            className="w-full sm:w-auto [&>button]:flex-1 [&>button]:justify-center sm:[&>button]:flex-none"
          />

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
            className="flex items-center gap-1.5 text-sm text-ink-faint hover:text-ink
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
