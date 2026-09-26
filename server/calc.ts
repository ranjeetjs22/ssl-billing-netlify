/**
 * Single source of truth for freight, discount, GST calculations, and Indian amount in words.
 *
 * NOTE: This module is intentionally dependency-free and side-effect-free so the
 * browser bundle can import it too (see src/utils/calc.ts) - the live preview in the
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

/* ---------------------------------------------------- vendor GST split */

/** GST rate vendors charge us (lorry hire, commission …). */
export const VENDOR_GST_RATE = 18;

/**
 * Split an amount that already INCLUDES GST into the cost and the GST inside it.
 *
 *   base = combined × 100 / (100 + rate)      11,800 → 10,000
 *   gst  = combined − base                    11,800 →  1,800
 *
 * Taking 18% of the combined amount would be wrong (11,800 × 18% = 2,124): the
 * 18% applies to the base, not to a figure that already contains the GST.
 * The GST is taken as the remainder so base + gst always equals what was paid.
 */
export function splitInclusive(combined: number, rate: number = VENDOR_GST_RATE) {
  const total = r2(num(combined));
  const base = r2((total * 100) / (100 + rate));
  return { base, gst: r2(total - base) };
}

/**
 * What we paid for a trip or a cost, entered as ONE amount including the vendor's GST.
 * Returns the cost without GST, the GST inside it, and the combined figure to show
 * in the form again. Older rows saved cost and GST separately; those are read as-is.
 */
function paidAmount(raw: any, costKey: string, gstKey: string): { cost: number | null; gst: number; combined: number | null; gstIncluded: boolean } {
  const combinedRaw = raw.cost_incl_gst ?? raw.amount_incl_gst;
  if (combinedRaw !== undefined && combinedRaw !== null && combinedRaw !== '') {
    const combined = r2(num(combinedRaw));
    const gstIncluded = raw.gst_included !== false;
    const { base, gst } = gstIncluded ? splitInclusive(combined) : { base: combined, gst: 0 };
    return { cost: base, gst, combined, gstIncluded };
  }
  const blank = raw[costKey] === null || raw[costKey] === undefined || raw[costKey] === '';
  const cost = blank ? null : r2(num(raw[costKey]));
  const gst = r2(num(raw[gstKey]));
  return { cost, gst, combined: cost === null ? null : r2(cost + gst), gstIncluded: gst > 0 };
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
  /** What we paid for this trip INCLUDING the vendor's GST, as entered. null = not costed yet. */
  cost_incl_gst: number | null;
  /** true when that amount includes 18% GST; false for a vendor who charged no GST. */
  gst_included: boolean;
  /** What we paid for this trip (lorry hire) without GST. Derived from cost_incl_gst. */
  cost: number | null;
  /** Who we paid: lorry owner, broker or transporter. */
  vendor: string;
  /** GST the vendor charged us on that cost. Derived from cost_incl_gst. */
  cost_gst: number;
  /** false when that GST cannot be claimed back (unregistered vendor, etc). */
  itc: boolean;
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
    const paid = paidAmount(x, 'cost', 'cost_gst');
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
      // Blank stays null so an uncosted LR is never read as a free trip.
      cost_incl_gst: paid.combined,
      gst_included: paid.gstIncluded,
      cost: paid.cost,
      vendor: String(x.vendor ?? '').trim(),
      cost_gst: paid.gst,
      itc: x.itc !== false,
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

/* ------------------------------------------------------------- doc type */

export type DocType = 'tax_invoice' | 'internal';

/** GST tax invoice, or an internal (non-GST) bill that never enters a return. */
export function docType(inv: Record<string, any> | null | undefined): DocType {
  return String(inv?.doc_type || '').toLowerCase() === 'internal' ? 'internal' : 'tax_invoice';
}
export const isTaxInvoice = (inv: Record<string, any>) => docType(inv) === 'tax_invoice';

/* -------------------------------------------------------------- costing */

export interface CostItem {
  label: string;
  /** What we paid INCLUDING the vendor's GST, as entered. */
  amount_incl_gst: number;
  /** true when that amount includes 18% GST. */
  gst_included: boolean;
  /** Cost without GST, and the GST inside it. Both derived from amount_incl_gst. */
  amount: number;
  gst: number;
  itc: boolean;
}

/** Bill-level costs (commission, POD...), each with the GST the vendor charged. */
export function costsList(raw: any): CostItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c: any) => c && typeof c === 'object')
    .map((c: any) => {
      const paid = paidAmount(c, 'amount', 'gst');
      return {
        label: String(c.label || c.name || 'Cost').trim(),
        amount_incl_gst: paid.combined ?? 0,
        gst_included: paid.gstIncluded,
        amount: paid.cost ?? 0,
        gst: paid.gst,
        itc: c.itc !== false,
      };
    })
    .filter(c => c.amount > 0 || c.gst > 0);
}

