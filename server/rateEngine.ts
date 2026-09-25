/**
 * SSL freight rate engine.
 *
 * Pure and dependency-free so the browser can import it too (see src/utils/rates.ts) —
 * the live quote in the UI and the number the server stores are produced by the same code.
 *
 * Source of truth: SSL_Rate_card.pdf
 *   - a 9x9 origin-zone x destination-zone matrix ("conditional / basic" rate)
 *   - SPR rows that override the matrix for specific states and cities
 *   - a charge table (FSC, fuel hike, ROV, FM, handling, ODA, minimums...)
 */

export function num(v: any): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

export function r2(v: number): number {
  return Math.round((v + 1e-9) * 100) / 100;
}

// ---------------------------------------------------------------- types
export type PlaceKind = 'zone' | 'state' | 'city';

export interface Place {
  /** What the user picked. A city also carries its state and zone. */
  kind: PlaceKind;
  city?: string;
  state?: string;
  zone: string;
  label?: string;
}

export interface SpecialRate {
  id?: string;
  origin_kind: PlaceKind;
  origin_value: string;
  dest_kind: PlaceKind;
  dest_value: string;
  rate_per_kg: number | string;
  note?: string;
  is_active?: boolean;
}

export interface MatrixRow {
  origin_zone: string;
  dest_zone: string;
  rate_per_kg: number | string;
}

export interface OdaSlab {
  lower_kg: number | string;
  upper_kg: number | string;
  per_kg: number | string;
  min_amount: number | string;
  max_amount?: number | string | null;
}

export interface RateSettings {
  [key: string]: { value?: number | string | null; text_value?: string | null; min_value?: number | string | null; max_value?: number | string | null };
}

export interface Box {
  count: number;
  length_cm: number;
  width_cm: number;
  height_cm: number;
}

export interface QuoteInput {
  origin: Place;
  dest: Place;
  /** Actual (dead) weight in kg for the whole shipment. */
  dead_weight: number;
  boxes?: Box[];
  declared_value?: number;
  /** Optional service add-ons, mirroring the rate card's charge list. */
  appointment_delivery?: boolean;
  oda?: boolean;
  to_pay?: boolean;
  cheque_payment?: boolean;
  insurance?: 'none' | 'owner' | 'carrier';
  /** Current diesel price; defaults to the configured current rate. */
  fuel_rate?: number;
  /** Override the auto-resolved rate (manual quoting). */
  rate_override?: number | null;
}

export interface ChargeLine {
  key: string;
  label: string;
  amount: number;
  hint?: string;
}

// ---------------------------------------------------------------- helpers
const setting = (s: RateSettings, key: string, fallback = 0): number => {
  const row = s[key];
  if (!row) return fallback;
  const v = num(row.value);
  return row.value === null || row.value === undefined ? fallback : v;
};
const settingMin = (s: RateSettings, key: string): number => num(s[key]?.min_value);
const settingText = (s: RateSettings, key: string, fallback = ''): string =>
  (s[key]?.text_value ?? fallback) as string;

/** Apply a "per unit, but at least X" rule. A zero rate means the charge is switched off. */
function withMinimum(computed: number, min: number): number {
  if (computed <= 0) return 0;
  return r2(Math.max(computed, min));
}

// ---------------------------------------------------------------- rate resolution
/**
 * How specific a special-rate row is. Higher wins.
 * Destination specificity outranks origin: the delivery end drives the cost
 * (a hill town costs the same to reach from anywhere in a zone).
 */
export function specificity(originKind: PlaceKind, destKind: PlaceKind): number {
  const rank: Record<PlaceKind, number> = { zone: 0, state: 1, city: 2 };
  return rank[destKind] * 10 + rank[originKind];
}

function placeMatches(place: Place, kind: PlaceKind, value: string): boolean {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return false;
  if (kind === 'zone') return String(place.zone || '').toLowerCase() === v;
  if (kind === 'state') return String(place.state || '').toLowerCase() === v;
  return String(place.city || '').toLowerCase() === v;
}

