import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import * as db from '../db.js';
import * as engine from '../rateEngine.js';
import { authMiddleware, requireModule } from '../auth.js';

export const rateRouter = Router();
rateRouter.use(authMiddleware);

const requireRates = requireModule('invoices');

/** The rate card rarely changes; cache it briefly so repeated quotes are instant. */
let cache: { at: number; data: any } | null = null;
const CACHE_MS = 60_000;

async function loadRateCard() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const [zones, states, cities, matrix, specials, settingsRows, oda] = await Promise.all([
    db.select('rate_zones', { order: 'sort_order.asc' }),
    db.select('rate_states', { order: 'name.asc' }),
    db.select('rate_cities', { order: 'name.asc' }),
    db.select('rate_matrix', {}),
    db.select('rate_special', {}),
    db.select('rate_settings', {}),
    db.select('rate_oda', { order: 'lower_kg.asc' }),
  ]);

  const settings: engine.RateSettings = {};
  for (const row of settingsRows) {
    settings[row.key] = {
      value: row.value, text_value: row.text_value,
      min_value: row.min_value, max_value: row.max_value,
    };
  }

  const data = { zones, states, cities, matrix, specials, settings, settingsRows, oda };
  cache = { at: Date.now(), data };
  return data;
}

export function invalidateRateCache() { cache = null; }

// =====================================================================
// Per-customer rate charts
// ---------------------------------------------------------------------
// A customer can carry a FULL, independent copy of the global card (matrix,
// special lanes, charge settings). It is a snapshot: editing the global card
// afterwards does not change it. `use_custom` switches between billing that
// customer on their own chart or on the global one. Zones, states, cities and
// ODA slabs are geography/shared tables and always come from the global card.
// =====================================================================
const CUSTOMER_CARDS = 'customer_rate_cards';

const pickMatrix = (rows: any[]) => rows.map((r: any) => ({
  origin_zone: String(r.origin_zone), dest_zone: String(r.dest_zone), rate_per_kg: engine.num(r.rate_per_kg),
}));
const pickSpecials = (rows: any[]) => rows.map((r: any) => ({
  id: r.id ? String(r.id) : crypto.randomUUID(),
  origin_kind: r.origin_kind, origin_value: String(r.origin_value || '').trim(),
  dest_kind: r.dest_kind, dest_value: String(r.dest_value || '').trim(),
  rate_per_kg: engine.num(r.rate_per_kg), note: r.note || '', is_active: r.is_active !== false,
}));
const pickSettings = (s: engine.RateSettings) => {
  const out: engine.RateSettings = {};
  for (const [k, v] of Object.entries(s || {})) {
    out[k] = { value: v?.value ?? null, text_value: v?.text_value ?? null, min_value: v?.min_value ?? null, max_value: v?.max_value ?? null };
  }
  return out;
};

async function getCustomerCard(customerId: string) {
  if (!customerId) return null;
  try {
    return await db.selectOne(CUSTOMER_CARDS, { id: `eq.${customerId}` });
  } catch (err: any) {
    // Table not migrated yet: behave as if nobody has a personal chart.
    if (/customer_rate_cards|does not exist|PGRST205|schema cache/i.test(err.message)) return null;
    throw err;
  }
}

function cardMeta(row: any) {
  return row
    ? { exists: true, use_custom: row.use_custom !== false, copied_at: row.copied_at || null, updated_at: row.updated_at || null }
    : { exists: false, use_custom: false, copied_at: null, updated_at: null };
}

/**
 * The card a quote should use. mode: 'auto' (personal chart when the customer has
 * one switched on, else global), 'custom' (personal chart if it exists) or 'global'.
 */
