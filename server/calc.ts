/**
 * Single source of truth for freight, discount, GST calculations, and Indian amount in words.
 *
 * NOTE: This module is intentionally dependency-free and side-effect-free so the
 * browser bundle can import it too (see src/utils/calc.ts) — the live preview in the
 * invoice form and the persisted totals on the server are guaranteed to agree.
 */

export function num(v: any): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

export function r2(v: number): number {
  return Math.round((v + 1e-9) * 100) / 100;
}

export interface LrItem {
  lr_no: string;
  lr_date: string;
  origin: string;
  destination: string;
  description: string;
  packages: number;
  weight: number;
  rate_kg: number;
  amount: number;
}

/**
 * Normalise a raw `lr_items` payload (one row per LR / consignment on the bill).
 * Rows with no LR number, weight, or amount are treated as blank and dropped.
 */
export function lrItemsList(raw: any): LrItem[] {
  if (!Array.isArray(raw)) return [];
  const out: LrItem[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const weight = num(x.weight);
    const rate = num(x.rate_kg ?? x.rate);
    let amount = num(x.amount ?? x.freight);
    if (amount <= 0 && weight > 0 && rate > 0) {
      amount = r2(weight * rate);
    }
    const item: LrItem = {
      lr_no: String(x.lr_no ?? x.lr ?? '').trim(),
      lr_date: x.lr_date ? String(x.lr_date).slice(0, 10) : '',
      origin: String(x.origin ?? x.from ?? '').trim(),
      destination: String(x.destination ?? x.to ?? '').trim(),
      description: String(x.description ?? '').trim(),
      packages: num(x.packages),
      weight,
      rate_kg: rate,
      amount: r2(amount),
    };
    if (item.lr_no || item.amount > 0 || item.weight > 0) {
      out.push(item);
    }
  }
  return out;
}

/** Sum of freight across LR lines. */
export function lrItemsFreight(items: LrItem[]): number {
  return r2(items.reduce((acc, l) => acc + l.amount, 0));
}

/** Comma separated LR numbers, e.g. "LR-101, LR-102" */
export function lrNumbersLabel(items: LrItem[]): string {
  return items.map(l => l.lr_no).filter(Boolean).join(', ');
}

export function extrasList(extra: any): { label: string; amount: number }[] {
  const out: { label: string; amount: number }[] = [];
  if (Array.isArray(extra)) {
    for (const e of extra) {
      if (typeof e === 'object' && e !== null) {
        out.push({
          // `desc` is the key the predecessor app used for its extra charges
          label: e.label || e.name || e.desc || 'Additional charge',
          amount: num(e.amount ?? e.value ?? e.amt),
        });
      } else {
        out.push({
          label: 'Additional charge',
          amount: num(e),
        });
      }
    }
  } else if (typeof extra === 'object' && extra !== null) {
    for (const [k, v] of Object.entries(extra)) {
      out.push({
        label: k,
        amount: num(typeof v === 'object' && v !== null ? (v as any).amount : v),
      });
    }
  }
  return out.filter(e => e.amount > 0);
}

export function normaliseGstType(t: any): 'intra' | 'igst' | 'exempt' {
  const s = String(t || 'intra').trim().toLowerCase();
  if (['igst', 'inter', 'inter_state', 'interstate'].includes(s)) {
    return 'igst';
  }
  if (['exempt', 'nil', 'none', 'exempted'].includes(s)) {
    return 'exempt';
  }
  return 'intra';
}