export interface ResolvedRate {
  rate_per_kg: number;
  source: 'special' | 'matrix' | 'override' | 'none';
  note?: string;
  matched?: string;
}

/** Pick the rate for an origin/destination pair: most specific SPR row, else the zone matrix. */
export function resolveRate(
  origin: Place,
  dest: Place,
  specials: SpecialRate[],
  matrix: MatrixRow[],
  override?: number | null
): ResolvedRate {
  if (override !== null && override !== undefined && num(override) > 0) {
    return { rate_per_kg: r2(num(override)), source: 'override', note: 'Manually entered rate' };
  }

  let best: { row: SpecialRate; score: number } | null = null;
  for (const row of specials) {
    if (row.is_active === false) continue;
    if (!placeMatches(origin, row.origin_kind, row.origin_value)) continue;
    if (!placeMatches(dest, row.dest_kind, row.dest_value)) continue;
    const score = specificity(row.origin_kind, row.dest_kind);
    if (!best || score > best.score) best = { row, score };
  }

  if (best) {
    return {
      rate_per_kg: r2(num(best.row.rate_per_kg)),
      source: 'special',
      note: best.row.note || 'Special rate (SPR)',
      matched: `${best.row.origin_kind}:${best.row.origin_value} → ${best.row.dest_kind}:${best.row.dest_value}`,
    };
  }

  const m = matrix.find(r => r.origin_zone === origin.zone && r.dest_zone === dest.zone);
  if (m) {
    return {
      rate_per_kg: r2(num(m.rate_per_kg)),
      source: 'matrix',
      note: 'Zone base rate',
      matched: `${origin.zone} → ${dest.zone}`,
    };
  }

  return { rate_per_kg: 0, source: 'none', note: 'No rate configured for this lane' };
}

// ---------------------------------------------------------------- weight
export interface WeightResult {
  dead_weight: number;
  volumetric_weight: number;
  chargeable_weight: number;
  total_boxes: number;
  basis: 'dead' | 'volumetric' | 'minimum';
}

export function computeWeight(input: QuoteInput, settings: RateSettings): WeightResult {
  const divisor = setting(settings, 'divisor', 4500) || 4500;
  const minChg = setting(settings, 'min_chg_wt', 0);
  const roundOff = settingText(settings, 'round_off', 'yes').toLowerCase() === 'yes';

  const boxes = (input.boxes || []).filter(b => num(b.count) > 0);
  let volumetric = 0;
  let totalBoxes = 0;
  for (const b of boxes) {
    const count = num(b.count);
    totalBoxes += count;
    const vol = num(b.length_cm) * num(b.width_cm) * num(b.height_cm);
    if (vol > 0) volumetric += (vol * count) / divisor;
  }

  const dead = r2(num(input.dead_weight));
  volumetric = r2(volumetric);

  // Weight rule from the rate card: chargeable = max(dead, volumetric)
  let chargeable = Math.max(dead, volumetric);
  let basis: WeightResult['basis'] = volumetric > dead ? 'volumetric' : 'dead';

  if (minChg > 0 && chargeable < minChg) {
    chargeable = minChg;
    basis = 'minimum';
  }
  if (roundOff) chargeable = Math.ceil(chargeable - 1e-9);

  return {
    dead_weight: dead,
    volumetric_weight: volumetric,
    chargeable_weight: r2(chargeable),
    total_boxes: totalBoxes,
    basis,
  };
}

// ---------------------------------------------------------------- fuel hike (DPH)
/**
 * Diesel price hike: for every `fuel_rate_step` rupees the diesel rate has moved
 * above the base rate, freight rises by `fuel_freight_step` percent.
 */
