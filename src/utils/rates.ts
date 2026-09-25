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