/**
 * Cost and profit for a bill.
 *
 * Profit is measured on the TAXABLE value, never the grand total: the GST on a
 * tax invoice is money held for the government, not income. On an internal
 * bill there is no GST, so the two are the same.
 *
 * A bill with no cost entered anywhere is "not costed" (null), which is not the
 * same as a cost of zero. Treating it as zero would show a 100% margin on every
 * bill nobody has costed yet.
 */
export function costing(inv: Record<string, any>, taxable: number) {
  // Input credit can only be claimed against sales that go in the GST return.
  // On an internal (non-GST) bill the vendor's GST is therefore part of the
  // cost, recorded separately so it stays visible, but never counted as credit.
  const internal = docType(inv) === 'internal';
  const lr = lrItemsList(inv.lr_items);
  const lrCosted = lr.filter(l => l.cost !== null);
  const other = costsList(inv.other_costs);

  let base = 0;          // what the service itself cost, before GST
  let credit = 0;        // vendor GST we can claim back: not a cost
  let blocked = 0;       // vendor GST we cannot claim: a real cost
  const add = (amount: number, gst: number, itc: boolean) => {
    base += amount;
    if (gst > 0) { if (itc && !internal) credit += gst; else blocked += gst; }
  };
  for (const l of lrCosted) add(l.cost || 0, l.cost_gst, l.itc);
  for (const o of other) add(o.amount, o.gst, o.itc);

  const lrCost = lrCosted.reduce((a, l) => a + (l.cost || 0), 0);
  const otherCost = other.reduce((a, o) => a + o.amount, 0);
  const costed = lrCosted.length > 0 || other.length > 0;
  const total = costed ? r2(base + blocked) : null;
  const profit = total === null ? null : r2(taxable - total);
  return {
    lr_cost: r2(lrCost),
    other_costs: other,
    other_cost_total: r2(otherCost),
    /** Vendor GST claimable as input tax credit (GST bills only). */
    input_gst: r2(credit),
    /** Vendor GST that is a cost: unclaimable vendors, and all of it on non-GST bills. */
    blocked_gst: r2(blocked),
    total_cost: total,
    gross_profit: profit,
    margin_pct: profit === null || taxable <= 0 ? null : r2((profit / taxable) * 100),
    /** Some LRs costed, some not: the profit shown is not the whole picture. */
    partly_costed: lr.length > 0 && lrCosted.length > 0 && lrCosted.length < lr.length,
  };
}

export function compute(raw: Record<string, any>) {
  const doc = docType(raw);
  // An internal bill carries no GST by definition, whatever the form sent.
  const inv = doc === 'internal' ? { ...raw, gst_type: 'exempt', gst_rate: 0 } : raw;
  const t = computeTotals(inv);
  return { ...t, doc_type: doc, ...costing(inv, t.taxable_amount) };
}

