/**
 * Browser-side access to the invoice calculation engine.
 *
 * `server/calc.ts` is pure TypeScript with no Node dependencies, so Vite bundles it
 * directly. Using the very same function for the live preview and for the persisted
 * totals means the numbers in the form always match the saved invoice / PDF.
 */
export {
  compute,
  num,
  r2,
  extrasList,
  lrItemsList,
  lrItemsFreight,
  lrNumbersLabel,
  normaliseGstType,
  amountInWords,
  splitInclusive,
  VENDOR_GST_RATE,
} from '../../server/calc.js';
export type { LrItem, InvoiceTotals } from '../../server/calc.js';
