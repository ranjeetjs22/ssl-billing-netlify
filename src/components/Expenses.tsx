import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Receipt } from 'lucide-react';
import { apiRequest } from '../services/api.js';
import { formatINR } from '../utils/format.js';
import {
  Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, Select, Modal, FormError, IconButton, Toast,
  Segmented, DataTable, BarRank,
} from './ui.js';
import type { Column } from './ui.js';

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

  const openNew = () => {
    setFormError(null);
    setEditing({ expense_date: iso(new Date()), category: categories[0] || 'Miscellaneous', amount: 0, payment_method: 'Cash' });
  };
  const openEdit = (x: Expense) => { setFormError(null); setEditing(x); };

  const rowActions = (x: Expense) => (
    // Keys and clicks here must not also open the row's editor
    <div className="flex items-center justify-end gap-0.5 shrink-0" onKeyDown={(e) => e.stopPropagation()}>
      <IconButton label="Edit expense" onClick={(e) => { e.stopPropagation(); openEdit(x); }}>
        <Pencil />
      </IconButton>
      <IconButton label="Delete expense" onClick={(e) => { e.stopPropagation(); remove(x); }} className="hover:!text-danger-ink">
        <Trash2 />
      </IconButton>
    </div>
  );

  const columns: Column<Expense>[] = [
    { key: 'date', header: 'Date', className: 'whitespace-nowrap tabular-nums w-[104px]', cell: (x) => x.expense_date },
    {
      key: 'desc', header: 'Description', className: 'max-w-[280px]',
      cell: (x) => <span className="block truncate text-ink">{x.description || x.category}</span>,
    },
    { key: 'cat', header: 'Category', className: 'whitespace-nowrap', cell: (x) => x.category },
    { key: 'method', header: 'Paid by', hideBelow: 'lg', className: 'whitespace-nowrap', cell: (x) => x.payment_method || <span className="text-ink-faint">-</span> },
    {
      key: 'ref', header: 'Reference', hideBelow: 'lg', className: 'whitespace-nowrap',
      cell: (x) => x.reference ? <span className="font-mono text-[13px]">{x.reference}</span> : <span className="text-ink-faint">-</span>,
    },
    {
      key: 'amount', header: 'Amount', align: 'right', className: 'whitespace-nowrap',
      cell: (x) => <span className="tabular-nums font-medium text-ink">₹{formatINR(x.amount)}</span>,
    },
    { key: 'actions', header: '', align: 'right', className: 'w-[76px] !py-1', cell: rowActions },
  ];

  return (
    <div className="space-y-3 sm:space-y-4">
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

      <div className="flex flex-wrap items-center gap-2">
        <Segmented<PeriodKey> label="Period" value={period} onChange={setPeriod}
          options={PERIODS.map(p => ({ value: p.key, label: p.label }))} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 items-start">
        <Card padded={false} className="lg:col-span-1">
          <div className="px-3 sm:px-4 py-3 border-b border-line">
            <div className="text-xs text-ink-faint">Total expenses</div>
            {loading ? <div className="skeleton h-6 w-28 mt-1" /> :
              <div className="numeral text-lg sm:text-xl leading-tight text-ink mt-0.5">₹{formatINR(total)}</div>}
            <div className="text-xs text-ink-faint mt-0.5">{items.length} entr{items.length === 1 ? 'y' : 'ies'}</div>
          </div>
          <div className="p-3 sm:p-4">
            <h3 className="text-sm font-semibold text-ink mb-2.5">By category</h3>
            {loading ? (
              <div className="space-y-2" aria-hidden="true">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-4" />)}</div>
            ) : top.length === 0 ? (
              <p className="text-sm text-ink-faint">Nothing recorded in this period.</p>
            ) : (
              <BarRank rows={top.map(c => ({ label: c.category, value: c.amount }))} format={(n) => `₹${formatINR(n)}`} />
            )}
            <p className="text-xs text-ink-faint mt-3 pt-3 border-t border-line">
              Lorry hire and other trip costs go on the bill itself, not here, so they are never counted twice.
            </p>
          </div>
        </Card>

        <Card padded={false} className="lg:col-span-2 overflow-hidden">
          <CardHeader title="Entries"
            hint={!loading ? `${items.length} in this period` : undefined}
            actions={<Button variant="primary" size="sm" icon={<Plus />} onClick={openNew}>Add expense</Button>} />
          {error ? <ErrorState message={error} onRetry={load} /> : (
            <DataTable
              caption="Expenses"
              loading={loading}
              rows={items}
              columns={columns}
              onRowClick={openEdit}
              empty={
                <EmptyState icon={<Receipt />} title="No expenses in this period"
                  message="Record rent, salaries, phone and other overheads to see net profit." />
              }
              mobileCard={(x) => (
                <div className="flex items-center gap-2 min-w-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm text-ink truncate">{x.description || x.category}</span>
                      <span className="tabular-nums font-medium text-ink text-sm shrink-0">₹{formatINR(x.amount)}</span>
                    </div>
                    <div className="text-xs text-ink-faint truncate mt-0.5">
                      <span className="tabular-nums">{x.expense_date}</span> · {x.category}
                      {x.payment_method ? ` · ${x.payment_method}` : ''}
                      {x.reference ? <> · <span className="font-mono">{x.reference}</span></> : null}
                    </div>
                  </div>
                  {rowActions(x)}
                </div>
              )}
            />
          )}
        </Card>
      </div>

      {editing && (
        <Modal onClose={() => setEditing(null)} title={editing.id ? 'Edit expense' : 'Add expense'}
          subtitle="Operating overheads only" size="md"
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
                <Input id="ex-ref" value={editing.reference || ''} placeholder="UTR / cheque no" className="font-mono"
                  onChange={e => setEditing({ ...editing, reference: e.target.value })} />
              </Field>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