export function fuelHikePercent(settings: RateSettings, currentRate?: number): number {
  if (setting(settings, 'fuel_hike_applicable', 0) !== 1) return 0;
  const base = setting(settings, 'fuel_base_rate', 0);
  const cur = currentRate === undefined || currentRate === null
    ? setting(settings, 'fuel_current_rate', base)
    : num(currentRate);
  const step = setting(settings, 'fuel_rate_step', 0);
  const pct = setting(settings, 'fuel_freight_step', 0);
  const threshold = setting(settings, 'fuel_hike_threshold', 0);
  if (!base || !step || !pct) return 0;

  const diff = cur - base - threshold;
  // fuel_hike_logic = 1 -> never let a price drop reduce the freight
  if (diff <= 0) return setting(settings, 'fuel_hike_logic', 1) === 1 ? 0 : r2((Math.ceil(diff / step) * pct));
  return r2(Math.floor(diff / step) * pct);
}

// ---------------------------------------------------------------- ODA
export function odaCharge(weight: number, slabs: OdaSlab[]): number {
  const slab = slabs.find(s => weight > num(s.lower_kg) && weight <= num(s.upper_kg))
    || slabs.find(s => weight >= num(s.lower_kg) && weight <= num(s.upper_kg));
  if (!slab) return 0;
  const computed = weight * num(slab.per_kg);
  let amount = Math.max(computed, num(slab.min_amount));
  const max = slab.max_amount === null || slab.max_amount === undefined ? 0 : num(slab.max_amount);
  if (max > 0) amount = Math.min(amount, max);
  return r2(amount);
}

// ---------------------------------------------------------------- handling
/**
 * Package handling only applies to a SINGLE heavy package — one box that needs a
 * forklift/crane to move. A shipment split across several boxes is handled manually
 * however heavy the total is, so it attracts no handling charge.
 */
function handlingPerKg(weight: number, totalBoxes: number, settings: RateSettings): number {
  if (totalBoxes !== 1) return 0;
  if (weight >= 400) return setting(settings, 'handling_400_plus', 0);
  if (weight >= 250) return setting(settings, 'handling_250_400', 0);
  if (weight >= 100) return setting(settings, 'handling_100_250', 0);
  return 0;
}

// ---------------------------------------------------------------- the quote
export interface Quote {
  origin: Place;
  dest: Place;
  weight: WeightResult;
  rate: ResolvedRate;
  base_freight: number;
  min_lr_applied: boolean;
  fuel_hike_pct: number;
  lines: ChargeLine[];
  subtotal: number;
  gst_rate: number;
  gst_amount: number;
  round_off: number;
  grand_total: number;
  per_kg_effective: number;
}