export function compute(inv: Record<string, any>) {
  const extras = extrasList(inv.extra_charges);
  const extrasSum = extras.reduce((acc, e) => acc + e.amount, 0);
  const lrItems = lrItemsList(inv.lr_items);
  const lrFreight = lrItemsFreight(lrItems);

  // ------------------------------------------------------------------
  // Persisted rows are the billing truth.
  // A row that already carries complete stored totals (grand_total + taxable_amount)
  // is an invoice that was actually issued — display exactly what was billed instead
  // of re-deriving it. Invoices written by the current app store the same numbers this
  // function computes, so this changes nothing for them; it protects migrated invoices
  // whose issuing app used a different formula. Live previews and create/update paths
  // pass raw form fields (no grand_total), so they always take the derivation below.
  // ------------------------------------------------------------------
  if (num(inv.grand_total) > 0 && inv.taxable_amount !== null && inv.taxable_amount !== undefined) {
    const taxable = r2(num(inv.taxable_amount));
    const discount = r2(num(inv.discount_amount));
    const additional = num(inv.additional_total) > 0
      ? r2(num(inv.additional_total))
      : r2(extrasSum + num(inv.processing) + num(inv.insurance_amt));
    const gstType = normaliseGstType(inv.gst_type);
    const dtype = String(inv.discount_type || 'percent').toLowerCase();
    return {
      freight: num(inv.freight) > 0 ? r2(num(inv.freight)) : (lrFreight > 0 ? lrFreight : r2(taxable + discount - additional)),
      fuel_surcharge: 0,
      fuel_hike: 0,
      lr_items: lrItems,
      lr_count: lrItems.length,
      additional_items: extras,
      additional_total: additional,
      gross_amount: r2(taxable + discount),
      discount_type: (dtype === 'fixed' ? 'fixed' : 'percent') as 'fixed' | 'percent',
      discount_value: r2(num(inv.discount_value)),
      discount_amount: discount,
      taxable_amount: taxable,
      gst_type: gstType,
      gst_rate: gstType === 'exempt' ? 0 : num(inv.gst_rate ?? 18),
      gst_amount: r2(num(inv.gst_amount)),
      cgst: r2(num(inv.cgst)),
      sgst: r2(num(inv.sgst)),
      igst: r2(num(inv.igst)),
      round_off: r2(num(inv.round_off)),
      grand_total: r2(num(inv.grand_total)),
    };
  }

  let freight = 0;
  let fuel = 0;
  let hike = 0;

  if (lrItems.length > 0 && lrFreight > 0) {
    // Multi-LR bill: freight is always the sum of the consignment lines.
    freight = lrFreight;
  } else if (num(inv.freight) > 0) {
    // Direct freight entered by the user (or persisted on the invoice).
    freight = num(inv.freight);
  } else {
    // Derive from weight × rate. A freight of 0 / "" must never override a valid weight × rate.
    const base = num(inv.weight) * num(inv.rate_kg);
    fuel = (base * num(inv.fuel_surcharge_pct)) / 100;
    hike = (base * num(inv.fuel_hike_pct)) / 100;
    freight = base + fuel + hike;
  }

  const additional = r2(extrasSum + num(inv.processing) + num(inv.insurance_amt));

  freight = r2(freight);
  const gross = r2(freight + additional);

  const dtype = String(inv.discount_type || 'percent').toLowerCase();
  let dval = num(inv.discount_value);
  let discount = 0;

  if (dtype === 'fixed') {
    discount = Math.min(r2(Math.max(0, dval)), gross);
  } else {
    dval = Math.max(0, Math.min(dval, 100));
    discount = r2((gross * dval) / 100);
  }

  const taxable = r2(gross - discount);
  const gstType = normaliseGstType(inv.gst_type);
  const rate = gstType === 'exempt' ? 0 : num(inv.gst_rate ?? 18);
  const gst = r2((taxable * rate) / 100);

  let cgst = 0;
  let sgst = 0;
  let igst = 0;

  if (gstType === 'igst') {
    igst = gst;
  } else if (gstType === 'intra') {
    cgst = r2(gst / 2);
    sgst = r2(gst - cgst);
  }

  const preRound = r2(taxable + gst);
  const grand = Math.round(preRound);
  const roundOff = r2(grand - preRound);

  return {
    freight,
    fuel_surcharge: r2(fuel),
    fuel_hike: r2(hike),
    lr_items: lrItems,
    lr_count: lrItems.length,
    additional_items: extras,
    additional_total: additional,
    gross_amount: gross,
    discount_type: dtype === 'fixed' ? 'fixed' : 'percent',
    discount_value: r2(dval),
    discount_amount: discount,
    taxable_amount: taxable,
    gst_type: gstType,
    gst_rate: rate,
    gst_amount: gst,
    cgst,
    sgst,
    igst,
    round_off: roundOff,
    grand_total: grand,
  };
}

export type InvoiceTotals = ReturnType<typeof compute>;

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
  'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return (TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '')).trim();
}

export function amountInWords(amount: number | string): string {
  let n = Math.round(num(amount));
  if (n === 0) return 'Rupees Zero Only';

  const parts: string[] = [];

  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const hundred = Math.floor(n / 100);
  const rest = n % 100;

  if (crore) parts.push(`${twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest) parts.push(twoDigits(rest));

  return `Rupees ${parts.join(' ')} Only`;
}

export function displayStatus(inv: Record<string, any>, paidAmount: number, totals: { grand_total: number }): 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled' {
  const stored = String(inv.status || '').trim().toLowerCase();
  if (['cancelled', 'canceled'].includes(stored)) return 'cancelled';
  if (stored === 'draft') return 'draft';

  const total = totals.grand_total;
  if (total > 0 && paidAmount >= total - 1) return 'paid';

  const due = inv.due_date || inv.invoice_date;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = Boolean(due) && String(due).slice(0, 10) < today;

  if (paidAmount > 0) {
    return overdue ? 'overdue' : 'partially_paid';
  }
  return overdue ? 'overdue' : 'issued';
}
