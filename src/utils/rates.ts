/**
 * Browser-side access to the freight rate engine.
 *
 * `server/rateEngine.ts` is pure TypeScript with no Node dependencies, so Vite bundles it
 * directly. Using the same function for the live quote and the stored quote means the
 * number on screen always matches what the server saves.
 */
export {
  buildQuote,
  resolveRate,
  computeWeight,
  fuelHikePercent,
  odaCharge,
  specificity,
  num,
  r2,
} from '../../server/rateEngine.js';

export type {
  Place,
  PlaceKind,
  Box,
  QuoteInput,
  Quote,
  ChargeLine,
  ResolvedRate,
  WeightResult,
  SpecialRate,
  MatrixRow,
  OdaSlab,
  RateSettings,
} from '../../server/rateEngine.js';

import type { Place as _Place } from '../../server/rateEngine.js';

/** The geography part of a rate card, enough to turn a typed name into a Place. */
export interface PlaceLookup {
  states: { name: string; zone_code: string }[];
  cities: { name: string; state_name: string; zone_code: string }[];
}

/**
 * Turn a free-text city/state name (as typed on an LR line) into a rate-card Place.
 * Tries a known city, then a known state, then `fallbackState` (e.g. the
 * consignee's state for an unlisted town). Returns null when nothing matches.
 */
export function placeFromName(name: string, card: PlaceLookup, fallbackState?: string): _Place | null {
  const n = String(name || '').trim().toLowerCase();
  if (n) {
    const city = card.cities.find(c => c.name.toLowerCase() === n);
    if (city) return { kind: 'city', city: city.name, state: city.state_name, zone: city.zone_code, label: city.name };
    const state = card.states.find(s => s.name.toLowerCase() === n);
    if (state) return { kind: 'state', state: state.name, zone: state.zone_code, label: state.name };
  }
  const fb = String(fallbackState || '').trim().toLowerCase();
  if (n && fb) {
    const state = card.states.find(s => s.name.toLowerCase() === fb);
    // Keep the typed town as the city so a city-level special rate can still match
    if (state) return { kind: 'city', city: String(name).trim(), state: state.name, zone: state.zone_code, label: String(name).trim() };
  }
  return null;
}
