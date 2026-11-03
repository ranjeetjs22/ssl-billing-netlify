import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  MapPin, Truck, ChevronDown, ChevronUp, Plus, Trash2,
  Search, ArrowRight, Info, Save, Pencil, RotateCcw,
} from 'lucide-react';
import { apiRequest } from '../services/api.js';
import { formatINR } from '../utils/format.js';
import { buildQuote } from '../utils/rates.js';
import type { Place, Box, Quote, SpecialRate, MatrixRow, OdaSlab, RateSettings } from '../utils/rates.js';
import { useAuth } from '../context/AuthContext.js';
import {
  Button, IconButton, Card, Field, Input, Select, Badge, EmptyState, ErrorState,
  Spinner, Toast, FormError, PillTabs, Segmented, inputCls, cx,
} from './ui.js';

/* ------------------------------------------------------- local helpers */
/** Shows a configured number, or a dash when the chart has no value for it. */
const shown = (v: unknown) => (v === null || v === undefined || v === '' ? '-' : String(v));

/** Card title row whose hint may wrap (the shared CardHeader truncates it). */
const PanelHead: React.FC<{ title: React.ReactNode; hint?: React.ReactNode; actions?: React.ReactNode }> = ({ title, hint, actions }) => (
  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 border-b border-line">
    <div className="min-w-0 flex-1">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {hint && <p className="text-xs text-ink-faint mt-0.5">{hint}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-1.5 shrink-0">{actions}</div>}
  </div>
);

/** Compact in-table number input; changed values are outlined in the accent. */
const cellInputCls = (dirty: boolean, width = 'w-16') => cx(
  width, 'h-9 sm:h-8 px-2 text-right tabular-nums text-sm rounded-control border bg-surface text-ink',
  'focus:outline-none focus:border-accent focus:ring-focus transition-colors duration-[var(--duration-fast)]',
  dirty ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong'
);

const KIND_LABEL: Record<string, string> = { zone: 'Zone', state: 'State', city: 'City' };

interface SettingRow {
  key: string;
  unit?: string | null;
  remark?: string | null;
  value: number | string | null;
  text_value?: string | null;
  min_value?: number | string | null;
  max_value?: number | string | null;
}

interface CustomerCardMeta {
  exists: boolean;
  use_custom: boolean;
  copied_at?: string | null;
  updated_at?: string | null;
}

interface RateCard {
  zones: { code: string; name: string; sort_order: number }[];
  states: { name: string; zone_code: string }[];
  cities: { name: string; state_name: string; zone_code: string; ref_id?: number }[];
  matrix: MatrixRow[];
  specials: SpecialRate[];
  settings: RateSettings;
  settings_rows?: SettingRow[];
  oda: OdaSlab[];
  /** Which card these numbers come from. */
  source?: 'global' | 'customer';
  customer_id?: string | null;
  customer_card?: CustomerCardMeta;
}

/**
 * Where edits go. The global card has per-lane endpoints; a customer's personal
 * chart is one record, so its edits are sent as a patch of that record.
 */
interface CardWriter {
  saveCells: (cells: { origin_zone: string; dest_zone: string; rate_per_kg: number }[]) => Promise<number>;
  saveSpecialRates: (rows: { id: string; rate_per_kg: number }[]) => Promise<number>;
  addSpecial: (row: Omit<SpecialRate, 'id'>) => Promise<void>;
  removeSpecial: (r: SpecialRate) => Promise<void>;
  saveSettings: (changes: Record<string, { value?: number | null; min_value?: number | null }>) => Promise<number>;
}

function makeWriter(card: RateCard): CardWriter {
  if (card.source === 'customer' && card.customer_id) {
    const url = `/rates/customer/${card.customer_id}`;
    const put = (body: any) => apiRequest(url, { method: 'PUT', body: JSON.stringify(body) });
    return {
      saveCells: async (cells) => { await put({ matrix: cells }); return cells.length; },
      saveSpecialRates: async (rows) => {
        const byId = new Map(rows.map(r => [r.id, r.rate_per_kg]));
        await put({ specials: card.specials.map(s => (s.id && byId.has(s.id) ? { ...s, rate_per_kg: byId.get(s.id) } : s)) });
        return rows.length;
      },
      addSpecial: async (row) => {
        const lane = (s: any) => `${s.origin_kind}|${String(s.origin_value).toLowerCase()}|${s.dest_kind}|${String(s.dest_value).toLowerCase()}`;
        if (card.specials.some(s => lane(s) === lane(row))) {
          throw new Error('A special rate already exists for that lane. Edit it instead.');
        }
        await put({ specials: [...card.specials, { ...row, is_active: true }] });
      },
      removeSpecial: async (r) => { await put({ specials: card.specials.filter(s => s.id !== r.id) }); },
      saveSettings: async (changes) => { await put({ settings: changes }); return Object.keys(changes).length; },
    };
  }
  return {
    saveCells: async (cells) => {
      const res = await apiRequest<{ updated: number }>('/rates/matrix/bulk', { method: 'PUT', body: JSON.stringify({ cells }) });
      return res.updated;
    },
    saveSpecialRates: async (rows) => {
      const res = await apiRequest<{ updated: number }>('/rates/special/bulk', { method: 'PUT', body: JSON.stringify({ rows }) });
      return res.updated;
    },
    addSpecial: async (row) => { await apiRequest('/rates/special', { method: 'POST', body: JSON.stringify(row) }); },
    removeSpecial: async (r) => { await apiRequest(`/rates/special/${r.id}`, { method: 'DELETE' }); },
    saveSettings: async (changes) => {
      const keys = Object.keys(changes);
      for (const k of keys) {
        await apiRequest(`/rates/settings/${encodeURIComponent(k)}`, { method: 'PUT', body: JSON.stringify(changes[k]) });
      }
      return keys.length;
    },
  };
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
          <MapPin className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none z-10" aria-hidden="true" />
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
            className={cx(inputCls, 'pl-8 pr-8')}
          />
          <ChevronDown
            className={cx('w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none transition-transform', open && 'rotate-180')}
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
          className="sheet absolute z-50 mt-1 w-full max-h-72 overflow-y-auto overscroll-contain border border-line
                     rounded-card shadow-overlay py-1 animate-rise"
        >
          {matches.length === 0 && (
            <li className="px-3 py-2.5 text-sm text-ink-faint">No location matches “{query}”.</li>
          )}
          {matches.map((o, i) => (
            <li key={o.key} role="option" aria-selected={value?.key === o.key}>
              <button
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => choose(o)}
                className={cx(
                  'w-full text-left px-3 py-1.5 min-h-[40px] flex items-center justify-between gap-3 cursor-pointer transition-colors',
                  i === highlight ? 'bg-surface-sunken' : 'hover:bg-surface-muted'
                )}
              >
                <span className="min-w-0">
                  <span className="block text-sm text-ink truncate">{o.label}</span>
                  <span className="block text-xs text-ink-faint truncate">{o.sub}</span>
                </span>
                <span className="text-xs text-ink-faint shrink-0">{KIND_LABEL[o.kind] || o.kind}</span>
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
  writer: CardWriter;
  canEdit: boolean;
  onSaved: (msg: string) => void;
  reload: () => Promise<void>;
}> = ({ card, writer, canEdit, onSaved, reload }) => {
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
      const updated = await writer.saveCells(dirtyCells);
      await reload();
      setDraft({});
      setEditing(false);
      onSaved(`Saved ${updated} zone rate${updated === 1 ? '' : 's'}.`);
    } catch (err: any) {
      setError(err.message || 'Could not save the rate chart.');
    } finally {
      setSaving(false);
    }
  };

  const values = card.matrix.map(m => Number(m.rate_per_kg));
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // Quiet four-step heat tint: soft status backgrounds, ink figures.
  const TONES = ['bg-positive-soft', 'bg-info-soft', 'bg-warning-soft', 'bg-danger-soft'];
  const toneFor = (v: number) => {
    const t = (v - lo) / (hi - lo || 1);
    if (t < 0.25) return TONES[0];
    if (t < 0.55) return TONES[1];
    if (t < 0.8) return TONES[2];
    return TONES[3];
  };

  return (
    <Card padded={false} className="overflow-hidden">
      <PanelHead
        title="Base zone rate chart"
        hint="Rupees per kg. Rows are pickup zones, columns are delivery zones. Special rates override these."
        actions={canEdit && (editing ? (
          <>
            <Button variant="ghost" size="sm"
              onClick={() => { setDraft({}); setEditing(false); setError(null); }}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" icon={<Save />}
              onClick={save} loading={saving} disabled={dirtyCells.length === 0}>
              Save{dirtyCells.length ? ` (${dirtyCells.length})` : ''}
            </Button>
          </>
        ) : (
          <Button variant="secondary" size="sm" icon={<Pencil />} onClick={() => setEditing(true)}>
            Edit rates
          </Button>
        ))}
      />

      {error && <div className="px-3 sm:px-4 pt-3"><FormError message={error} /></div>}

      {editing && (
        <p className="px-3 sm:px-4 pt-2.5 text-xs text-ink-faint">
          Changed cells are outlined. Nothing is saved until you press Save.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Zone to zone freight rate per kilogram</caption>
          <thead>
            <tr className="bg-surface-muted border-b border-line">
              <th scope="col" className="h-8 px-3 sm:px-4 text-left text-xs font-medium text-ink-faint whitespace-nowrap sticky left-0 z-[1] bg-surface-muted">
                From / to
              </th>
              {zones.map(z => (
                <th key={z.code} scope="col" className="h-8 px-1 text-center text-xs font-medium text-ink-faint whitespace-nowrap">
                  {z.code}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {zones.map(row => (
              <tr key={row.code}>
                <th scope="row" className="py-1.5 px-3 sm:px-4 text-left font-medium text-ink whitespace-nowrap sticky left-0 z-[1] bg-surface border-r border-line">
                  {row.code}
                  <span className="block text-xs font-normal text-ink-faint leading-tight">{row.name}</span>
                </th>
                {zones.map(col => {
                  const v = baseGrid[row.code]?.[col.code];
                  if (v === undefined) return <td key={col.code} className="py-1.5 px-1 text-center text-ink-faint">-</td>;
                  if (!editing) {
                    return (
                      <td key={col.code} className="py-1.5 px-1 text-center">
                        <span className={cx('inline-block min-w-[3rem] rounded-[4px] px-1.5 py-0.5 tabular-nums text-ink', toneFor(v))}>
                          {v}
                        </span>
                      </td>
                    );
                  }
                  const dirty = isDirty(row.code, col.code);
                  return (
                    <td key={col.code} className="py-1 px-1 text-center">
                      <label className="sr-only" htmlFor={`cell-${row.code}-${col.code}`}>
                        Rate from {row.code} to {col.code}
                      </label>
                      <input
                        id={`cell-${row.code}-${col.code}`}
                        type="number" min="0" step="any" inputMode="decimal"
                        value={valueOf(row.code, col.code)}
                        onChange={e => setDraft(d => ({ ...d, [laneKey(row.code, col.code)]: e.target.value }))}
                        className={cx(cellInputCls(dirty, 'w-16'), 'text-center')}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-3 sm:px-4 py-2.5 border-t border-line flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-faint">
        <span className="inline-flex items-center gap-1.5">
          Lower
          <span className="inline-flex gap-0.5" aria-hidden="true">
            {TONES.map(t => <span key={t} className={cx('w-5 h-2.5 rounded-[2px] border border-line', t)} />)}
          </span>
          Higher
        </span>
        <span className="ml-auto tabular-nums">₹{lo} to ₹{hi} per kg</span>
      </div>
    </Card>
  );
};

/* --------------------------------------------------------- special rates */
const KINDS: Array<'zone' | 'state' | 'city'> = ['zone', 'state', 'city'];

const SpecialRates: React.FC<{
  card: RateCard;
  writer: CardWriter;
  canEdit: boolean;
  onSaved: (msg: string) => void;
  reload: () => Promise<void>;
}> = ({ card, writer, canEdit, onSaved, reload }) => {
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
      const updated = await writer.saveSpecialRates(dirtyRows);
      await reload();
      setDraft({});
      setEditing(false);
      onSaved(`Saved ${updated} special rate${updated === 1 ? '' : 's'}.`);
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
      await writer.addSpecial({
        origin_kind: newRow.origin_kind, origin_value: newRow.origin_value.trim(),
        dest_kind: newRow.dest_kind, dest_value: newRow.dest_value.trim(),
        rate_per_kg: Number(newRow.rate_per_kg), note: newRow.note.trim() || 'Manual SPR',
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
      await writer.removeSpecial(r);
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

  const rateCell = (r: SpecialRate) => (editing && r.id ? (
    <>
      <label className="sr-only" htmlFor={`spr-${r.id}`}>Rate from {r.origin_value} to {r.dest_value}</label>
      <input
        id={`spr-${r.id}`}
        type="number" min="0" step="any" inputMode="decimal"
        value={valueOf(r)}
        onChange={e => setDraft(d => ({ ...d, [r.id!]: e.target.value }))}
        className={cellInputCls(isDirty(r), 'w-20')}
      />
    </>
  ) : (
    <span className="tabular-nums font-medium text-ink">₹{baseRate(r)}</span>
  ));

  const removeBtn = (r: SpecialRate) => (
    <IconButton label={`Remove ${r.origin_value} to ${r.dest_value}`} disabled={saving}
      onClick={() => removeRow(r)} className="hover:text-danger-ink hover:bg-danger-soft">
      <Trash2 />
    </IconButton>
  );

  const place = (value: string, kind: string) => (
    <>
      <span className="text-ink">{value}</span>
      <span className="ml-1.5 text-xs text-ink-faint">{KIND_LABEL[kind] || kind}</span>
    </>
  );

  return (
    <Card padded={false} className="overflow-hidden">
      <PanelHead
        title="Special rates"
        hint={`${active.length} lanes priced outside the zone chart. The most specific match wins.`}
        actions={canEdit && (editing ? (
          <>
            <Button variant="ghost" size="sm"
              onClick={() => { setDraft({}); setEditing(false); setError(null); }}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" icon={<Save />}
              onClick={save} loading={saving} disabled={dirtyRows.length === 0}>
              Save{dirtyRows.length ? ` (${dirtyRows.length})` : ''}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" size="sm" icon={<Pencil />} onClick={() => setEditing(true)}>
              Edit rates
            </Button>
            <Button variant="secondary" size="sm" icon={<Plus />} onClick={() => setAdding(a => !a)}>
              Add lane
            </Button>
          </>
        ))}
      />

      <div className="px-3 sm:px-4 py-2.5 border-b border-line">
        <div className="relative sm:max-w-xs">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none z-10" aria-hidden="true" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search a lane" aria-label="Search special rates" className="pl-8" />
        </div>
      </div>

      {error && <div className="px-3 sm:px-4 pt-3"><FormError message={error} /></div>}

      {adding && canEdit && (
        <form onSubmit={addRow} className="px-3 sm:px-4 py-3 border-b border-line space-y-3">
          <h3 className="text-sm font-semibold text-ink">New lane</h3>
          <div className="grid grid-cols-2 lg:grid-cols-[7rem_minmax(0,1fr)_7rem_minmax(0,1fr)_8rem] gap-3">
            <Field label="From type" htmlFor="spr-ok">
              <Select id="spr-ok" value={newRow.origin_kind}
                onChange={e => setNewRow(n => ({ ...n, origin_kind: e.target.value as any, origin_value: '' }))}>
                {KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </Select>
            </Field>
            <Field label="From" htmlFor="spr-ov">
              <Input id="spr-ov" list="spr-origin-opts" value={newRow.origin_value}
                onChange={e => setNewRow(n => ({ ...n, origin_value: e.target.value }))} placeholder="e.g. W1" />
              <datalist id="spr-origin-opts">
                {suggestions(newRow.origin_kind).map(v => <option key={v} value={v} />)}
              </datalist>
            </Field>
            <Field label="To type" htmlFor="spr-dk">
              <Select id="spr-dk" value={newRow.dest_kind}
                onChange={e => setNewRow(n => ({ ...n, dest_kind: e.target.value as any, dest_value: '' }))}>
                {KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </Select>
            </Field>
            <Field label="To" htmlFor="spr-dv">
              <Input id="spr-dv" list="spr-dest-opts" value={newRow.dest_value}
                onChange={e => setNewRow(n => ({ ...n, dest_value: e.target.value }))} placeholder="e.g. Guwahati" />
              <datalist id="spr-dest-opts">
                {suggestions(newRow.dest_kind).map(v => <option key={v} value={v} />)}
              </datalist>
            </Field>
            <Field label="Rate per kg" htmlFor="spr-rate" required className="col-span-2 lg:col-span-1">
              <Input id="spr-rate" type="number" min="0" step="any" inputMode="decimal" className="tabular-nums"
                value={newRow.rate_per_kg} onChange={e => setNewRow(n => ({ ...n, rate_per_kg: e.target.value }))} placeholder="0" />
            </Field>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <Field label="Note" htmlFor="spr-note" className="flex-1">
              <Input id="spr-note" value={newRow.note} onChange={e => setNewRow(n => ({ ...n, note: e.target.value }))}
                placeholder="Why this lane is priced differently" />
            </Field>
            <div className="flex items-end justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => { setAdding(false); setError(null); }}>Cancel</Button>
              <Button type="submit" variant="primary" icon={<Plus />} loading={saving}>Add lane</Button>
            </div>
          </div>
        </form>
      )}

      {editing && (
        <p className="px-3 sm:px-4 pt-2.5 text-xs text-ink-faint">
          Changed rates are outlined. Nothing is saved until you press Save.
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState title="No matching special rate" message="Try a different city, state or zone." />
      ) : (
        <>
          {/* phone: one row per lane */}
          <ul className="sm:hidden divide-y divide-line">
            {rows.map((r, i) => (
              <li key={r.id || i} className="px-3 py-2 flex items-center gap-3">
                <div className="min-w-0 flex-1 text-sm">
                  <div className="truncate">{place(r.origin_value, r.origin_kind)}</div>
                  <div className="truncate"><span className="text-ink-faint mr-1">to</span>{place(r.dest_value, r.dest_kind)}</div>
                  {r.note && <div className="text-xs text-ink-faint truncate">{r.note}</div>}
                </div>
                <div className="shrink-0 text-right">{rateCell(r)}</div>
                {canEdit && editing && removeBtn(r)}
              </li>
            ))}
          </ul>

          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted border-b border-line">
                <tr>
                  <th scope="col" className="h-8 px-4 text-left text-xs font-medium text-ink-faint">From</th>
                  <th scope="col" className="h-8 px-3 text-left text-xs font-medium text-ink-faint">To</th>
                  <th scope="col" className="h-8 px-3 text-right text-xs font-medium text-ink-faint">Rate / kg</th>
                  <th scope="col" className="h-8 px-3 text-left text-xs font-medium text-ink-faint">Note</th>
                  {canEdit && editing && <th scope="col" className="h-8 px-4 text-right text-xs font-medium text-ink-faint"><span className="sr-only">Remove</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r, i) => (
                  <tr key={r.id || i} className="hover:bg-surface-muted transition-colors">
                    <td className="py-2 px-4 whitespace-nowrap">{place(r.origin_value, r.origin_kind)}</td>
                    <td className="py-2 px-3 whitespace-nowrap">{place(r.dest_value, r.dest_kind)}</td>
                    <td className="py-1 px-3 text-right">{rateCell(r)}</td>
                    <td className="py-2 px-3 text-ink-faint text-xs">{r.note}</td>
                    {canEdit && editing && <td className="py-1 px-4 text-right">{removeBtn(r)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
};

/* --------------------------------------------------------------- charges */
const ChargesEditor: React.FC<{
  card: RateCard;
  writer: CardWriter;
  canEdit: boolean;
  onSaved: (msg: string) => void;
  reload: () => Promise<void>;
}> = ({ card, writer, canEdit, onSaved, reload }) => {
  // Only numeric charges are edited here; option rows (text values) are left alone.
  const rows = (card.settings_rows || []).filter(r => r.text_value === null || r.text_value === undefined);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, { value?: string; min_value?: string }>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = (v: any) => (v === null || v === undefined || v === '' ? '' : String(v));
  const changes = useMemo(() => {
    const out: Record<string, { value?: number | null; min_value?: number | null }> = {};
    for (const r of rows) {
      const d = draft[r.key];
      if (!d) continue;
      const c: { value?: number | null; min_value?: number | null } = {};
      if (d.value !== undefined && d.value !== show(r.value)) c.value = d.value === '' ? null : Number(d.value);
      if (d.min_value !== undefined && d.min_value !== show(r.min_value)) c.min_value = d.min_value === '' ? null : Number(d.min_value);
      if (Object.keys(c).length) out[r.key] = c;
    }
    return out;
  }, [draft, rows]);
  const changed = Object.keys(changes).length;

  const save = async () => {
    const bad = Object.values(changes).some(c => (c.value !== undefined && c.value !== null && (isNaN(c.value) || c.value < 0))
      || (c.min_value !== undefined && c.min_value !== null && (isNaN(c.min_value) || c.min_value < 0)));
    if (bad) { setError('Charges must be 0 or more.'); return; }
    setSaving(true);
    setError(null);
    try {
      const n = await writer.saveSettings(changes);
      await reload();
      setDraft({});
      setEditing(false);
      onSaved(`Saved ${n} charge${n === 1 ? '' : 's'}.`);
    } catch (err: any) {
      setError(err.message || 'Could not save the charges.');
    } finally {
      setSaving(false);
    }
  };

  const cellInput = (r: SettingRow, field: 'value' | 'min_value') => {
    const cur = draft[r.key]?.[field] ?? show(r[field]);
    const dirty = draft[r.key]?.[field] !== undefined && draft[r.key]?.[field] !== show(r[field]);
    return (
      <input
        type="number" min="0" step="any" inputMode="decimal"
        aria-label={`${r.remark || r.key} ${field === 'value' ? 'value' : 'minimum'}`}
        value={cur}
        onChange={e => setDraft(d => ({ ...d, [r.key]: { ...d[r.key], [field]: e.target.value } }))}
        className={cellInputCls(dirty, 'w-20')}
      />
    );
  };

  const valueCell = (r: SettingRow) => (editing ? cellInput(r, 'value')
    : <span className="tabular-nums font-medium text-ink">{show(r.value) || '-'}</span>);
  const minCell = (r: SettingRow) => (editing ? cellInput(r, 'min_value')
    : <span className="tabular-nums text-ink-soft">{show(r.min_value) || '-'}</span>);

  return (
    <Card padded={false} className="overflow-hidden">
      <PanelHead
        title="Charges"
        hint="Surcharges, minimums and per-LR fees added on top of the freight."
        actions={canEdit && (editing ? (
          <>
            <Button variant="ghost" size="sm"
              onClick={() => { setDraft({}); setEditing(false); setError(null); }}>Cancel</Button>
            <Button variant="primary" size="sm" icon={<Save />}
              onClick={save} loading={saving} disabled={changed === 0}>
              Save{changed ? ` (${changed})` : ''}
            </Button>
          </>
        ) : (
          <Button variant="secondary" size="sm" icon={<Pencil />} onClick={() => setEditing(true)}>
            Edit charges
          </Button>
        ))}
      />
      {error && <div className="px-3 sm:px-4 pt-3"><FormError message={error} /></div>}

      {rows.length === 0 ? (
        <EmptyState title="No charges configured" message="Surcharges and fees for this chart will appear here." />
      ) : (
        <>
          {/* phone: one row per charge */}
          <ul className="sm:hidden divide-y divide-line">
            {rows.map(r => (
              <li key={r.key} className="px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-ink truncate">{r.remark || r.key}</div>
                    <div className="text-[11px] text-ink-faint font-mono truncate">{r.key}</div>
                  </div>
                  {!editing && (
                    <div className="text-right shrink-0 text-sm">
                      {valueCell(r)}
                      {r.unit && <span className="ml-1 text-xs text-ink-faint">{r.unit}</span>}
                      <div className="text-xs text-ink-faint">Min {minCell(r)}</div>
                    </div>
                  )}
                </div>
                {editing && (
                  <div className="mt-1.5 flex items-center gap-3 text-xs text-ink-faint">
                    <label className="inline-flex items-center gap-1.5">Value {cellInput(r, 'value')}</label>
                    <label className="inline-flex items-center gap-1.5">Min {cellInput(r, 'min_value')}</label>
                    {r.unit && <span className="ml-auto truncate">{r.unit}</span>}
                  </div>
                )}
              </li>
            ))}
          </ul>

          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted border-b border-line">
                <tr>
                  <th scope="col" className="h-8 px-4 text-left text-xs font-medium text-ink-faint">Charge</th>
                  <th scope="col" className="h-8 px-3 text-right text-xs font-medium text-ink-faint">Value</th>
                  <th scope="col" className="h-8 px-3 text-left text-xs font-medium text-ink-faint">Unit</th>
                  <th scope="col" className="h-8 px-4 text-right text-xs font-medium text-ink-faint">Minimum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(r => (
                  <tr key={r.key} className="hover:bg-surface-muted transition-colors">
                    <td className="py-1.5 px-4">
                      <span className="text-ink">{r.remark || r.key}</span>
                      <span className="block text-[11px] text-ink-faint font-mono">{r.key}</span>
                    </td>
                    <td className="py-1 px-3 text-right">{valueCell(r)}</td>
                    <td className="py-1.5 px-3 text-xs text-ink-faint">{r.unit}</td>
                    <td className="py-1 px-4 text-right">{minCell(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
};

/* ================================================================ main */
type Tab = 'calculator' | 'chart' | 'special' | 'charges';

interface CustomerLite { id: string; name: string; city?: string }

export const RateCalculator: React.FC<{ onCreateInvoice?: (q: Quote) => void }> = ({ onCreateInvoice }) => {
  const { user } = useAuth();
  // The API guards rate edits with the `settings` module - mirror that here so the
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
  // undefined = follow the Delhi rule; true/false = the user forced it
  const [greenTax, setGreenTax] = useState<boolean | undefined>(undefined);
  const [toPay, setToPay] = useState(false);
  const [cheque, setCheque] = useState(false);
  const [insurance, setInsurance] = useState<'none' | 'owner' | 'carrier'>('none');
  const [showBreakup, setShowBreakup] = useState(true);

  // Which customer's chart is on screen ('' = the global chart)
  const [customers, setCustomers] = useState<CustomerLite[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [cardBusy, setCardBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const firstLoad = useRef(true);

  const loadCard = useCallback(async () => {
    // Keep the screen up while switching customers; only the first load shows a spinner.
    if (firstLoad.current) setLoading(true);
    setLoadError(null);
    try {
      const q = customerId ? `?customer_id=${encodeURIComponent(customerId)}` : '';
      const res = await apiRequest<RateCard>(`/rates/card${q}`);
      setCard(res);
    } catch (err: any) {
      setLoadError(err.message || 'Could not load the rate card');
    } finally {
      firstLoad.current = false;
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => { loadCard(); }, [loadCard]);

  useEffect(() => {
    apiRequest<{ items: CustomerLite[] }>('/customers?page=1&page_size=500')
      .then(r => setCustomers((r.items || []).map(c => ({ id: c.id, name: c.name, city: c.city }))))
      .catch(() => setCustomers([]));
  }, []);

  const writer = useMemo(() => (card ? makeWriter(card) : null), [card]);
  const selectedCustomer = customers.find(c => c.id === customerId);
  const cardMeta = card?.customer_card;

  /** Create or reset the personal chart as a fresh copy of the global one. */
  const copyFromGlobal = async () => {
    if (!customerId) return;
    setCardBusy(true);
    try {
      await apiRequest(`/rates/customer/${customerId}/copy`, { method: 'POST' });
      await loadCard();
      setToast(cardMeta?.exists ? 'Personal chart reset to a fresh copy of the global chart.' : 'Personal rate chart created from the global chart.');
    } catch (err: any) {
      setToast(err.message || 'Could not copy the global chart.');
    } finally {
      setCardBusy(false);
    }
  };

  const setUseCustom = async (use: boolean) => {
    if (!customerId) return;
    setCardBusy(true);
    try {
      await apiRequest(`/rates/customer/${customerId}`, { method: 'PUT', body: JSON.stringify({ use_custom: use }) });
      await loadCard();
      setToast(use ? 'This customer is now billed on their personal chart.' : 'This customer is now billed on the global chart.');
    } catch (err: any) {
      setToast(err.message || 'Could not change the chart.');
    } finally {
      setCardBusy(false);
    }
  };

  const deleteCustomCard = async () => {
    if (!customerId) return;
    setCardBusy(true);
    try {
      await apiRequest(`/rates/customer/${customerId}`, { method: 'DELETE' });
      setConfirmDelete(false);
      await loadCard();
      setToast('Personal chart removed. This customer now uses the global chart.');
    } catch (err: any) {
      setToast(err.message || 'Could not remove the personal chart.');
    } finally {
      setCardBusy(false);
    }
  };

  const options = useMemo(() => (card ? buildOptions(card) : []), [card]);

  // Default the pickup to Ahmedabad - that is where SSL books from.
  useEffect(() => {
    if (!origin && options.length) {
      setOrigin(options.find(o => o.key === 'city:Ahmedabad') || options[0]);
    }
  }, [options, origin]);

  /** Live quote, computed with the same engine the server uses - no network round-trip. */
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
          green_tax: greenTax,
          insurance,
        },
        card.settings, card.specials, card.matrix, card.oda
      );
    } catch {
      return null;
    }
  }, [card, origin, dest, weight, boxes, declaredValue, appointment, oda, toPay, cheque, greenTax, insurance]);

  // Green tax is a Delhi levy: ticked automatically for a Delhi delivery, but the
  // user can force it on or off for any lane.
  const destIsDelhi = Boolean(
    dest && [dest.city, dest.state].some(v => ['delhi', 'new delhi'].includes(String(v || '').trim().toLowerCase()))
  );
  const greenTaxOn = greenTax === undefined ? destIsDelhi : greenTax;

  const updateBox = (i: number, patch: Partial<Box>) =>
    setBoxes(prev => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));

  const saveQuote = async () => {
    if (!quote || !origin || !dest) return;
    setSaving(true);
    try {
      await apiRequest('/rates/quotes', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: customerId || undefined,
          rate_mode: card?.source === 'customer' ? 'custom' : 'global',
          origin, dest, dead_weight: weight, boxes: boxes.filter(b => b.count > 0),
          declared_value: declaredValue, appointment_delivery: appointment,
          oda, to_pay: toPay, cheque_payment: cheque, green_tax: greenTax, insurance,
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
  if (loadError || !card || !writer) return <Card padded={false}><ErrorState message={loadError || undefined} onRetry={loadCard} /></Card>;

  const TABS: { key: Tab; label: string }[] = [
    { key: 'calculator', label: 'Calculator' },
    { key: 'chart', label: 'Rate chart' },
    { key: 'special', label: 'Special rates' },
    { key: 'charges', label: 'Charges' },
  ];
  const onCustomer = card.source === 'customer';
  // Remount the editors when the card changes so half-typed edits never leak across charts
  const editorKey = `${card.source}:${card.customer_id || 'global'}`;

  const st = card.settings;
  const INSURANCE = [
    { v: 'none', l: 'Owner’s risk', s: 'No insurance charge' },
    { v: 'owner', l: 'Owner cover', s: `Owner risk cover · ${shown(st.rov_owner?.value)}% · min ₹${shown(st.rov_owner?.min_value)}` },
    { v: 'carrier', l: 'Carrier cover', s: `Carrier risk cover · ${shown(st.rov_carrier?.value)}% · min ₹${shown(st.rov_carrier?.min_value)}` },
  ] as const;
  const SERVICES = [
    { on: appointment, set: setAppointment, l: 'Appointment based delivery', s: `₹${shown(st.apt_handling?.value)}/kg · min ₹${shown(st.apt_handling?.min_value)}` },
    { on: oda, set: setOda, l: 'Out of delivery area (ODA)', s: `₹${shown(card.oda[0]?.per_kg)}/kg · min ₹${shown(card.oda[0]?.min_amount)}` },
    {
      on: greenTaxOn,
      set: (v: boolean) => setGreenTax(v === destIsDelhi ? undefined : v),
      l: 'Green tax',
      s: destIsDelhi
        ? `Auto-applied for Delhi · ₹${shown(st.green_tax?.value)}/kg · min ₹${shown(st.green_tax?.min_value)}`
        : `₹${shown(st.green_tax?.value)}/kg · min ₹${shown(st.green_tax?.min_value)} (Delhi levy)`,
    },
    { on: toPay, set: setToPay, l: 'To-pay shipment', s: `₹${shown(st.to_pay?.value)} per LR` },
    { on: cheque, set: setCheque, l: 'Cheque payment', s: `₹${shown(st.cheque_handling?.value)} per LR` },
  ];
  const servicesOn = SERVICES.filter(o => o.on).length + (insurance !== 'none' ? 1 : 0);
  const sectionCls = 'px-3 sm:px-4 py-3 sm:py-4';

  return (
    <div className="space-y-3 sm:space-y-4">
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

      <PillTabs<Tab> tabs={TABS} value={tab} onChange={setTab} />

      {/* -------------------------------------------- whose chart is this */}
      <Card>
        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3">
          <label htmlFor="rc-customer" className="text-xs font-medium text-ink-soft shrink-0">Rate chart for</label>
          <Select id="rc-customer" className="md:w-72" value={customerId}
            onChange={e => { setCustomerId(e.target.value); setConfirmDelete(false); }}>
            <option value="">Global chart (all customers)</option>
            {customers.map(c => (
              <option key={c.id} value={c.id}>{c.name}{c.city ? ` (${c.city})` : ''}</option>
            ))}
          </Select>

          <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2 text-sm">
            {!customerId ? (
              <span className="text-xs text-ink-faint">Default prices for every customer without a personal chart.</span>
            ) : !cardMeta?.exists ? (
              <>
                <Badge tone="neutral">Uses global chart</Badge>
                {canEditRates ? (
                  <Button variant="secondary" size="sm" icon={<Plus />} onClick={copyFromGlobal} loading={cardBusy}>
                    Create personal chart
                  </Button>
                ) : (
                  <span className="text-ink-faint text-xs">No personal chart for this customer.</span>
                )}
              </>
            ) : (
              <>
                {canEditRates ? (
                  <Segmented
                    label="Chart used for this customer"
                    size="sm"
                    value={cardMeta.use_custom ? 'personal' : 'global'}
                    onChange={v => { if (!cardBusy && (v === 'personal') !== cardMeta.use_custom) setUseCustom(v === 'personal'); }}
                    options={[{ value: 'personal', label: 'Personal' }, { value: 'global', label: 'Global' }]}
                  />
                ) : (
                  <Badge tone="neutral">{cardMeta.use_custom ? 'Billed on personal chart' : 'Billed on global chart'}</Badge>
                )}
                {canEditRates && (
                  confirmDelete ? (
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <span className="text-xs text-danger-ink">Delete this personal chart?</span>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Keep</Button>
                      <Button variant="danger" size="sm" onClick={deleteCustomCard} loading={cardBusy}>Delete</Button>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 md:ml-auto">
                      <Button variant="ghost" size="sm" icon={<RotateCcw />} onClick={copyFromGlobal} loading={cardBusy}>
                        Reset from global
                      </Button>
                      <Button variant="ghost" size="sm" icon={<Trash2 />} onClick={() => setConfirmDelete(true)}
                        className="hover:text-danger-ink">
                        Delete
                      </Button>
                    </span>
                  )
                )}
              </>
            )}
          </div>
        </div>
        {customerId && cardMeta?.exists && (
          <p className="mt-2 text-xs text-ink-faint">
            {onCustomer
              ? `Showing and editing ${selectedCustomer?.name || 'this customer'}'s personal chart. Changes to the global chart do not affect it.`
              : `${selectedCustomer?.name || 'This customer'} is billed on the global chart, shown below - edits here change it for every customer. Their personal chart is kept; switch to it to view or edit it.`}
            {cardMeta.copied_at && ` Copied from global on ${String(cardMeta.copied_at).slice(0, 10)}.`}
          </p>
        )}
      </Card>

      {tab === 'chart' && (
        <RateChart key={editorKey} card={card} writer={writer} canEdit={canEditRates} onSaved={setToast} reload={loadCard} />
      )}
      {tab === 'special' && (
        <SpecialRates key={editorKey} card={card} writer={writer} canEdit={canEditRates} onSaved={setToast} reload={loadCard} />
      )}
      {tab === 'charges' && (
        <ChargesEditor key={editorKey} card={card} writer={writer} canEdit={canEditRates} onSaved={setToast} reload={loadCard} />
      )}

      {tab === 'calculator' && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-3 sm:gap-4 items-start">
          {/* ----------------------------------------------------- inputs */}
          <Card padded={false} className="divide-y divide-line">
            {/* route */}
            <section className={sectionCls} aria-labelledby="rc-route-h">
              <h2 id="rc-route-h" className="text-sm font-semibold text-ink mb-3">Route</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <LocationPicker id="rc-origin" label="Pickup location" value={origin} options={options} onChange={setOrigin} />
                <LocationPicker id="rc-dest" label="Delivery location" value={dest} options={options} onChange={setDest} />
              </div>

              {destIsDelhi && greenTaxOn && (
                <p className="mt-2 text-xs text-ink-faint flex items-center gap-1">
                  <Info className="w-3 h-3 shrink-0" aria-hidden="true" />
                  Delhi delivery - green tax is included. Turn it off under Service preferences.
                </p>
              )}

              {quote && (
                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="text-ink-faint text-xs">Rate</span>
                  <span className="tabular-nums font-medium text-ink">₹{quote.rate.rate_per_kg}/kg</span>
                  <Badge tone="neutral">{quote.rate.source === 'special' ? 'Special rate' : 'Zone base rate'}</Badge>
                  {onCustomer && <Badge tone="accent">Personal chart</Badge>}
                  <span className="text-ink-faint text-xs truncate min-w-0">{quote.rate.matched}</span>
                </div>
              )}
            </section>

            {/* shipment */}
            <section className={sectionCls} aria-labelledby="rc-ship-h">
              <h2 id="rc-ship-h" className="text-sm font-semibold text-ink mb-3">Shipment</h2>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Actual weight" htmlFor="rc-weight" required hint="Dead weight in kg">
                  <div className="relative">
                    <Input id="rc-weight" type="number" min="0" step="any" inputMode="decimal"
                      value={weight || ''} onChange={e => setWeight(parseFloat(e.target.value) || 0)}
                      placeholder="0" className="pr-9 tabular-nums" />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-ink-faint pointer-events-none">kg</span>
                  </div>
                </Field>

                <Field label="Shipment value" htmlFor="rc-value" hint="For insurance (ROV)">
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-ink-faint pointer-events-none">₹</span>
                    <Input id="rc-value" type="number" min="0" step="any" inputMode="decimal"
                      value={declaredValue || ''} onChange={e => setDeclaredValue(parseFloat(e.target.value) || 0)}
                      placeholder="0" className="pl-6 tabular-nums" />
                  </div>
                </Field>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <span className="text-xs font-medium text-ink-soft">Boxes and dimensions (cm)</span>
                  <Button type="button" variant="ghost" size="sm" icon={<Plus />}
                    onClick={() => setBoxes(b => [...b, { count: 1, length_cm: 0, width_cm: 0, height_cm: 0 }])}>
                    Add box type
                  </Button>
                </div>

                <div className="space-y-2">
                  {boxes.map((b, i) => (
                    <div key={i} className="grid grid-cols-[repeat(4,minmax(0,1fr))_auto] gap-2 items-end">
                      <Field label={i === 0 ? 'Boxes' : ''} htmlFor={`rc-box-${i}`}>
                        <Input id={`rc-box-${i}`} aria-label={`Box type ${i + 1}: number of boxes`} type="number" min="0" inputMode="numeric" value={b.count || ''}
                          onChange={e => updateBox(i, { count: parseInt(e.target.value) || 0 })} placeholder="1" className="tabular-nums" />
                      </Field>
                      <Field label={i === 0 ? 'Length' : ''} htmlFor={`rc-l-${i}`}>
                        <Input id={`rc-l-${i}`} aria-label={`Box type ${i + 1}: length in cm`} type="number" min="0" step="any" inputMode="decimal" value={b.length_cm || ''}
                          onChange={e => updateBox(i, { length_cm: parseFloat(e.target.value) || 0 })} placeholder="0" className="tabular-nums" />
                      </Field>
                      <Field label={i === 0 ? 'Width' : ''} htmlFor={`rc-w-${i}`}>
                        <Input id={`rc-w-${i}`} aria-label={`Box type ${i + 1}: width in cm`} type="number" min="0" step="any" inputMode="decimal" value={b.width_cm || ''}
                          onChange={e => updateBox(i, { width_cm: parseFloat(e.target.value) || 0 })} placeholder="0" className="tabular-nums" />
                      </Field>
                      <Field label={i === 0 ? 'Height' : ''} htmlFor={`rc-h-${i}`}>
                        <Input id={`rc-h-${i}`} aria-label={`Box type ${i + 1}: height in cm`} type="number" min="0" step="any" inputMode="decimal" value={b.height_cm || ''}
                          onChange={e => updateBox(i, { height_cm: parseFloat(e.target.value) || 0 })} placeholder="0" className="tabular-nums" />
                      </Field>
                      <div className="flex items-center h-10 sm:h-9">
                        <IconButton label={`Remove box type ${i + 1}`} disabled={boxes.length <= 1}
                          onClick={() => setBoxes(prev => prev.filter((_, idx) => idx !== i))}
                          className="hover:text-danger-ink hover:bg-danger-soft">
                          <Trash2 />
                        </IconButton>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {quote && (
                <div className="mt-4 pt-3 border-t border-line">
                  <dl className="grid grid-cols-3 gap-3">
                    <div>
                      <dt className="text-xs text-ink-faint">Dead weight</dt>
                      <dd className="text-sm tabular-nums text-ink-soft mt-0.5">{formatINR(quote.weight.dead_weight)} kg</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-faint">Volumetric</dt>
                      <dd className="text-sm tabular-nums text-ink-soft mt-0.5">{formatINR(quote.weight.volumetric_weight)} kg</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-faint">Chargeable</dt>
                      <dd className="text-sm tabular-nums font-semibold text-ink mt-0.5">{formatINR(quote.weight.chargeable_weight)} kg</dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-xs text-ink-faint">
                    {quote.weight.basis === 'minimum'
                      ? `Below the ${shown(card.settings.min_chg_wt?.value)} kg minimum - billed at the minimum.`
                      : quote.weight.basis === 'volumetric'
                        ? `Volumetric is higher (L×W×H ÷ ${shown(card.settings.divisor?.value)}).`
                        : 'Billed on actual weight.'}
                  </p>
                </div>
              )}
            </section>

            {/* ------------------------------------------ service preferences */}
            <section>
              <button type="button" onClick={() => setShowPrefs(v => !v)}
                aria-expanded={showPrefs}
                className="w-full flex items-center justify-between gap-3 px-3 sm:px-4 py-3 text-left cursor-pointer hover:bg-surface-muted transition-colors rounded-b-card">
                <span className="min-w-0">
                  <span className="text-sm font-semibold text-ink">Service preferences</span>
                  <span className="ml-1.5 text-xs text-ink-faint">
                    {servicesOn ? `${servicesOn} selected` : 'Optional'}
                  </span>
                </span>
                {showPrefs ? <ChevronUp className="w-4 h-4 text-ink-faint shrink-0" /> : <ChevronDown className="w-4 h-4 text-ink-faint shrink-0" />}
              </button>

              {showPrefs && (
                <div className="px-3 sm:px-4 pb-4 space-y-4">
                  <div>
                    <div className="text-xs font-medium text-ink-soft mb-1.5" aria-hidden="true">Insurance</div>
                    <Segmented
                      label="Insure this shipment against loss or damage"
                      value={insurance}
                      onChange={v => setInsurance(v)}
                      options={INSURANCE.map(o => ({ value: o.v, label: o.l }))}
                    />
                    <p className="mt-1.5 text-xs text-ink-faint">{INSURANCE.find(o => o.v === insurance)?.s}</p>
                  </div>

                  <fieldset>
                    <legend className="text-xs font-medium text-ink-soft mb-1">Additional services</legend>
                    <div className="divide-y divide-line border-y border-line">
                      {SERVICES.map((o, i) => (
                        <label key={i} className="flex items-start gap-2.5 py-2 min-h-[44px] cursor-pointer">
                          <input type="checkbox" checked={o.on} onChange={e => o.set(e.target.checked)}
                            className="mt-0.5 w-4 h-4 shrink-0 cursor-pointer" />
                          <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:justify-between sm:gap-3">
                            <span className="block text-sm text-ink">{o.l}</span>
                            <span className="block text-xs text-ink-faint tabular-nums">{o.s}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>
              )}
            </section>
          </Card>

          {/* ----------------------------------------------------- result */}
          <div className="lg:sticky lg:top-20">
            {!quote ? (
              <Card padded={false}>
                <EmptyState
                  icon={<Truck />}
                  title="No quote yet"
                  message="Pick a pickup and delivery location and enter the weight to see the freight cost."
                />
              </Card>
            ) : (
              <Card padded={false}>
                <div className="px-3 sm:px-4 pt-3 pb-3 border-b border-line">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-ink">Quote</h2>
                    <span className="text-xs text-ink-faint">Surface · Part truck load</span>
                  </div>
                  <div className="mt-2 text-xs text-ink-faint">Total freight cost</div>
                  <div className="numeral text-2xl text-ink leading-tight">₹{formatINR(quote.grand_total)}</div>
                  <div className="text-xs text-ink-faint mt-0.5 tabular-nums">
                    ₹{formatINR(quote.per_kg_effective)}/kg effective · {formatINR(quote.weight.chargeable_weight)} kg chargeable
                  </div>
                </div>

                <div className="px-3 sm:px-4 py-2">
                  <button type="button" onClick={() => setShowBreakup(v => !v)}
                    aria-expanded={showBreakup}
                    className="w-full flex items-center justify-between gap-2 text-xs font-medium text-ink-soft hover:text-ink cursor-pointer min-h-[32px]">
                    <span>{showBreakup ? 'Hide' : 'Show'} breakup</span>
                    {showBreakup ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>

                  {showBreakup && (
                    <dl className="mt-1 mb-1 space-y-1.5 text-sm">
                      {quote.lines.map(l => (
                        <div key={l.key} className="flex items-start justify-between gap-3">
                          <dt className="text-ink-soft min-w-0">
                            {l.label}
                            {l.hint && <span className="block text-xs text-ink-faint">{l.hint}</span>}
                          </dt>
                          <dd className="tabular-nums text-ink shrink-0">₹{formatINR(l.amount)}</dd>
                        </div>
                      ))}
                      <div className="flex justify-between gap-3 pt-1.5 border-t border-line">
                        <dt className="text-ink font-medium">Subtotal</dt>
                        <dd className="tabular-nums font-medium text-ink">₹{formatINR(quote.subtotal)}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-ink-soft">GST {quote.gst_rate}%</dt>
                        <dd className="tabular-nums text-ink">₹{formatINR(quote.gst_amount)}</dd>
                      </div>
                      {quote.round_off !== 0 && (
                        <div className="flex justify-between gap-3">
                          <dt className="text-ink-soft">Round off</dt>
                          <dd className="tabular-nums text-ink">₹{formatINR(quote.round_off)}</dd>
                        </div>
                      )}
                      <div className="flex justify-between gap-3 pt-1.5 border-t border-line">
                        <dt className="text-ink font-semibold">Total amount</dt>
                        <dd className="tabular-nums font-semibold text-ink">₹{formatINR(quote.grand_total)}</dd>
                      </div>
                    </dl>
                  )}
                </div>

                <div className="px-3 sm:px-4 py-3 border-t border-line">
                  <div className="flex flex-col sm:flex-row lg:flex-col xl:flex-row gap-2">
                    <Button variant={onCreateInvoice ? 'secondary' : 'primary'} icon={<Save />} onClick={saveQuote} loading={saving} fullWidth>
                      Save quote
                    </Button>
                    {onCreateInvoice && (
                      <Button variant="primary" icon={<ArrowRight />} onClick={() => onCreateInvoice(quote)} fullWidth>
                        Create invoice
                      </Button>
                    )}
                  </div>
                  <p className="mt-2.5 text-xs text-ink-faint">
                    Door-to-door surface freight. Demurrage after {shown(card.settings.demurrage_free_days?.value)} free days,
                    re-attempts free up to {shown(card.settings.re_attempt_free?.value)}.
                  </p>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
