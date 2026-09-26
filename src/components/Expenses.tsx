import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Receipt } from 'lucide-react';
import { apiRequest } from '../services/api.js';
import { formatINR } from '../utils/format.js';
import {
  Button, Card, EmptyState, ErrorState, Field, Input, Select, Modal, FormError, IconButton, Toast, cx,
} from './ui.js';

interface Expense {
  id: string;
  expense_date: string;
  category: string;
  description?: string;
  amount: number;
  payment_method?: string | null;
  reference?: string | null;
  notes?: string | null;
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

type PeriodKey = 'this_month' | 'last_month' | 'this_fy' | 'all';
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'this_fy', label: 'This FY' },
  { key: 'all', label: 'All time' },
];
const rangeFor = (key: PeriodKey) => {
  const n = new Date(); const y = n.getFullYear(); const m = n.getMonth();
  if (key === 'this_month') return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
  if (key === 'last_month') return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
  if (key === 'this_fy') { const s = m >= 3 ? y : y - 1; return { from: iso(new Date(s, 3, 1)), to: iso(new Date(s + 1, 2, 31)) }; }
  return { from: '', to: '' };
};

const METHODS = ['Cash', 'Bank Transfer', 'UPI', 'Cheque', 'Card', 'Other'];

/**
 * Operating expenses: rent, salaries, phone and the like. Trip costs such as
 * lorry hire belong on the bill itself, so they are not entered here.
 */