async function effectiveCard(customerId?: string, mode: string = 'auto') {
  const d = await loadRateCard();
  const row = customerId ? await getCustomerCard(customerId) : null;
  const wantCustom = row && mode !== 'global' && (mode === 'custom' || row.use_custom !== false);
  const settings: engine.RateSettings = wantCustom
    // Keys added to the global card after the snapshot fall back to the global value
    ? { ...d.settings, ...(row.settings || {}) }
    : d.settings;
  return {
    d,
    row,
    source: (wantCustom ? 'customer' : 'global') as 'customer' | 'global',
    matrix: wantCustom ? (row.matrix || []) : d.matrix,
    specials: wantCustom ? (row.specials || []) : d.specials,
    settings,
  };
}

/** Everything the calculator UI needs to render and quote locally. */
rateRouter.get('/rates/card', requireRates, async (req: Request, res: Response) => {
  try {
    const customerId = String(req.query.customer_id || '');
    const mode = String(req.query.mode || 'auto');
    const e = await effectiveCard(customerId || undefined, mode);
    res.json({
      zones: e.d.zones,
      states: e.d.states,
      cities: e.d.cities,
      matrix: e.matrix,
      specials: e.specials,
      settings: e.settings,
      // Labels/units for the charges editor, with the effective values filled in
      settings_rows: e.d.settingsRows.map((r: any) => ({
        key: r.key, unit: r.unit, remark: r.remark,
        value: e.settings[r.key]?.value ?? null,
        text_value: e.settings[r.key]?.text_value ?? null,
        min_value: e.settings[r.key]?.min_value ?? null,
        max_value: e.settings[r.key]?.max_value ?? null,
      })),
      oda: e.d.oda,
      source: e.source,
      customer_id: customerId || null,
      customer_card: cardMeta(e.row),
    });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

/** Which customers have a personal chart - for badges and pickers. */
rateRouter.get('/rates/customer-cards', requireRates, async (_req: Request, res: Response) => {
  try {
    let rows: any[] = [];
    try {
      rows = await db.select(CUSTOMER_CARDS, { select: 'id,customer_id,use_custom,copied_at,updated_at' });
    } catch (err: any) {
      if (!/customer_rate_cards|does not exist|PGRST205|schema cache/i.test(err.message)) throw err;
    }
    res.json(rows.map((r: any) => ({ customer_id: r.customer_id || r.id, ...cardMeta(r) })));
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

/** Create - or reset - a customer's personal chart as a fresh copy of the global card. */
rateRouter.post('/rates/customer/:customer_id/copy', requireModule('settings'), async (req: Request, res: Response) => {
  try {
    const customerId = req.params.customer_id;
    const cust = await db.selectOne('customers', { id: `eq.${customerId}` });
    if (!cust) return res.status(404).json({ detail: 'This customer could not be found.' });

    const d = await loadRateCard();
    const now = new Date().toISOString();
    const snapshot = {
      matrix: pickMatrix(d.matrix),
      specials: pickSpecials(d.specials.map((s: any) => ({ ...s, id: undefined }))),
      settings: pickSettings(d.settings),
      copied_at: now,
      updated_at: now,
    };

    const existing = await getCustomerCard(customerId);
    const row = existing
      ? await db.update(CUSTOMER_CARDS, { id: `eq.${customerId}` }, snapshot)
      : await db.insert(CUSTOMER_CARDS, { id: customerId, customer_id: customerId, use_custom: true, ...snapshot, created_at: now });

    const user = (req as any).user;
    if (user?.email) {
      await db.insert('audit_logs', {
        user_email: user.email,
        action: existing ? 'Customer rate chart reset from global' : 'Customer rate chart created',
        entity: CUSTOMER_CARDS, entity_id: customerId,
        new_value: { customer: cust.name }, created_at: now,
      });
    }
    res.status(existing ? 200 : 201).json(cardMeta(row));
  } catch (err: any) {
    if (/customer_rate_cards|PGRST205|schema cache/i.test(err.message)) {
      return res.status(500).json({ detail: 'Personal rate charts need the database migration supabase/migrations/20261103_customer_rate_cards.sql to be run first.' });
    }
    res.status(500).json({ detail: err.message });
  }
});

/**
 * Edit a customer's chart. Any of: use_custom, matrix (cells to change),
 * specials (full replacement list), settings (keys to change).
 */
rateRouter.put('/rates/customer/:customer_id', requireModule('settings'), async (req: Request, res: Response) => {
  try {
    const customerId = req.params.customer_id;
    const row = await getCustomerCard(customerId);
    if (!row) return res.status(404).json({ detail: 'This customer has no personal rate chart yet. Create one first.' });

    const body = req.body || {};
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };

    if (body.use_custom !== undefined) patch.use_custom = Boolean(body.use_custom);

    if (Array.isArray(body.matrix)) {
      const grid = new Map<string, any>((row.matrix || []).map((m: any) => [`${m.origin_zone}|${m.dest_zone}`, m]));
      for (const c of body.matrix) {
        const rate = engine.num(c?.rate_per_kg);
        if (!c?.origin_zone || !c?.dest_zone) return res.status(400).json({ detail: 'Every zone rate needs a from and to zone.' });
        if (!(rate > 0)) return res.status(400).json({ detail: `Rate ${c.origin_zone} → ${c.dest_zone} must be greater than 0.` });
        grid.set(`${c.origin_zone}|${c.dest_zone}`, { origin_zone: String(c.origin_zone), dest_zone: String(c.dest_zone), rate_per_kg: rate });
      }
      patch.matrix = Array.from(grid.values());
    }

    if (Array.isArray(body.specials)) {
      if (body.specials.length > 2000) return res.status(400).json({ detail: 'Too many special rates.' });
      const list = pickSpecials(body.specials);
      const seen = new Set<string>();
      for (const s of list) {
        if (!['zone', 'state', 'city'].includes(s.origin_kind) || !['zone', 'state', 'city'].includes(s.dest_kind)) {
          return res.status(400).json({ detail: 'Kind must be zone, state or city.' });
        }
        if (!s.origin_value || !s.dest_value) return res.status(400).json({ detail: 'Every special rate needs a from and to value.' });
        if (!(s.rate_per_kg > 0)) return res.status(400).json({ detail: `Rate ${s.origin_value} → ${s.dest_value} must be greater than 0.` });
        const lane = `${s.origin_kind}|${s.origin_value.toLowerCase()}|${s.dest_kind}|${s.dest_value.toLowerCase()}`;
        if (seen.has(lane)) return res.status(409).json({ detail: `There are two special rates for ${s.origin_value} → ${s.dest_value}. Keep one.` });
        seen.add(lane);
      }
      patch.specials = list;
    }

    if (body.settings && typeof body.settings === 'object') {
      const d = await loadRateCard();
      const merged: engine.RateSettings = { ...(row.settings || {}) };
      for (const [key, v] of Object.entries<any>(body.settings)) {
        if (!d.settings[key]) return res.status(400).json({ detail: `Unknown charge setting '${key}'.` });
        const cur = merged[key] || d.settings[key] || {};
        merged[key] = {
          value: v?.value !== undefined ? v.value : cur.value ?? null,
          text_value: v?.text_value !== undefined ? v.text_value : cur.text_value ?? null,
          min_value: v?.min_value !== undefined ? v.min_value : cur.min_value ?? null,
          max_value: v?.max_value !== undefined ? v.max_value : cur.max_value ?? null,
        };
      }
      patch.settings = merged;
    }

    const saved = await db.update(CUSTOMER_CARDS, { id: `eq.${customerId}` }, patch);
    res.json(cardMeta(saved));
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

/** Remove a customer's personal chart - they go back to the global card. */
rateRouter.delete('/rates/customer/:customer_id', requireModule('settings'), async (req: Request, res: Response) => {
  try {
    await db.remove(CUSTOMER_CARDS, { id: `eq.${req.params.customer_id}` });
    res.json({ message: 'Personal rate chart removed. This customer now uses the global chart.' });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

/** Server-side quote - same engine the browser uses, for API callers and stored quotes. */
rateRouter.post('/rates/quote', requireRates, async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const e = await effectiveCard(body.customer_id, body.rate_mode);
    if (!body.origin?.zone || !body.dest?.zone) {
      return res.status(400).json({ detail: 'Please choose both a pickup and a delivery location.' });
    }
    const quote = engine.buildQuote(body, e.settings, e.specials, e.matrix, e.d.oda);
    res.json({ ...quote, card_source: e.source });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

/** The full zone x zone grid, for the "Rate chart" view. */
rateRouter.get('/rates/matrix', requireRates, async (_req: Request, res: Response) => {
  try {
    const d = await loadRateCard();
    const grid: Record<string, Record<string, number>> = {};
    for (const row of d.matrix) {
      if (!grid[row.origin_zone]) grid[row.origin_zone] = {};
      grid[row.origin_zone][row.dest_zone] = engine.num(row.rate_per_kg);
    }
    res.json({ zones: d.zones, grid });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

rateRouter.get('/rates/settings', requireRates, async (_req: Request, res: Response) => {
  try {
    const d = await loadRateCard();
    res.json(d.settingsRows);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

/** Update a charge setting (admin only - it changes every future quote). */
rateRouter.put('/rates/settings/:key', requireModule('settings'), async (req: Request, res: Response) => {
  try {
    const key = req.params.key;
    const existing = await db.selectOne('rate_settings', { key: `eq.${key}` });
    if (!existing) return res.status(404).json({ detail: 'This setting does not exist.' });

    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const f of ['value', 'text_value', 'min_value', 'max_value', 'remark']) {
      if (req.body[f] !== undefined) patch[f] = req.body[f];
    }
    const row = await db.update('rate_settings', { key: `eq.${key}` }, patch);
    invalidateRateCache();

    const user = (req as any).user;
    if (user?.email) {
      await db.insert('audit_logs', {
        user_email: user.email, action: 'Rate setting changed', entity: 'rate_settings',
        entity_id: key, old_value: { value: existing.value, text_value: existing.text_value },
        new_value: patch, created_at: new Date().toISOString(),
      });
    }
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

/** Update one cell of the base zone matrix. */
rateRouter.put('/rates/matrix', requireModule('settings'), async (req: Request, res: Response) => {
  try {
    const { origin_zone, dest_zone, rate_per_kg } = req.body || {};
    if (!origin_zone || !dest_zone) return res.status(400).json({ detail: 'origin_zone and dest_zone are required.' });
    const rate = engine.num(rate_per_kg);
    if (rate < 0) return res.status(400).json({ detail: 'Rate cannot be negative.' });

    const existing = await db.selectOne('rate_matrix', { origin_zone: `eq.${origin_zone}`, dest_zone: `eq.${dest_zone}` });
    if (!existing) return res.status(404).json({ detail: 'That lane is not in the rate matrix.' });

    const row = await db.update('rate_matrix', { id: `eq.${existing.id}` },
      { rate_per_kg: rate, updated_at: new Date().toISOString() });
    invalidateRateCache();

    const user = (req as any).user;
    if (user?.email) {
      await db.insert('audit_logs', {
        user_email: user.email, action: 'Zone rate changed', entity: 'rate_matrix', entity_id: existing.id,
        old_value: { lane: `${origin_zone}->${dest_zone}`, rate: existing.rate_per_kg },
        new_value: { rate }, created_at: new Date().toISOString(),
      });
    }
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

/** Save many matrix cells at once - what the editable rate chart posts. */
rateRouter.put('/rates/matrix/bulk', requireModule('settings'), async (req: Request, res: Response) => {
  try {
    const cells = Array.isArray(req.body?.cells) ? req.body.cells : [];
    if (cells.length === 0) return res.status(400).json({ detail: 'No changes were sent.' });
    if (cells.length > 200) return res.status(400).json({ detail: 'Too many changes in one request.' });

    const existing = await db.select('rate_matrix', {});
    const byLane = new Map<string, any>(existing.map((r: any) => [`${r.origin_zone}|${r.dest_zone}`, r]));

    const updated: any[] = [];
    const failed: { lane: string; reason: string }[] = [];
    for (const cell of cells) {
      const lane = `${cell.origin_zone}|${cell.dest_zone}`;
      const row = byLane.get(lane);
      if (!row) { failed.push({ lane, reason: 'lane not found' }); continue; }
      const rate = engine.num(cell.rate_per_kg);
      if (!(rate > 0)) { failed.push({ lane, reason: 'rate must be greater than 0' }); continue; }
      if (engine.num(row.rate_per_kg) === rate) continue;   // nothing changed
      const saved = await db.update('rate_matrix', { id: `eq.${row.id}` },
        { rate_per_kg: rate, updated_at: new Date().toISOString() });
      updated.push({ ...saved, previous: engine.num(row.rate_per_kg) });
    }

    invalidateRateCache();

    const user = (req as any).user;
    if (user?.email && updated.length) {
      await db.insert('audit_logs', {
        user_email: user.email,
        action: `Zone rate chart edited (${updated.length} lane${updated.length === 1 ? '' : 's'})`,
        entity: 'rate_matrix',
        new_value: updated.map(u => ({ lane: `${u.origin_zone}->${u.dest_zone}`, from: u.previous, to: engine.num(u.rate_per_kg) })),
        created_at: new Date().toISOString(),
      });
    }

    res.json({ updated: updated.length, failed });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

/** Special rates, newest first. */
rateRouter.get('/rates/special', requireRates, async (_req: Request, res: Response) => {
  try {
    const d = await loadRateCard();
    res.json(d.specials);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

rateRouter.post('/rates/special', requireModule('settings'), async (req: Request, res: Response) => {
  try {
    const { origin_kind, origin_value, dest_kind, dest_value, rate_per_kg, note } = req.body || {};
    for (const [f, v] of [['origin_kind', origin_kind], ['origin_value', origin_value], ['dest_kind', dest_kind], ['dest_value', dest_value]]) {
      if (!v) return res.status(400).json({ detail: `${f} is required.` });
    }
    if (!['zone', 'state', 'city'].includes(origin_kind) || !['zone', 'state', 'city'].includes(dest_kind)) {
      return res.status(400).json({ detail: 'Kind must be zone, state or city.' });
    }
    const rate = engine.num(rate_per_kg);
    if (rate <= 0) return res.status(400).json({ detail: 'Rate must be greater than 0.' });

    const row = await db.insert('rate_special', {
      origin_kind, origin_value, dest_kind, dest_value,
      rate_per_kg: rate, note: note || 'Manual SPR', is_active: true,
      created_at: new Date().toISOString(),
    });
    invalidateRateCache();
    res.status(201).json(row);
  } catch (err: any) {
    if (/duplicate key|already exists/i.test(err.message)) {
      return res.status(409).json({ detail: 'A special rate already exists for that lane. Edit it instead.' });
    }
    res.status(500).json({ detail: err.message });
  }
});

/** Save many special-rate edits at once - what the editable SPR table posts. */
rateRouter.put('/rates/special/bulk', requireModule('settings'), async (req: Request, res: Response) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (rows.length === 0) return res.status(400).json({ detail: 'No changes were sent.' });
    if (rows.length > 500) return res.status(400).json({ detail: 'Too many changes in one request.' });

    const updated: any[] = [];
    const failed: { id: string; reason: string }[] = [];
    for (const r of rows) {
      if (!r?.id) { failed.push({ id: String(r?.id), reason: 'missing id' }); continue; }
      const rate = engine.num(r.rate_per_kg);
      if (!(rate > 0)) { failed.push({ id: r.id, reason: 'rate must be greater than 0' }); continue; }
      const patch: Record<string, any> = { rate_per_kg: rate, updated_at: new Date().toISOString() };
      if (r.is_active !== undefined) patch.is_active = Boolean(r.is_active);
      if (r.note !== undefined) patch.note = r.note;
      const saved = await db.update('rate_special', { id: `eq.${r.id}` }, patch);
      if (saved) updated.push(saved); else failed.push({ id: r.id, reason: 'not found' });
    }

    invalidateRateCache();

    const user = (req as any).user;
    if (user?.email && updated.length) {
      await db.insert('audit_logs', {
        user_email: user.email,
        action: `Special rates edited (${updated.length} lane${updated.length === 1 ? '' : 's'})`,
        entity: 'rate_special',
        new_value: updated.map(u => ({ lane: `${u.origin_value} -> ${u.dest_value}`, rate: engine.num(u.rate_per_kg) })),
        created_at: new Date().toISOString(),
      });
    }

    res.json({ updated: updated.length, failed });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// NOTE: keep every literal sub-path (e.g. /bulk) ABOVE this one - Express matches in
// order and ':id' would otherwise capture the literal segment.
rateRouter.put('/rates/special/:id', requireModule('settings'), async (req: Request, res: Response) => {
  try {
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (req.body.rate_per_kg !== undefined) {
      const rate = engine.num(req.body.rate_per_kg);
      if (rate <= 0) return res.status(400).json({ detail: 'Rate must be greater than 0.' });
      patch.rate_per_kg = rate;
    }
    if (req.body.is_active !== undefined) patch.is_active = Boolean(req.body.is_active);
    if (req.body.note !== undefined) patch.note = req.body.note;

    const row = await db.update('rate_special', { id: `eq.${req.params.id}` }, patch);
    if (!row) return res.status(404).json({ detail: 'That special rate could not be found.' });
    invalidateRateCache();
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

rateRouter.delete('/rates/special/:id', requireModule('settings'), async (req: Request, res: Response) => {
  try {
    await db.remove('rate_special', { id: `eq.${req.params.id}` });
    invalidateRateCache();
    res.json({ message: 'Special rate removed.' });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

/** Save a quote so it can be reopened or turned into an invoice. */
rateRouter.post('/rates/quotes', requireRates, async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const e = await effectiveCard(body.customer_id, body.rate_mode);
    if (!body.origin?.zone || !body.dest?.zone) {
      return res.status(400).json({ detail: 'Please choose both a pickup and a delivery location.' });
    }
    const q = engine.buildQuote(body, e.settings, e.specials, e.matrix, e.d.oda);
    const user = (req as any).user;

    const row = await db.insert('rate_quotes', {
      user_id: user?.id || null,
      customer_id: body.customer_id || null,
      origin_label: body.origin.label || body.origin.city || body.origin.state || body.origin.zone,
      dest_label: body.dest.label || body.dest.city || body.dest.state || body.dest.zone,
      origin_zone: q.origin.zone,
      dest_zone: q.dest.zone,
      dead_weight: q.weight.dead_weight,
      volumetric_weight: q.weight.volumetric_weight,
      chargeable_weight: q.weight.chargeable_weight,
      declared_value: engine.num(body.declared_value),
      boxes: q.weight.total_boxes,
      rate_per_kg: q.rate.rate_per_kg,
      rate_source: q.rate.source,
      breakdown: { card_source: e.source, lines: q.lines, subtotal: q.subtotal, gst_amount: q.gst_amount, gst_rate: q.gst_rate, fuel_hike_pct: q.fuel_hike_pct },
      grand_total: q.grand_total,
      created_at: new Date().toISOString(),
    });
    res.status(201).json({ ...row, quote: q });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

rateRouter.get('/rates/quotes', requireRates, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 25, 100);
    const rows = await db.select('rate_quotes', { order: 'created_at.desc', limit });
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});