function computeTotals(inv: Record<string, any>) {
  const extras = extrasList(inv.extra_charges);
  const extrasSum = extras.reduce((acc, e) => acc + e.amount, 0);
  const lrItems = lrItemsList(inv.lr_items);
  const lrFreight = lrItemsFreight(lrItems);

  // ------------------------------------------------------------------
  // Persisted rows are the billing truth.
  // A row that already carries complete stored totals (grand_total + taxable_amount)
  // is an invoice that was actually issued - display exactly what was billed instead
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

/**
 * Today as YYYY-MM-DD in India Standard Time.
 *
 * The business runs on IST but the server does not: Cloudflare Workers run in
 * UTC, so `new Date().toISOString()` is yesterday's date until 05:30 IST. That
 * put the wrong date on invoices raised in the morning and, on 1 April, the
 * wrong financial year in the invoice number.
 */
export function todayIST(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export type InvoiceStatus = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled';

export function displayStatus(
  inv: Record<string, any>,
  paidAmount: number,
  totals: { grand_total: number },
  today: string = todayIST()
): InvoiceStatus {
  const stored = String(inv.status || '').trim().toLowerCase();
  if (['cancelled', 'canceled'].includes(stored)) return 'cancelled';
  if (stored === 'draft') return 'draft';

  const total = totals.grand_total;
  if (total > 0 && paidAmount >= total - 1) return 'paid';

  const due = inv.due_date || inv.invoice_date;
  const overdue = Boolean(due) && String(due).slice(0, 10) < today;

  if (paidAmount > 0) {
    return overdue ? 'overdue' : 'partially_paid';
  }
  return overdue ? 'overdue' : 'issued';
}

/* ------------------------------------------------------------ period summary */

export interface MonthRow {
  month: string;          // YYYY-MM
  invoices: number;
  sales: number;          // grand total billed in the month
  collected: number;      // received against that month's bills, whenever it arrived
  outstanding: number;    // still due on that month's bills
  cash_received: number;  // payments dated inside the month, against any bill
  gst_sales: number;
  non_gst_sales: number;
  cost: number;
  gross_profit: number;
}

export interface PeriodSummary {
  range: { from: string; to: string };
  /** Issued invoices in the period. Drafts and cancellations are counted apart. */
  invoices: number;
  draft: number;
  cancelled: number;
  paid: number;
  pending: number;
  overdue: number;
  total_sales: number;
  taxable_sales: number;
  gst: number;
  cgst: number;
  sgst: number;
  igst: number;
  /** Received against the period's invoices, whatever date the money arrived. */
  collected: number;
  /** Still due on the period's invoices. total_sales = collected + outstanding. */
  outstanding: number;
  overdue_amount: number;
  /** Payments dated inside the period, against any invoice. The cash-flow view. */
  cash_received: number;

  /** Split by document: GST tax invoices vs internal (non-GST) bills. */
  gst_invoices: number;
  non_gst_invoices: number;
  gst_sales: number;          // grand total of tax invoices
  gst_taxable_sales: number;  // their taxable value, the revenue part
  non_gst_sales: number;      // internal bills (no GST, so value = revenue)
  /** Revenue = taxable value of every bill. GST is excluded: it is not income. */
  revenue: number;

  /** Costing, over the bills that have a cost entered. */
  costed_invoices: number;
  uncosted_invoices: number;
  costed_revenue: number;
  total_cost: number;
  gross_profit: number;
  /** gross_profit / costed_revenue. Only meaningful over costed bills. */
  margin_pct: number | null;

  /** Input tax credit from vendor GST on GST bills' costs. */
  input_gst: number;
  /** Output GST minus input credit. Negative means credit carried forward. */
  gst_payable: number;
  /** Vendor GST on non-GST bills' costs: recorded, counted in cost, never credit. */
  non_gst_vendor_gst: number;

  series: MonthRow[];
}

/**
 * The one definition of sales, collected and outstanding for a period.
 *
 * Every figure is a fact about the invoices DATED in the period:
 *   - collected is what has been paid on them, no matter when it was paid
 *   - outstanding is what is still due on them
 *   - so sales = collected + outstanding, always
 *
 * Cash received is reported separately because it answers a different question
 * ("how much money came in this month") and mixing the two is exactly what made
 * the old dashboard wrong: it subtracted this month's receipts, including money
 * for last month's bills, from this month's sales and called that outstanding.
 *
 * Drafts are not sales and cancelled bills are not receivables, so neither
 * touches a money figure.
 */
export function summarise(
  invoices: Record<string, any>[],
  payments: Record<string, any>[],
  opts: { from?: string; to?: string; today?: string } = {}
): PeriodSummary {
  const from = opts.from || '0000-01-01';
  const to = opts.to || '9999-12-31';
  const today = opts.today || todayIST();

  // Paid is a property of the invoice, so it is built from every payment on
  // record. Filtering payments by the period here is the bug this replaces.
  const paidBy: Record<string, number> = {};
  for (const p of payments) {
    paidBy[p.invoice_id] = (paidBy[p.invoice_id] || 0) + num(p.amount);
  }

  const inPeriod = (d: any) => {
    const s = String(d || '').slice(0, 10);
    return s >= from && s <= to;
  };
  const monthOf = (d: any) => String(d || '').slice(0, 7);

  const out: PeriodSummary = {
    range: { from, to },
    invoices: 0, draft: 0, cancelled: 0, paid: 0, pending: 0, overdue: 0,
    total_sales: 0, taxable_sales: 0, gst: 0, cgst: 0, sgst: 0, igst: 0,
    collected: 0, outstanding: 0, overdue_amount: 0, cash_received: 0,
    gst_invoices: 0, non_gst_invoices: 0, gst_sales: 0, gst_taxable_sales: 0, non_gst_sales: 0,
    revenue: 0, costed_invoices: 0, uncosted_invoices: 0, costed_revenue: 0,
    total_cost: 0, gross_profit: 0, margin_pct: null,
    input_gst: 0, gst_payable: 0, non_gst_vendor_gst: 0,
    series: [],
  };

  const months: Record<string, MonthRow> = {};
  const month = (m: string): MonthRow =>
    (months[m] ||= {
      month: m, invoices: 0, sales: 0, collected: 0, outstanding: 0, cash_received: 0,
      gst_sales: 0, non_gst_sales: 0, cost: 0, gross_profit: 0,
    });

  for (const inv of invoices) {
    if (!inPeriod(inv.invoice_date)) continue;

    const t = compute(inv);
    const paid = r2(paidBy[inv.id] || 0);
    const status = displayStatus(inv, paid, t, today);

    if (status === 'cancelled') { out.cancelled += 1; continue; }
    if (status === 'draft') { out.draft += 1; continue; }

    // An overpayment is real money but it is not "collection against this
    // bill" beyond the bill's value, or recovery would exceed 100%.
    const collected = Math.min(paid, t.grand_total);
    const balance = Math.max(0, t.grand_total - paid);

    out.invoices += 1;
    out.total_sales += t.grand_total;
    out.taxable_sales += t.taxable_amount;
    out.gst += t.gst_amount;
    out.cgst += t.cgst;
    out.sgst += t.sgst;
    out.igst += t.igst;
    out.collected += collected;
    out.outstanding += balance;

    const internal = t.doc_type === 'internal';
    if (internal) {
      out.non_gst_invoices += 1;
      out.non_gst_sales += t.grand_total;
    } else {
      out.gst_invoices += 1;
      out.gst_sales += t.grand_total;
      out.gst_taxable_sales += t.taxable_amount;
    }
    out.revenue += t.taxable_amount;
    out.input_gst += t.input_gst;
    if (internal) out.non_gst_vendor_gst += t.blocked_gst;
    if (t.total_cost !== null) {
      out.costed_invoices += 1;
      out.costed_revenue += t.taxable_amount;
      out.total_cost += t.total_cost;
      out.gross_profit += t.gross_profit || 0;
    } else {
      out.uncosted_invoices += 1;
    }

    if (status === 'paid') {
      out.paid += 1;
    } else {
      out.pending += 1;
      if (status === 'overdue') {
        out.overdue += 1;
        out.overdue_amount += balance;
      }
    }

    const m = monthOf(inv.invoice_date);
    if (m) {
      const row = month(m);
      row.invoices += 1;
      row.sales += t.grand_total;
      row.collected += collected;
      row.outstanding += balance;
      if (internal) row.non_gst_sales += t.grand_total; else row.gst_sales += t.grand_total;
      if (t.total_cost !== null) {
        row.cost += t.total_cost;
        row.gross_profit += t.gross_profit || 0;
      }
    }
  }

  for (const p of payments) {
    const d = p.payment_date || p.created_at;
    if (!inPeriod(d)) continue;
    const amt = num(p.amount);
    out.cash_received += amt;
    const m = monthOf(d);
    if (m) month(m).cash_received += amt;
  }

  // Fill the months between first and last so the chart's axis has no silent
  // gaps: a month with no bills is a zero, not a missing tick.
  const keys = Object.keys(months).sort();
  if (keys.length > 1) {
    let [y, mo] = keys[0].split('-').map(Number);
    const last = keys[keys.length - 1];
    for (;;) {
      const k = `${y}-${String(mo).padStart(2, '0')}`;
      if (k > last) break;
      month(k);
      mo += 1;
      if (mo > 12) { mo = 1; y += 1; }
    }
  }

  out.series = Object.values(months)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(m => ({
      ...m,
      sales: r2(m.sales), collected: r2(m.collected),
      outstanding: r2(m.outstanding), cash_received: r2(m.cash_received),
      gst_sales: r2(m.gst_sales), non_gst_sales: r2(m.non_gst_sales),
      cost: r2(m.cost), gross_profit: r2(m.gross_profit),
    }));

  for (const k of ['total_sales', 'taxable_sales', 'gst', 'cgst', 'sgst', 'igst',
                   'collected', 'outstanding', 'overdue_amount', 'cash_received',
                   'gst_sales', 'gst_taxable_sales', 'non_gst_sales', 'revenue',
                   'costed_revenue', 'total_cost', 'gross_profit',
                   'input_gst', 'non_gst_vendor_gst'] as const) {
    out[k] = r2(out[k]);
  }
  out.gst_payable = r2(out.gst - out.input_gst);
  out.margin_pct = out.costed_revenue > 0 ? r2((out.gross_profit / out.costed_revenue) * 100) : null;
  return out;
}