export const Expenses: React.FC = () => {
  const [period, setPeriod] = useState<PeriodKey>('this_month');
  const [items, setItems] = useState<Expense[]>([]);
  const [total, setTotal] = useState(0);
  const [byCategory, setByCategory] = useState<{ category: string; amount: number }[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Expense> | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { from, to } = rangeFor(period);
      const qs = new URLSearchParams(); if (from) qs.set('from', from); if (to) qs.set('to', to);
      const res = await apiRequest<any>(`/expenses${qs.toString() ? `?${qs}` : ''}`);
      setItems(res.items || []); setTotal(res.total || 0); setByCategory(res.by_category || []);
    } catch (e: any) {
      setError(e.message || 'Could not load expenses');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiRequest<string[]>('/expenses/categories').then(setCategories).catch(() => setCategories([]));
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    if (!(Number(editing.amount) > 0)) { setFormError('Enter an amount greater than zero.'); return; }
    setSaving(true); setFormError(null);
    try {
      const body = JSON.stringify(editing);
      if (editing.id) await apiRequest(`/expenses/${editing.id}`, { method: 'PUT', body });
      else await apiRequest('/expenses', { method: 'POST', body });
      setEditing(null);
      setToast(editing.id ? 'Expense updated.' : 'Expense added.');
      load();
    } catch (err: any) {
      setFormError(err.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (x: Expense) => {
    if (!window.confirm(`Delete this expense of ₹${formatINR(x.amount)}?`)) return;
    try {
      await apiRequest(`/expenses/${x.id}`, { method: 'DELETE' });
      setToast('Expense deleted.');
      load();
    } catch (err: any) {
      setToast(err.message || 'Could not delete');
    }
  };

  const top = useMemo(() => byCategory.slice(0, 6), [byCategory]);
  const maxCat = Math.max(1, ...top.map(c => c.amount));

  return (
    <div className="space-y-3">
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Period"
          className="flex items-center gap-0.5 p-0.5 rounded-control bg-surface-sunken border border-line">
          {PERIODS.map(p => (
            <button key={p.key} role="tab" aria-selected={period === p.key} onClick={() => setPeriod(p.key)}
              className={cx('px-2.5 h-7 rounded-[6px] text-[12px] whitespace-nowrap cursor-pointer transition-colors',
                period === p.key ? 'bg-surface-muted text-ink font-medium shadow-card' : 'text-ink-faint hover:text-ink')}>
              {p.label}
            </button>
          ))}
        </div>
        <Button variant="primary" size="sm" icon={<Plus className="w-4 h-4" />} className="ml-auto"
          onClick={() => { setFormError(null); setEditing({ expense_date: iso(new Date()), category: categories[0] || 'Miscellaneous', amount: 0, payment_method: 'Cash' }); }}>
          Add expense
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
        <Card padded={false} className="lg:col-span-1">
          <div className="px-3.5 pt-3 pb-3 border-b border-line">
            <div className="text-[10.5px] uppercase tracking-[0.06em] text-ink-faint font-medium">Total expenses</div>
            {loading ? <div className="skeleton h-6 w-28 mt-1.5" /> :
              <div className="numeral text-[1.3rem] text-ink mt-1">₹{formatINR(total)}</div>}
            <div className="text-[11px] text-ink-faint">{items.length} entr{items.length === 1 ? 'y' : 'ies'}</div>
          </div>
          <div className="p-3.5 space-y-2.5">
            {top.length === 0 && !loading && <p className="text-[12px] text-ink-faint">Nothing recorded in this period.</p>}
            {top.map(c => (
              <div key={c.category}>
                <div className="flex items-baseline justify-between text-[12px]">
                  <span className="text-ink-soft truncate">{c.category}</span>
                  <span className="font-mono text-ink">₹{formatINR(c.amount)}</span>
                </div>
                <div className="h-[3px] rounded-full bg-surface-sunken mt-1 overflow-hidden">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(c.amount / maxCat) * 100}%` }} />
                </div>
              </div>
            ))}
            <p className="text-[11px] text-ink-faint pt-1 border-t border-line">
              Lorry hire and other trip costs go on the bill itself, not here, so they are never counted twice.
            </p>
          </div>
        </Card>

        <Card padded={false} className="lg:col-span-2 overflow-hidden">
          {error ? <ErrorState message={error} onRetry={load} /> : loading ? (
            <div className="p-3 space-y-1.5">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-9" />)}</div>
          ) : items.length === 0 ? (
            <EmptyState icon={<Receipt className="w-5 h-5" />} title="No expenses in this period"
              message="Record rent, salaries, phone and other overheads to see net profit." />
          ) : (
            <ul className="divide-y divide-line">
              {items.map(x => (
                <li key={x.id} className="flex items-center gap-3 px-3.5 py-2 hover:bg-surface-muted transition-colors">
                  <div className="w-[74px] shrink-0 text-[11.5px] text-ink-faint font-mono">{x.expense_date}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] text-ink truncate">{x.description || x.category}</div>
                    <div className="text-[11px] text-ink-faint truncate">
                      {x.category}{x.payment_method ? ` · ${x.payment_method}` : ''}{x.reference ? ` · ${x.reference}` : ''}
                    </div>
                  </div>
                  <div className="font-mono text-[12.5px] text-ink shrink-0">₹{formatINR(x.amount)}</div>
                  <div className="flex items-center shrink-0">
                    <IconButton label="Edit expense" onClick={() => { setFormError(null); setEditing(x); }} className="w-8 h-8">
                      <Pencil className="w-3.5 h-3.5" />
                    </IconButton>
                    <IconButton label="Delete expense" onClick={() => remove(x)} className="w-8 h-8 hover:text-danger-ink">
                      <Trash2 className="w-3.5 h-3.5" />
                    </IconButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {editing && (
        <Modal onClose={() => setEditing(null)} title={editing.id ? 'Edit expense' : 'Add expense'}
          subtitle="Operating overheads only" icon={<Receipt className="w-4 h-4" />} size="md"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" type="button" onClick={() => setEditing(null)}>Cancel</Button>
              <Button variant="primary" type="submit" form="expense-form" loading={saving}>Save</Button>
            </div>
          }>
          <form id="expense-form" onSubmit={save} className="space-y-3">
            {formError && <FormError message={formError} />}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date" htmlFor="ex-date" required>
                <Input id="ex-date" type="date" required value={editing.expense_date || ''}
                  onChange={e => setEditing({ ...editing, expense_date: e.target.value })} />
              </Field>
              <Field label="Amount" htmlFor="ex-amt" required>
                <Input id="ex-amt" type="number" min="0.01" step="any" required value={editing.amount || ''}
                  onChange={e => setEditing({ ...editing, amount: parseFloat(e.target.value) || 0 })} />
              </Field>
            </div>
            <Field label="Category" htmlFor="ex-cat">
              <Select id="ex-cat" value={editing.category || ''} onChange={e => setEditing({ ...editing, category: e.target.value })}>
                {(categories.length ? categories : ['Miscellaneous']).map(c => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Description" htmlFor="ex-desc">
              <Input id="ex-desc" value={editing.description || ''} placeholder="Office rent for September"
                onChange={e => setEditing({ ...editing, description: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Paid by" htmlFor="ex-method">
                <Select id="ex-method" value={editing.payment_method || ''} onChange={e => setEditing({ ...editing, payment_method: e.target.value })}>
                  {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </Select>
              </Field>
              <Field label="Reference" htmlFor="ex-ref">
                <Input id="ex-ref" value={editing.reference || ''} placeholder="UTR / cheque no"
                  onChange={e => setEditing({ ...editing, reference: e.target.value })} />
              </Field>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
