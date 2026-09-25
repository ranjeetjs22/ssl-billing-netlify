import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Calculator, MapPin, Package, Truck, ChevronDown, ChevronUp, Plus, Trash2,
  Search, ArrowRight, Info, Save, Grid3x3, Sparkles, Check, Pencil, RotateCcw,
} from 'lucide-react';
import { apiRequest } from '../services/api.js';
import { formatINR } from '../utils/format.js';
import { buildQuote } from '../utils/rates.js';
import type { Place, Box, Quote, SpecialRate, MatrixRow, OdaSlab, RateSettings } from '../utils/rates.js';
import { useAuth } from '../context/AuthContext.js';
import {
  Button, IconButton, Card, Field, Input, Select, Badge, EmptyState, ErrorState,
  Spinner, Toast, FormError, cx,
} from './ui.js';

interface RateCard {
  zones: { code: string; name: string; sort_order: number }[];
  states: { name: string; zone_code: string }[];
  cities: { name: string; state_name: string; zone_code: string; ref_id?: number }[];
  matrix: MatrixRow[];
  specials: SpecialRate[];
  settings: RateSettings;
  oda: OdaSlab[];
}

/** One selectable pickup/delivery location, flattened from cities + states + zones. */
interface LocationOption extends Place {
  key: string;
  sub: string;
}

function buildOptions(card: RateCard): LocationOption[] {
  const out: LocationOption[] = [];
  for (const c of card.cities) {
    out.push({
      key: `city:${c.name}`, kind: 'city', city: c.name, state: c.state_name,
      zone: c.zone_code, label: c.name, sub: `${c.state_name} · ${c.zone_code}`,
    });
  }
  for (const s of card.states) {
    out.push({
      key: `state:${s.name}`, kind: 'state', state: s.name,
      zone: s.zone_code, label: s.name, sub: `State · ${s.zone_code}`,
    });
  }
  for (const z of card.zones) {
    out.push({
      key: `zone:${z.code}`, kind: 'zone', zone: z.code,
      label: `${z.name} (${z.code})`, sub: 'Whole zone',
    });
  }
  return out;
}