export function buildQuote(
  input: QuoteInput,
  settings: RateSettings,
  specials: SpecialRate[],
  matrix: MatrixRow[],
  odaSlabs: OdaSlab[]
): Quote {
  const weight = computeWeight(input, settings);
  const rate = resolveRate(input.origin, input.dest, specials, matrix, input.rate_override);
  const cw = weight.chargeable_weight;

  // ---- base freight, floored at the minimum LR charge ----
  const rawFreight = r2(cw * rate.rate_per_kg);
  const minLr = setting(settings, 'min_lr_charge', 0);
  const minLrApplied = rawFreight > 0 && rawFreight < minLr;
  const baseFreight = rate.rate_per_kg > 0 ? r2(Math.max(rawFreight, minLr)) : 0;

  const lines: ChargeLine[] = [];
  const push = (key: string, label: string, amount: number, hint?: string) => {
    if (amount > 0) lines.push({ key, label, amount: r2(amount), hint });
  };

  push('base_freight', 'Base Freight Charge', baseFreight,
    minLrApplied
      ? `Minimum LR charge ₹${minLr.toFixed(2)} (${cw} kg × ₹${rate.rate_per_kg}/kg = ₹${rawFreight.toFixed(2)})`
      : `${cw} kg × ₹${rate.rate_per_kg}/kg`);

  // ---- fuel hike (DPH) on base freight ----
  const hikePct = fuelHikePercent(settings, input.fuel_rate);
  const fuelHike = r2((baseFreight * hikePct) / 100);
  push('fuel_hike', 'Fuel Hike Charges', fuelHike, `${hikePct}% of base freight`);

  // ---- fuel surcharge ----
  const fscPct = setting(settings, 'fsc', 0);
  const fsc = r2((baseFreight * fscPct) / 100);
  push('fsc', 'Fuel Surcharge', fsc, `${fscPct}% of base freight`);

  // ---- insurance / ROV ----
  const declared = num(input.declared_value);
  const mode = input.insurance || 'none';
  if (mode !== 'none') {
    const pct = setting(settings, mode === 'carrier' ? 'rov_carrier' : 'rov_owner', 0);
    const min = settingMin(settings, mode === 'carrier' ? 'rov_carrier' : 'rov_owner');
    const rov = withMinimum(r2((declared * pct) / 100), min);
    push('rov', mode === 'carrier' ? 'Insurance / ROV (carrier risk)' : 'Insurance / ROV (owner risk)', rov,
      declared > 0 ? `${pct}% of ₹${declared.toLocaleString('en-IN')} (min ₹${min})` : `Minimum ₹${min}`);
  }

  // ---- first / last mile ----
  push('fm_cost', 'FM Charges', withMinimum(r2(cw * setting(settings, 'fm_cost', 0)), settingMin(settings, 'fm_cost')),
    `${cw} kg × ₹${setting(settings, 'fm_cost', 0)}/kg`);
  push('lm_cost', 'LM Charges', withMinimum(r2(cw * setting(settings, 'lm_cost', 0)), settingMin(settings, 'lm_cost')));

  // ---- processing / handling / green tax ----
  push('processing', 'Processing Charge', setting(settings, 'processing', 0), 'Per LR');
  const handPerKg = handlingPerKg(cw, weight.total_boxes, settings);
  push('handling', 'Package Handling', r2(cw * handPerKg),
    handPerKg ? `Single package over 400 kg — ${cw} kg × ₹${handPerKg}/kg` : undefined);
  push('green_tax', 'Green Tax', withMinimum(r2(cw * setting(settings, 'green_tax', 0)), settingMin(settings, 'green_tax')));

  // ---- optional services ----
  if (input.appointment_delivery) {
    push('apt_handling', 'Appointment Delivery',
      withMinimum(r2(cw * setting(settings, 'apt_handling', 0)), settingMin(settings, 'apt_handling')),
      `${cw} kg × ₹${setting(settings, 'apt_handling', 0)}/kg (min ₹${settingMin(settings, 'apt_handling')})`);
  }
  if (input.oda) {
    push('oda', 'ODA Charges', odaCharge(cw, odaSlabs), 'Out of delivery area');
  }
  if (input.to_pay) push('to_pay', 'To-Pay Charge', setting(settings, 'to_pay', 0), 'Per LR');
  if (input.cheque_payment) push('cheque_handling', 'Cheque Handling', setting(settings, 'cheque_handling', 0), 'Per LR');

  // ---- totals ----
  const subtotal = r2(lines.reduce((a, l) => a + l.amount, 0));
  const gstRate = setting(settings, 'gst_rate', 18);
  const gstAmount = r2((subtotal * gstRate) / 100);
  const preRound = r2(subtotal + gstAmount);
  const grand = Math.round(preRound);

  return {
    origin: input.origin,
    dest: input.dest,
    weight,
    rate,
    base_freight: baseFreight,
    min_lr_applied: minLrApplied,
    fuel_hike_pct: hikePct,
    lines,
    subtotal,
    gst_rate: gstRate,
    gst_amount: gstAmount,
    round_off: r2(grand - preRound),
    grand_total: grand,
    per_kg_effective: cw > 0 ? r2(grand / cw) : 0,
  };
}