/* ------------------------------------------------------ location combobox */
const LocationPicker: React.FC<{
  id: string;
  label: string;
  value: LocationOption | null;
  options: LocationOption[];
  onChange: (o: LocationOption) => void;
  placeholder?: string;
}> = ({ id, label, value, options, onChange, placeholder }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = `${id}-listbox`;

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // Show cities first so the common case (pick a city) needs no typing
      return options.filter(o => o.kind === 'city').slice(0, 40);
    }
    return options
      .filter(o =>
        o.label!.toLowerCase().includes(q) ||
        (o.state || '').toLowerCase().includes(q) ||
        o.zone.toLowerCase().includes(q))
      .sort((a, b) => {
        const rank = (o: LocationOption) => (o.label!.toLowerCase().startsWith(q) ? 0 : 1);
        return rank(a) - rank(b);
      })
      .slice(0, 60);
  }, [query, options]);

  const choose = (o: LocationOption) => {
    onChange(o);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && matches[highlight]) { e.preventDefault(); choose(matches[highlight]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div ref={wrapRef} className="relative min-w-0">
      <Field label={label} htmlFor={id} required>
        <div className="relative">
          <MapPin className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-accent pointer-events-none z-10" aria-hidden="true" />
          <input
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            autoComplete="off"
            value={open ? query : (value?.label || '')}
            onFocus={() => { setOpen(true); setQuery(''); setHighlight(0); }}
            onChange={(e) => { setQuery(e.target.value); setHighlight(0); setOpen(true); }}
            onKeyDown={onKeyDown}
            placeholder={placeholder || 'Search city, state or zone'}
            className="w-full bg-surface-muted border border-line rounded-xl pl-9 pr-9 py-2.5 min-h-[44px] text-sm text-ink
                       placeholder:text-ink-faint transition-colors duration-150 hover:border-line-strong
                       focus:border-accent focus:bg-surface focus:outline-none"
          />
          <ChevronDown
            className={cx('w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none transition-transform', open && 'rotate-180')}
            aria-hidden="true"
          />
        </div>
      </Field>

      {value && !open && (
        <p className="mt-1 text-xs text-ink-faint truncate">{value.sub}</p>
      )}

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto overscroll-contain bg-surface border border-line
                     rounded-xl shadow-overlay py-1 animate-rise"
        >
          {matches.length === 0 && (
            <li className="px-3 py-3 text-sm text-ink-faint">No location matches “{query}”.</li>
          )}
          {matches.map((o, i) => (
            <li key={o.key} role="option" aria-selected={value?.key === o.key}>
              <button
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => choose(o)}
                className={cx(
                  'w-full text-left px-3 py-2 min-h-[44px] flex items-center justify-between gap-3 cursor-pointer transition-colors',
                  i === highlight ? 'bg-surface-sunken' : 'hover:bg-surface-muted'
                )}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink truncate">{o.label}</span>
                  <span className="block text-xs text-ink-faint truncate">{o.sub}</span>
                </span>
                <Badge tone={o.kind === 'city' ? 'accent' : o.kind === 'state' ? 'info' : 'neutral'}>
                  {o.kind}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/* ------------------------------------------------------------ rate chart */
const RateChart: React.FC<{
  card: RateCard;
  canEdit: boolean;
  onSaved: (msg: string) => void;
  reload: () => Promise<void>;
}> = ({ card, canEdit, onSaved, reload }) => {
  const zones = [...card.zones].sort((a, b) => a.sort_order - b.sort_order);

  const baseGrid = useMemo(() => {
    const g: Record<string, Record<string, number>> = {};
    for (const r of card.matrix) {
      if (!g[r.origin_zone]) g[r.origin_zone] = {};
      g[r.origin_zone][r.dest_zone] = Number(r.rate_per_kg);
    }
    return g;
  }, [card.matrix]);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const laneKey = (o: string, d: string) => `${o}|${d}`;
  const valueOf = (o: string, d: string) => {
    const k = laneKey(o, d);
    return draft[k] !== undefined ? draft[k] : String(baseGrid[o]?.[d] ?? '');
  };
  const isDirty = (o: string, d: string) => {
    const k = laneKey(o, d);
    if (draft[k] === undefined) return false;
    return Number(draft[k]) !== Number(baseGrid[o]?.[d]);
  };

  const dirtyCells = Object.keys(draft)
    .filter(k => { const [o, d] = k.split('|'); return isDirty(o, d); })
    .map(k => { const [o, d] = k.split('|'); return { origin_zone: o, dest_zone: d, rate_per_kg: Number(draft[k]) }; });

  const invalid = dirtyCells.filter(c => !(c.rate_per_kg > 0));

  const save = async () => {
    if (invalid.length) { setError('Every rate must be greater than 0.'); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await apiRequest<{ updated: number; failed: any[] }>('/rates/matrix/bulk', {
        method: 'PUT',
        body: JSON.stringify({ cells: dirtyCells }),
      });
      await reload();
      setDraft({});
      setEditing(false);
      onSaved(`Saved ${res.updated} zone rate${res.updated === 1 ? '' : 's'}.`);
    } catch (err: any) {
      setError(err.message || 'Could not save the rate chart.');
    } finally {
      setSaving(false);
    }
  };

  const values = card.matrix.map(m => Number(m.rate_per_kg));
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const toneFor = (v: number) => {
    const t = (v - lo) / (hi - lo || 1);
    if (t < 0.25) return 'bg-positive-soft text-positive-ink';
    if (t < 0.55) return 'bg-info-soft text-info-ink';
    if (t < 0.8) return 'bg-warning-soft text-warning-ink';
    return 'bg-danger-soft text-danger-ink';
  };

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-line flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-ink">Base zone rate chart</h2>
          <p className="text-sm text-ink-faint mt-0.5">
            Rupees per kg. Rows are pickup zones, columns are delivery zones. Special rates override these.
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2 sm:ml-auto shrink-0">
            {editing ? (
              <>
                <Button variant="ghost" size="sm" icon={<RotateCcw className="w-4 h-4" />}
                  onClick={() => { setDraft({}); setEditing(false); setError(null); }}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" icon={<Save className="w-4 h-4" />}
                  onClick={save} loading={saving} disabled={dirtyCells.length === 0}>
                  Save{dirtyCells.length ? ` (${dirtyCells.length})` : ''}
                </Button>
              </>
            ) : (
              <Button variant="secondary" size="sm" icon={<Pencil className="w-4 h-4" />} onClick={() => setEditing(true)}>
                Edit rates
              </Button>
            )}
          </div>
        )}
      </div>

      {error && <div className="px-4 sm:px-5 pt-4"><FormError message={error} /></div>}

      {editing && (
        <p className="px-4 sm:px-5 pt-3 text-xs text-ink-faint flex items-center gap-1">
          <Info className="w-3 h-3 shrink-0" aria-hidden="true" />
          Changed cells are outlined. Nothing is saved until you press Save.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <caption className="sr-only">Zone to zone freight rate per kilogram</caption>
          <thead>
            <tr className="bg-surface-muted border-b border-line">
              <th scope="col" className="py-3 px-4 text-left text-xs font-semibold uppercase tracking-wide text-ink-faint sticky left-0 bg-surface-muted">
                From ↓ / To →
              </th>
              {zones.map(z => (
                <th key={z.code} scope="col" className="py-3 px-3 text-center text-xs font-semibold uppercase tracking-wide text-ink-faint whitespace-nowrap">
                  {z.code}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {zones.map(row => (
              <tr key={row.code}>
                <th scope="row" className="py-2.5 px-4 text-left font-semibold text-ink whitespace-nowrap sticky left-0 bg-surface">
                  {row.code}
                  <span className="block text-xs font-normal text-ink-faint">{row.name}</span>
                </th>
                {zones.map(col => {
                  const v = baseGrid[row.code]?.[col.code];
                  if (v === undefined) return <td key={col.code} className="py-2 px-3 text-center text-ink-faint">—</td>;
                  if (!editing) {
                    return (
                      <td key={col.code} className="py-2 px-3 text-center">
                        <span className={cx('inline-block min-w-[3.25rem] rounded-lg py-1 font-mono font-semibold', toneFor(v))}>
                          {v}
                        </span>
                      </td>
                    );
                  }
                  const dirty = isDirty(row.code, col.code);
                  return (
                    <td key={col.code} className="py-1.5 px-2 text-center">
                      <label className="sr-only" htmlFor={`cell-${row.code}-${col.code}`}>
                        Rate from {row.code} to {col.code}
                      </label>
                      <input
                        id={`cell-${row.code}-${col.code}`}
                        type="number" min="0" step="any" inputMode="decimal"
                        value={valueOf(row.code, col.code)}
                        onChange={e => setDraft(d => ({ ...d, [laneKey(row.code, col.code)]: e.target.value }))}
                        className={cx(
                          'w-[4.5rem] text-center font-mono font-semibold rounded-lg py-1.5 min-h-[40px] text-sm',
                          'border bg-surface text-ink focus:outline-none focus:border-accent transition-colors',
                          dirty ? 'border-accent ring-2 ring-accent/30' : 'border-line hover:border-line-strong'
                        )}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="p-4 border-t border-line flex flex-wrap items-center gap-3 text-xs text-ink-faint">
        <span className="font-semibold text-ink-soft">Cheapest</span>
        <span className="inline-block w-8 h-3 rounded bg-positive-soft border border-positive-line" />
        <span className="inline-block w-8 h-3 rounded bg-info-soft border border-info-line" />
        <span className="inline-block w-8 h-3 rounded bg-warning-soft border border-warning-line" />
        <span className="inline-block w-8 h-3 rounded bg-danger-soft border border-danger-line" />
        <span className="font-semibold text-ink-soft">Costliest</span>
        <span className="ml-auto">₹{lo}/kg – ₹{hi}/kg</span>
      </div>
    </Card>
  );
};

/* --------------------------------------------------------- special rates */
const KINDS: Array<'zone' | 'state' | 'city'> = ['zone', 'state', 'city'];

const SpecialRates: React.FC<{
  card: RateCard;
  canEdit: boolean;
  onSaved: (msg: string) => void;
  reload: () => Promise<void>;
}> = ({ card, canEdit, onSaved, reload }) => {
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState({
    origin_kind: 'zone' as 'zone' | 'state' | 'city', origin_value: '',
    dest_kind: 'city' as 'zone' | 'state' | 'city', dest_value: '',
    rate_per_kg: '', note: '',
  });

  const active = useMemo(() => card.specials.filter(r => r.is_active !== false), [card.specials]);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return active;
    return active.filter(r =>
      r.origin_value.toLowerCase().includes(t) ||
      r.dest_value.toLowerCase().includes(t) ||
      (r.note || '').toLowerCase().includes(t));
  }, [q, active]);

  const baseRate = (r: SpecialRate) => Number(r.rate_per_kg);
  const valueOf = (r: SpecialRate) => (r.id && draft[r.id] !== undefined ? draft[r.id] : String(baseRate(r)));
  const isDirty = (r: SpecialRate) => Boolean(r.id && draft[r.id] !== undefined && Number(draft[r.id]) !== baseRate(r));

  const dirtyRows = active
    .filter(isDirty)
    .map(r => ({ id: r.id!, rate_per_kg: Number(draft[r.id!]) }));
  const invalid = dirtyRows.filter(r => !(r.rate_per_kg > 0));

  const save = async () => {
    if (invalid.length) { setError('Every rate must be greater than 0.'); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await apiRequest<{ updated: number }>('/rates/special/bulk', {
        method: 'PUT',
        body: JSON.stringify({ rows: dirtyRows }),
      });
      await reload();
      setDraft({});
      setEditing(false);
      onSaved(`Saved ${res.updated} special rate${res.updated === 1 ? '' : 's'}.`);
    } catch (err: any) {
      setError(err.message || 'Could not save the special rates.');
    } finally {
      setSaving(false);
    }
  };

  const addRow = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!newRow.origin_value.trim() || !newRow.dest_value.trim()) {
      setError('Enter both a pickup and a delivery value.');
      return;
    }
    if (!(Number(newRow.rate_per_kg) > 0)) {
      setError('Rate must be greater than 0.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest('/rates/special', {
        method: 'POST',
        body: JSON.stringify({
          origin_kind: newRow.origin_kind, origin_value: newRow.origin_value.trim(),
          dest_kind: newRow.dest_kind, dest_value: newRow.dest_value.trim(),
          rate_per_kg: Number(newRow.rate_per_kg), note: newRow.note.trim() || 'Manual SPR',
        }),
      });
      await reload();
      setNewRow({ origin_kind: 'zone', origin_value: '', dest_kind: 'city', dest_value: '', rate_per_kg: '', note: '' });
      setAdding(false);
      onSaved('Special rate added.');
    } catch (err: any) {
      setError(err.message || 'Could not add the special rate.');
    } finally {
      setSaving(false);
    }
  };

  const removeRow = async (r: SpecialRate) => {
    if (!r.id) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/rates/special/${r.id}`, { method: 'DELETE' });
      await reload();
      onSaved(`Removed ${r.origin_value} → ${r.dest_value}.`);
    } catch (err: any) {
      setError(err.message || 'Could not remove the special rate.');
    } finally {
      setSaving(false);
    }
  };

  /** Value suggestions for the add form, so a typo cannot create a dead lane. */
  const suggestions = (kind: 'zone' | 'state' | 'city') =>
    kind === 'zone' ? card.zones.map(z => z.code)
      : kind === 'state' ? card.states.map(s => s.name)
        : card.cities.map(c => c.name);

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-line flex flex-col lg:flex-row lg:items-start gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-ink">Special rates (SPR)</h2>
          <p className="text-sm text-ink-faint mt-0.5">
            {active.length} lanes priced outside the zone chart. The most specific match wins.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          <div className="relative w-full sm:w-56">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none z-10" aria-hidden="true" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search a lane" aria-label="Search special rates" className="pl-9" />
          </div>
          {canEdit && (editing ? (
            <>
              <Button variant="ghost" size="sm" icon={<RotateCcw className="w-4 h-4" />}
                onClick={() => { setDraft({}); setEditing(false); setError(null); }}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" icon={<Save className="w-4 h-4" />}
                onClick={save} loading={saving} disabled={dirtyRows.length === 0}>
                Save{dirtyRows.length ? ` (${dirtyRows.length})` : ''}
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" size="sm" icon={<Pencil className="w-4 h-4" />} onClick={() => setEditing(true)}>
                Edit rates
              </Button>
              <Button variant="secondary" size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setAdding(a => !a)}>
                Add lane
              </Button>
            </>
          ))}
        </div>
      </div>

      {error && <div className="px-4 sm:px-5 pt-4"><FormError message={error} /></div>}

      {adding && canEdit && (
        <form onSubmit={addRow} className="p-4 sm:p-5 border-b border-line bg-surface-muted space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <Field label="From kind" htmlFor="spr-ok">
              <Select id="spr-ok" value={newRow.origin_kind}
                onChange={e => setNewRow(n => ({ ...n, origin_kind: e.target.value as any, origin_value: '' }))}>
                {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
              </Select>
            </Field>
            <Field label="From" htmlFor="spr-ov">
              <Input id="spr-ov" list="spr-origin-opts" value={newRow.origin_value}
                onChange={e => setNewRow(n => ({ ...n, origin_value: e.target.value }))} placeholder="e.g. W1" />
              <datalist id="spr-origin-opts">
                {suggestions(newRow.origin_kind).map(v => <option key={v} value={v} />)}
              </datalist>
            </Field>
            <Field label="To kind" htmlFor="spr-dk">
              <Select id="spr-dk" value={newRow.dest_kind}
                onChange={e => setNewRow(n => ({ ...n, dest_kind: e.target.value as any, dest_value: '' }))}>
                {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
              </Select>
            </Field>
            <Field label="To" htmlFor="spr-dv">
              <Input id="spr-dv" list="spr-dest-opts" value={newRow.dest_value}
                onChange={e => setNewRow(n => ({ ...n, dest_value: e.target.value }))} placeholder="e.g. Guwahati" />
              <datalist id="spr-dest-opts">
                {suggestions(newRow.dest_kind).map(v => <option key={v} value={v} />)}
              </datalist>
            </Field>
            <Field label="Rate per kg" htmlFor="spr-rate" required>
              <Input id="spr-rate" type="number" min="0" step="any" inputMode="decimal" className="font-mono"
                value={newRow.rate_per_kg} onChange={e => setNewRow(n => ({ ...n, rate_per_kg: e.target.value }))} placeholder="0" />
            </Field>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <Field label="Note" htmlFor="spr-note" className="flex-1">
              <Input id="spr-note" value={newRow.note} onChange={e => setNewRow(n => ({ ...n, note: e.target.value }))}
                placeholder="Why this lane is priced differently" />
            </Field>
            <div className="flex items-end gap-2">
              <Button type="button" variant="ghost" onClick={() => { setAdding(false); setError(null); }}>Cancel</Button>
              <Button type="submit" variant="primary" icon={<Plus className="w-4 h-4" />} loading={saving}>Add lane</Button>
            </div>
          </div>
        </form>
      )}

      {editing && (
        <p className="px-4 sm:px-5 pt-3 text-xs text-ink-faint flex items-center gap-1">
          <Info className="w-3 h-3 shrink-0" aria-hidden="true" />
          Changed rates are outlined. Nothing is saved until you press Save.
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState title="No matching special rate" message="Try a different city, state or zone." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[620px]">
            <thead className="bg-surface-muted border-b border-line">
              <tr>
                <th scope="col" className="py-3 px-4 text-left text-xs font-semibold uppercase tracking-wide text-ink-faint">From</th>
                <th scope="col" className="py-3 px-4 text-left text-xs font-semibold uppercase tracking-wide text-ink-faint">To</th>
                <th scope="col" className="py-3 px-4 text-right text-xs font-semibold uppercase tracking-wide text-ink-faint">Rate /kg</th>
                <th scope="col" className="py-3 px-4 text-left text-xs font-semibold uppercase tracking-wide text-ink-faint">Note</th>
                {canEdit && editing && <th scope="col" className="py-3 px-4 text-right text-xs font-semibold uppercase tracking-wide text-ink-faint">Remove</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r, i) => (
                <tr key={r.id || i} className="hover:bg-surface-muted transition-colors">
                  <td className="py-2.5 px-4">
                    <span className="font-medium text-ink">{r.origin_value}</span>
                    <Badge tone="neutral" className="ml-2">{r.origin_kind}</Badge>
                  </td>
                  <td className="py-2.5 px-4">
                    <span className="font-medium text-ink">{r.dest_value}</span>
                    <Badge tone={r.dest_kind === 'city' ? 'accent' : 'info'} className="ml-2">{r.dest_kind}</Badge>
                  </td>
                  <td className="py-1.5 px-4 text-right">
                    {editing && r.id ? (
                      <>
                        <label className="sr-only" htmlFor={`spr-${r.id}`}>Rate from {r.origin_value} to {r.dest_value}</label>
                        <input
                          id={`spr-${r.id}`}
                          type="number" min="0" step="any" inputMode="decimal"
                          value={valueOf(r)}
                          onChange={e => setDraft(d => ({ ...d, [r.id!]: e.target.value }))}
                          className={cx(
                            'w-[5rem] text-right font-mono font-semibold rounded-lg py-1.5 px-2 min-h-[40px] text-sm',
                            'border bg-surface text-ink focus:outline-none focus:border-accent transition-colors',
                            isDirty(r) ? 'border-accent ring-2 ring-accent/30' : 'border-line hover:border-line-strong'
                          )}
                        />
                      </>
                    ) : (
                      <span className="font-mono font-bold text-ink">₹{baseRate(r)}</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-ink-faint text-xs">{r.note}</td>
                  {canEdit && editing && (
                    <td className="py-2 px-4 text-right">
                      <IconButton label={`Remove ${r.origin_value} to ${r.dest_value}`} disabled={saving}
                        onClick={() => removeRow(r)} className="text-danger hover:bg-danger-soft">
                        <Trash2 className="w-4 h-4" />
                      </IconButton>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};

/* ================================================================ main */
type Tab = 'calculator' | 'chart' | 'special';

export const RateCalculator: React.FC<{ onCreateInvoice?: (q: Quote) => void }> = ({ onCreateInvoice }) => {
  const { user } = useAuth();
  // The API guards rate edits with the `settings` module — mirror that here so the
  // buttons only appear for someone who can actually save.
  const canEditRates = user?.role === 'admin' || Boolean(user?.modules?.includes('settings'));

  const [card, setCard] = useState<RateCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('calculator');
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // form state
  const [origin, setOrigin] = useState<LocationOption | null>(null);
  const [dest, setDest] = useState<LocationOption | null>(null);
  const [weight, setWeight] = useState<number>(0);
  const [declaredValue, setDeclaredValue] = useState<number>(0);
  const [boxes, setBoxes] = useState<Box[]>([{ count: 1, length_cm: 0, width_cm: 0, height_cm: 0 }]);
  const [showPrefs, setShowPrefs] = useState(false);
  const [appointment, setAppointment] = useState(false);
  const [oda, setOda] = useState(false);
  const [toPay, setToPay] = useState(false);
  const [cheque, setCheque] = useState(false);
  const [insurance, setInsurance] = useState<'none' | 'owner' | 'carrier'>('none');
  const [showBreakup, setShowBreakup] = useState(true);

  const loadCard = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiRequest<RateCard>('/rates/card');
      setCard(res);
    } catch (err: any) {
      setLoadError(err.message || 'Could not load the rate card');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCard(); }, [loadCard]);

  const options = useMemo(() => (card ? buildOptions(card) : []), [card]);

  // Default the pickup to Ahmedabad — that is where SSL books from.
  useEffect(() => {
    if (!origin && options.length) {
      setOrigin(options.find(o => o.key === 'city:Ahmedabad') || options[0]);
    }
  }, [options, origin]);

  /** Live quote, computed with the same engine the server uses — no network round-trip. */
  const quote: Quote | null = useMemo(() => {
    if (!card || !origin || !dest) return null;
    if (weight <= 0 && !boxes.some(b => b.count > 0 && b.length_cm > 0)) return null;
    try {
      return buildQuote(
        {
          origin, dest,
          dead_weight: weight,
          boxes: boxes.filter(b => b.count > 0),
          declared_value: declaredValue,
          appointment_delivery: appointment,
          oda, to_pay: toPay, cheque_payment: cheque,
          insurance,
        },
        card.settings, card.specials, card.matrix, card.oda
      );
    } catch {
      return null;
    }
  }, [card, origin, dest, weight, boxes, declaredValue, appointment, oda, toPay, cheque, insurance]);

  const updateBox = (i: number, patch: Partial<Box>) =>
    setBoxes(prev => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));

  const saveQuote = async () => {
    if (!quote || !origin || !dest) return;
    setSaving(true);
    try {
      await apiRequest('/rates/quotes', {
        method: 'POST',
        body: JSON.stringify({
          origin, dest, dead_weight: weight, boxes: boxes.filter(b => b.count > 0),
          declared_value: declaredValue, appointment_delivery: appointment,
          oda, to_pay: toPay, cheque_payment: cheque, insurance,
        }),
      });
      setToast('Quote saved.');
    } catch (err: any) {
      setToast(err.message || 'Could not save the quote.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner label="Loading rate card" />;
  if (loadError || !card) return <Card padded={false}><ErrorState message={loadError || undefined} onRetry={loadCard} /></Card>;

  const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'calculator', label: 'Calculator', icon: <Calculator className="w-4 h-4" /> },
    { key: 'chart', label: 'Rate chart', icon: <Grid3x3 className="w-4 h-4" /> },
    { key: 'special', label: 'Special rates', icon: <Sparkles className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-4 sm:space-y-5">
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

      <div role="tablist" aria-label="Rate calculator views"
        className="flex items-center gap-1 bg-surface border border-line rounded-xl p-1 overflow-x-auto shadow-card w-full sm:w-fit">
        {TABS.map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cx(
              'inline-flex items-center gap-2 px-3 min-h-[40px] rounded-lg text-sm font-medium whitespace-nowrap cursor-pointer transition-colors duration-150',
              tab === t.key ? 'bg-accent-strong text-on-accent font-semibold' : 'text-ink-soft hover:bg-surface-sunken hover:text-ink'
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'chart' && (
        <RateChart card={card} canEdit={canEditRates} onSaved={setToast} reload={loadCard} />
      )}
      {tab === 'special' && (
        <SpecialRates card={card} canEdit={canEditRates} onSaved={setToast} reload={loadCard} />
      )}

      {tab === 'calculator' && (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
          {/* ----------------------------------------------------- inputs */}
          <div className="xl:col-span-3 space-y-4">
            <Card>
              <h2 className="text-base font-bold text-ink mb-4 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-accent" aria-hidden="true" />
                Location details
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 sm:gap-2 items-start">
                <LocationPicker id="rc-origin" label="Pickup location" value={origin} options={options} onChange={setOrigin} />
                <div className="hidden sm:flex items-center justify-center pt-9 text-ink-faint" aria-hidden="true">
                  <ArrowRight className="w-5 h-5" />
                </div>
                <LocationPicker id="rc-dest" label="Delivery location" value={dest} options={options} onChange={setDest} />
              </div>

              {quote && (
                <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={quote.rate.source === 'special' ? 'accent' : 'info'}>
                    {quote.rate.source === 'special' ? 'Special rate' : 'Zone base rate'}
                  </Badge>
                  <span className="font-mono font-bold text-ink">₹{quote.rate.rate_per_kg}/kg</span>
                  <span className="text-ink-faint text-xs truncate">{quote.rate.matched}</span>
                </div>
              )}
            </Card>

            <Card>
              <h2 className="text-base font-bold text-ink mb-4 flex items-center gap-2">
                <Package className="w-4 h-4 text-accent" aria-hidden="true" />
                Package details
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Total shipment weight" htmlFor="rc-weight" required hint="Actual (dead) weight in kg">
                  <div className="relative">
                    <Input id="rc-weight" type="number" min="0" step="any" inputMode="decimal"
                      value={weight || ''} onChange={e => setWeight(parseFloat(e.target.value) || 0)}
                      placeholder="0" className="pr-12 font-mono" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-faint pointer-events-none">kg</span>
                  </div>
                </Field>

                <Field label="Total shipment value" htmlFor="rc-value" hint="Used for insurance / ROV">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-faint pointer-events-none">₹</span>
                    <Input id="rc-value" type="number" min="0" step="any" inputMode="decimal"
                      value={declaredValue || ''} onChange={e => setDeclaredValue(parseFloat(e.target.value) || 0)}
                      placeholder="0" className="pl-7 font-mono" />
                  </div>
                </Field>
              </div>

              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-ink-soft">Boxes &amp; dimensions</span>
                  <button type="button" onClick={() => setBoxes(b => [...b, { count: 1, length_cm: 0, width_cm: 0, height_cm: 0 }])}
                    className="text-sm text-accent-ink hover:underline font-semibold inline-flex items-center gap-1 cursor-pointer">
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    Add box type
                  </button>
                </div>

                {boxes.map((b, i) => (
                  <div key={i} className="grid grid-cols-2 sm:grid-cols-[repeat(4,1fr)_auto] gap-2 items-end">
                    <Field label={i === 0 ? 'No. of boxes' : ''} htmlFor={`rc-box-${i}`}>
                      <Input id={`rc-box-${i}`} type="number" min="0" inputMode="numeric" value={b.count || ''}
                        onChange={e => updateBox(i, { count: parseInt(e.target.value) || 0 })} placeholder="1" className="font-mono" />
                    </Field>
                    <Field label={i === 0 ? 'Length (cm)' : ''} htmlFor={`rc-l-${i}`}>
                      <Input id={`rc-l-${i}`} type="number" min="0" step="any" inputMode="decimal" value={b.length_cm || ''}
                        onChange={e => updateBox(i, { length_cm: parseFloat(e.target.value) || 0 })} placeholder="0" className="font-mono" />
                    </Field>
                    <Field label={i === 0 ? 'Width (cm)' : ''} htmlFor={`rc-w-${i}`}>
                      <Input id={`rc-w-${i}`} type="number" min="0" step="any" inputMode="decimal" value={b.width_cm || ''}
                        onChange={e => updateBox(i, { width_cm: parseFloat(e.target.value) || 0 })} placeholder="0" className="font-mono" />
                    </Field>
                    <Field label={i === 0 ? 'Height (cm)' : ''} htmlFor={`rc-h-${i}`}>
                      <Input id={`rc-h-${i}`} type="number" min="0" step="any" inputMode="decimal" value={b.height_cm || ''}
                        onChange={e => updateBox(i, { height_cm: parseFloat(e.target.value) || 0 })} placeholder="0" className="font-mono" />
                    </Field>
                    <div className={cx('flex', i === 0 ? 'pb-0.5' : '')}>
                      <IconButton label={`Remove box type ${i + 1}`} disabled={boxes.length <= 1}
                        onClick={() => setBoxes(prev => prev.filter((_, idx) => idx !== i))}
                        className="text-danger hover:bg-danger-soft">
                        <Trash2 className="w-4 h-4" />
                      </IconButton>
                    </div>
                  </div>
                ))}
              </div>

              {quote && (
                <div className="mt-4 pt-4 border-t border-line grid grid-cols-3 gap-3 text-center">
                  <div>
                    <div className="text-xs text-ink-faint">Dead weight</div>
                    <div className="font-mono font-semibold text-ink mt-0.5">{formatINR(quote.weight.dead_weight)} kg</div>
                  </div>
                  <div>
                    <div className="text-xs text-ink-faint">Volumetric</div>
                    <div className="font-mono font-semibold text-ink mt-0.5">{formatINR(quote.weight.volumetric_weight)} kg</div>
                  </div>
                  <div>
                    <div className="text-xs text-ink-faint">Chargeable</div>
                    <div className="font-mono font-bold text-accent-ink mt-0.5">{formatINR(quote.weight.chargeable_weight)} kg</div>
                  </div>
                  <p className="col-span-3 text-xs text-ink-faint flex items-center justify-center gap-1">
                    <Info className="w-3 h-3 shrink-0" aria-hidden="true" />
                    {quote.weight.basis === 'minimum'
                      ? `Below the ${card.settings.min_chg_wt?.value} kg minimum — billed at the minimum`
                      : quote.weight.basis === 'volumetric'
                        ? `Volumetric is higher (L×W×H ÷ ${card.settings.divisor?.value})`
                        : 'Billed on actual weight'}
                  </p>
                </div>
              )}
            </Card>

            {/* ------------------------------------------ service preferences */}
            <Card padded={false}>
              <button type="button" onClick={() => setShowPrefs(v => !v)}
                aria-expanded={showPrefs}
                className="w-full flex items-center justify-between gap-3 p-4 sm:p-5 cursor-pointer">
                <span className="text-base font-bold text-ink">Service preferences <span className="font-normal text-ink-faint text-sm">(optional)</span></span>
                {showPrefs ? <ChevronUp className="w-5 h-5 text-ink-faint" /> : <ChevronDown className="w-5 h-5 text-ink-faint" />}
              </button>

              {showPrefs && (
                <div className="px-4 sm:px-5 pb-5 space-y-4 border-t border-line pt-4">
                  <fieldset>
                    <legend className="text-sm font-semibold text-ink-soft mb-2">Insure this shipment against loss or damage?</legend>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {([
                        { v: 'none', l: 'Owner’s risk', s: 'No insurance charge' },
                        { v: 'owner', l: 'Owner risk cover', s: `${card.settings.rov_owner?.value}% · min ₹${card.settings.rov_owner?.min_value}` },
                        { v: 'carrier', l: 'Carrier risk cover', s: `${card.settings.rov_carrier?.value}% · min ₹${card.settings.rov_carrier?.min_value}` },
                      ] as const).map(o => (
                        <button key={o.v} type="button" onClick={() => setInsurance(o.v as any)}
                          aria-pressed={insurance === o.v}
                          className={cx('text-left p-3 rounded-xl border min-h-[44px] cursor-pointer transition-colors',
                            insurance === o.v ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-muted')}>
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-ink">{o.l}</span>
                            {insurance === o.v && <Check className="w-4 h-4 text-accent-ink shrink-0" aria-hidden="true" />}
                          </span>
                          <span className="block text-xs text-ink-faint mt-0.5">{o.s}</span>
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend className="text-sm font-semibold text-ink-soft mb-2">Additional services</legend>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {([
                        { on: appointment, set: setAppointment, l: 'Appointment based delivery', s: `₹${card.settings.apt_handling?.value}/kg · min ₹${card.settings.apt_handling?.min_value}` },
                        { on: oda, set: setOda, l: 'Out of delivery area (ODA)', s: `₹${card.oda[0]?.per_kg}/kg · min ₹${card.oda[0]?.min_amount}` },
                        { on: toPay, set: setToPay, l: 'To-pay shipment', s: `₹${card.settings.to_pay?.value} per LR` },
                        { on: cheque, set: setCheque, l: 'Cheque payment', s: `₹${card.settings.cheque_handling?.value} per LR` },
                      ]).map((o, i) => (
                        <label key={i}
                          className={cx('flex items-start gap-3 p-3 rounded-xl border min-h-[44px] cursor-pointer transition-colors',
                            o.on ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-muted')}>
                          <input type="checkbox" checked={o.on} onChange={e => o.set(e.target.checked)}
                            className="mt-0.5 w-4 h-4 accent-[var(--color-accent-strong)] shrink-0" />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-ink">{o.l}</span>
                            <span className="block text-xs text-ink-faint">{o.s}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>
              )}
            </Card>
          </div>

          {/* ----------------------------------------------------- result */}
          <div className="xl:col-span-2">
            <div className="xl:sticky xl:top-20 space-y-4">
              {!quote ? (
                <Card>
                  <EmptyState
                    icon={<Truck className="w-6 h-6" />}
                    title="Enter shipment details"
                    message="Pick a pickup and delivery location and enter the weight to see the freight cost."
                  />
                </Card>
              ) : (
                <Card padded={false} className="overflow-hidden">
                  <div className="p-4 sm:p-5 bg-accent-soft border-b border-accent-line">
                    <div className="flex items-center gap-2 text-accent-ink">
                      <Truck className="w-4 h-4" aria-hidden="true" />
                      <span className="text-sm font-bold uppercase tracking-wide">Surface · Part truck load</span>
                    </div>
                    <div className="mt-3 flex items-end justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs text-accent-ink/80">Total freight cost</div>
                        <div className="text-3xl font-bold font-mono text-ink tracking-tight">
                          ₹{formatINR(quote.grand_total)}
                        </div>
                        <div className="text-xs text-ink-faint mt-1">
                          ₹{formatINR(quote.per_kg_effective)}/kg effective · {formatINR(quote.weight.chargeable_weight)} kg chargeable
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 sm:p-5">
                    <button type="button" onClick={() => setShowBreakup(v => !v)}
                      aria-expanded={showBreakup}
                      className="w-full flex items-center justify-between gap-2 text-sm font-semibold text-ink-soft hover:text-ink cursor-pointer min-h-[36px]">
                      <span>{showBreakup ? 'Hide' : 'Show'} breakup</span>
                      {showBreakup ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>

                    {showBreakup && (
                      <dl className="mt-3 space-y-2 text-sm">
                        {quote.lines.map(l => (
                          <div key={l.key} className="flex items-start justify-between gap-3">
                            <dt className="text-ink-soft min-w-0">
                              {l.label}
                              {l.hint && <span className="block text-xs text-ink-faint">{l.hint}</span>}
                            </dt>
                            <dd className="font-mono text-ink shrink-0">₹{formatINR(l.amount)}</dd>
                          </div>
                        ))}
                        <div className="flex justify-between gap-3 pt-2 border-t border-line font-semibold">
                          <dt className="text-ink">Subtotal</dt>
                          <dd className="font-mono text-ink">₹{formatINR(quote.subtotal)}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-ink-soft">GST {quote.gst_rate}%</dt>
                          <dd className="font-mono text-ink">₹{formatINR(quote.gst_amount)}</dd>
                        </div>
                        {quote.round_off !== 0 && (
                          <div className="flex justify-between gap-3">
                            <dt className="text-ink-soft">Round off</dt>
                            <dd className="font-mono text-ink">₹{formatINR(quote.round_off)}</dd>
                          </div>
                        )}
                        <div className="flex justify-between gap-3 pt-2 border-t border-line text-base font-bold">
                          <dt className="text-ink">Total amount</dt>
                          <dd className="font-mono text-accent-ink">₹{formatINR(quote.grand_total)}</dd>
                        </div>
                      </dl>
                    )}

                    <div className="mt-4 flex flex-col sm:flex-row gap-2">
                      <Button variant="secondary" icon={<Save className="w-4 h-4" />} onClick={saveQuote} loading={saving} fullWidth>
                        Save quote
                      </Button>
                      {onCreateInvoice && (
                        <Button variant="primary" icon={<ArrowRight className="w-4 h-4" />} onClick={() => onCreateInvoice(quote)} fullWidth>
                          Create invoice
                        </Button>
                      )}
                    </div>

                    <p className="mt-3 text-xs text-ink-faint">
                      Door-to-door surface freight. Demurrage after {card.settings.demurrage_free_days?.value} free days,
                      re-attempts free up to {card.settings.re_attempt_free?.value}.
                    </p>
                  </div>
                </Card>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
