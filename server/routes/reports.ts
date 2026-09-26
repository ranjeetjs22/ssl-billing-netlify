import { Router, Request, Response } from 'express';
import * as db from '../db.js';
import * as calc from '../calc.js';
import { authMiddleware, requireModule } from '../auth.js';

export const reportRouter = Router();
reportRouter.use(authMiddleware);

const requireReports = requireModule('invoices');

// ---------------------------------------------------------------- helpers
/** Indian financial year containing a date: 1 Apr - 31 Mar. */
function fyBounds(d: Date): { from: string; to: string; label: string } {
  const y = d.getFullYear();
  const startYear = d.getMonth() >= 3 ? y : y - 1;   // month 3 = April
  return {
    from: `${startYear}-04-01`,
    to: `${startYear + 1}-03-31`,
    label: `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
  };
}

/**
 * Format a Date as YYYY-MM-DD in LOCAL time.
 * toISOString() would convert to UTC first, which in IST (+5:30) turns local midnight
 * on the 1st into the 31st of the previous month - silently shifting every preset by a day.
 */
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Resolve ?preset= or explicit ?from=&to= into a date window. */
function resolveRange(query: Record<string, any>): { from: string; to: string; label: string } {
  const preset = String(query.preset || '').trim();
  // Anchor "now" to the IST calendar date. On Cloudflare the process clock is
  // UTC, so a plain `new Date()` is still last month until 05:30 on the 1st.
  const [y, m, d] = calc.todayIST().split('-').map(Number);
  const now = new Date(y, m - 1, d);

  if (preset === 'this_month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { from: iso(from), to: iso(to), label: from.toLocaleString('en-IN', { month: 'long', year: 'numeric' }) };
  }
  if (preset === 'last_month') {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: iso(from), to: iso(to), label: from.toLocaleString('en-IN', { month: 'long', year: 'numeric' }) };
  }
  if (preset === 'last_quarter' || preset === 'last_3_months') {
    const from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { from: iso(from), to: iso(to), label: 'Last 3 months' };
  }
  if (preset === 'this_fy') {
    return fyBounds(now);
  }
  if (preset === 'last_fy') {
    const prev = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    return fyBounds(prev);
  }

  const from = String(query.from || query.from_date || '').slice(0, 10);
  const to = String(query.to || query.to_date || '').slice(0, 10);
  return {
    from: from || '0000-01-01',
    to: to || '9999-12-31',
    label: from && to ? `${from} to ${to}` : 'All time',
  };
}

function csvCell(v: any): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csvRow = (cells: any[]) => cells.map(csvCell).join(',');

function sendCsv(res: Response, filename: string, rows: string[]) {
  // BOM so Excel opens the rupee sign and Indian names correctly
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  res.send('﻿' + rows.join('\n') + '\n');
}

/** Load invoices in range, enriched with payments and computed totals. */
async function loadInvoices(range: { from: string; to: string }) {
  const [invoices, payments, customers] = await Promise.all([
    db.select('invoices', { order: 'invoice_date.asc' }),
    db.select('payments'),
    db.select('customers'),
  ]);

  const paidMap: Record<string, number> = {};
  for (const p of payments) paidMap[p.invoice_id] = (paidMap[p.invoice_id] || 0) + calc.num(p.amount);
  const custMap = new Map<string, any>(customers.map((c: any) => [c.id, c]));
  const today = calc.todayIST();

  const rows = invoices
    .filter((i: any) => {
      const d = String(i.invoice_date || '').slice(0, 10);
      return d >= range.from && d <= range.to;
    })
    .map((inv: any) => {
      const t = calc.compute(inv);
      const paid = calc.r2(paidMap[inv.id] || 0);
      const status = calc.displayStatus(inv, paid, t, today);
      const cust = custMap.get(inv.customer_id) || {};
      return {
        inv, totals: t, paid,
        balance: calc.r2(Math.max(0, t.grand_total - paid)),
        status,
        customer: cust,
        buyer: inv.buyer || {},
      };
    });

  return { rows, invoices, payments, paidMap };
}

// ---------------------------------------------------------------- summary
/** On-screen preview of what a download will contain. */
reportRouter.get('/reports/summary', requireReports, async (req: Request, res: Response) => {
  try {
    const range = resolveRange(req.query as any);
    const { rows, invoices, payments } = await loadInvoices(range);
    // Issued only: a draft is not a sale and a cancelled bill is not a receivable.
    const live = rows.filter(r => r.status !== 'cancelled' && r.status !== 'draft');

    // Same aggregator as the dashboard, so the preview here and the KPI strip
    // there show the same rupee for the same range.
    const s = calc.summarise(invoices, payments, { from: range.from, to: range.to });

    // Everything GST-shaped below is built from tax invoices only. Internal
    // (non-GST) bills appear in the sales split and profit, never here.
    const gstLive = live.filter(r => r.totals.doc_type === 'tax_invoice');

    // GST split by rate - the shape a GSTR-1 summary needs
    const byRate: Record<string, { rate: number; taxable: number; cgst: number; sgst: number; igst: number; count: number }> = {};
    for (const r of gstLive) {
      const key = String(r.totals.gst_rate);
      if (!byRate[key]) byRate[key] = { rate: r.totals.gst_rate, taxable: 0, cgst: 0, sgst: 0, igst: 0, count: 0 };
      byRate[key].taxable += r.totals.taxable_amount;
      byRate[key].cgst += r.totals.cgst;
      byRate[key].sgst += r.totals.sgst;
      byRate[key].igst += r.totals.igst;
      byRate[key].count += 1;
    }

    res.json({
      range,
      invoice_count: s.invoices,
      draft_count: s.draft,
      cancelled_count: s.cancelled,
      taxable: s.taxable_sales,
      cgst: s.cgst,
      sgst: s.sgst,
      igst: s.igst,
      gst_total: s.gst,
      grand_total: s.total_sales,
      /** Received against this period's invoices, whenever it arrived. */
      received: s.collected,
      /** Payments dated inside the period, against any invoice. */
      cash_received: s.cash_received,
      outstanding: s.outstanding,
      overdue_count: s.overdue,
      overdue_amount: s.overdue_amount,
      b2b_count: gstLive.filter(r => (r.buyer.gstin || r.customer.gstin || '').trim()).length,
      b2c_count: gstLive.filter(r => !(r.buyer.gstin || r.customer.gstin || '').trim()).length,
      gst_invoice_count: s.gst_invoices,
      non_gst_invoice_count: s.non_gst_invoices,
      gst_sales: s.gst_sales,
      gst_taxable_sales: s.gst_taxable_sales,
      non_gst_sales: s.non_gst_sales,
      revenue: s.revenue,
      total_cost: s.total_cost,
      gross_profit: s.gross_profit,
      margin_pct: s.margin_pct,
      input_gst: s.input_gst,
      gst_payable: s.gst_payable,
      non_gst_vendor_gst: s.non_gst_vendor_gst,
      costed_count: s.costed_invoices,
      uncosted_count: s.uncosted_invoices,
      gst_by_rate: Object.values(byRate).map(g => ({
        ...g, taxable: calc.r2(g.taxable), cgst: calc.r2(g.cgst), sgst: calc.r2(g.sgst), igst: calc.r2(g.igst),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// ---------------------------------------------------------------- report model
/**
 * Every report is built once as sections of rows, then either returned as JSON
 * (?format=json, for the on-screen view) or written out as CSV. One builder
 * means what you see on screen is exactly what downloads.
 */
type Kind = 'text' | 'money' | 'num' | 'date' | 'pct' | 'status' | 'mono';
interface Col { key: string; label: string; kind?: Kind }
interface Section {
  id: string;
  title: string;
  note?: string;
  
  columns: Col[];
  rows: Record<string, any>[];
  total?: Record<string, any>;
}
interface Report {
  key: string;
  title: string;
  range: { from: string; to: string; label: string };
  /** Lines printed above the tables in the CSV (company, GSTIN, period). */
  preamble?: string[][];
  sections: Section[];
  footnotes?: string[];
}

const sum = (rows: any[], f: (r: any) => number) => calc.r2(rows.reduce((a, r) => a + (Number(f(r)) || 0), 0));

function reportToCsv(r: Report): string[] {
  const out: string[] = [];
  for (const line of r.preamble || []) out.push(csvRow(line));
  if (r.preamble?.length) out.push('');
  const titled = r.sections.length > 1;
  r.sections.forEach((sec, i) => {
    if (titled) out.push(csvRow([sec.title]));
    out.push(csvRow(sec.columns.map(c => c.label)));
    for (const row of sec.rows) out.push(csvRow(sec.columns.map(c => row[c.key] ?? '')));
    if (sec.total) out.push(csvRow(sec.columns.map(c => sec.total![c.key] ?? '')));
    if (i < r.sections.length - 1) out.push('');
  });
  for (const f of r.footnotes || []) { out.push(''); out.push(csvRow([f])); }
  return out;
}

function deliver(req: Request, res: Response, r: Report, filename: string) {
  if (String(req.query.format || '').toLowerCase() === 'json') return res.json(r);
  sendCsv(res, filename, reportToCsv(r));
}

const docLabel = (t: any) => (t.doc_type === 'internal' ? 'Non-GST' : 'GST');
const partyOf = (r: any) => r.buyer.name || r.customer.name || '';
const gstinOf = (r: any) => String(r.buyer.gstin || r.customer.gstin || '').trim();

// ---------------------------------------------------------------- sales report
reportRouter.get('/reports/invoices', requireReports, async (req: Request, res: Response) => {
  try {
    const range = resolveRange(req.query as any);
    const loaded = await loadInvoices(range);
    // ?doc_type=tax_invoice | internal narrows the report to one kind of bill.
    const want = String(req.query.doc_type || '').toLowerCase();
    const rows = !want || want === 'all'
      ? loaded.rows
      : loaded.rows.filter(r => r.totals.doc_type === (['internal', 'non_gst'].includes(want) ? 'internal' : 'tax_invoice'));
    const live = rows.filter(r => r.status !== 'cancelled' && r.status !== 'draft');

    const columns: Col[] = [
      { key: 'type', label: 'Type' },
      { key: 'no', label: 'Invoice No', kind: 'mono' },
      { key: 'date', label: 'Invoice Date', kind: 'date' },
      { key: 'due', label: 'Due Date', kind: 'date' },
      { key: 'customer', label: 'Customer' },
      { key: 'gstin', label: 'GSTIN', kind: 'mono' },
      { key: 'city', label: 'City' },
      { key: 'state', label: 'State' },
      { key: 'lr', label: 'LR No(s)', kind: 'mono' },
      { key: 'lr_count', label: 'LR Count', kind: 'num' },
      { key: 'origin', label: 'Origin' },
      { key: 'dest', label: 'Destination' },
      { key: 'weight', label: 'Weight (Kg)', kind: 'num' },
      { key: 'rate', label: 'Rate/Kg', kind: 'num' },
      { key: 'freight', label: 'Freight', kind: 'money' },
      { key: 'extra', label: 'Additional Charges', kind: 'money' },
      { key: 'discount', label: 'Discount', kind: 'money' },
      { key: 'taxable', label: 'Taxable Value', kind: 'money' },
      { key: 'gst_type', label: 'GST Type' },
      { key: 'gst_rate', label: 'GST Rate %', kind: 'num' },
      { key: 'cgst', label: 'CGST', kind: 'money' },
      { key: 'sgst', label: 'SGST', kind: 'money' },
      { key: 'igst', label: 'IGST', kind: 'money' },
      { key: 'round', label: 'Round Off', kind: 'money' },
      { key: 'total', label: 'Grand Total', kind: 'money' },
      { key: 'paid', label: 'Paid', kind: 'money' },
      { key: 'balance', label: 'Balance', kind: 'money' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'cost', label: 'Cost', kind: 'money' },
      { key: 'input_gst', label: 'Input GST (credit)', kind: 'money' },
      { key: 'profit', label: 'Gross Profit', kind: 'money' },
      { key: 'margin', label: 'Margin %', kind: 'pct' },
    ];

    const report: Report = {
      key: 'invoices', title: 'Sales report', range,
      sections: [{
        id: 'sales', title: 'Sales', columns,
        rows: rows.map(r => {
          const { inv, totals: t } = r;
          return {
            type: docLabel(t), no: inv.invoice_no, date: inv.invoice_date, due: inv.due_date || '',
            customer: partyOf(r), gstin: gstinOf(r),
            city: r.buyer.city || r.customer.city || '', state: r.buyer.state || inv.place_of_supply || '',
            lr: inv.lr_no || '',
            lr_count: Array.isArray(inv.lr_items) && inv.lr_items.length ? inv.lr_items.length : (inv.lr_no ? 1 : 0),
            origin: inv.origin || '', dest: inv.destination || '',
            weight: inv.weight || 0, rate: inv.rate_kg || 0,
            freight: t.freight, extra: t.additional_total, discount: t.discount_amount, taxable: t.taxable_amount,
            gst_type: t.doc_type === 'internal' ? 'None' : t.gst_type === 'igst' ? 'IGST' : t.gst_type === 'exempt' ? 'Exempt' : 'CGST+SGST',
            gst_rate: t.gst_rate, cgst: t.cgst, sgst: t.sgst, igst: t.igst, round: t.round_off, total: t.grand_total,
            paid: r.paid, balance: r.balance, status: r.status,
            cost: t.total_cost ?? 'Not costed', input_gst: t.input_gst || '',
            profit: t.gross_profit ?? '', margin: t.margin_pct ?? '',
          };
        }),
        total: {
          type: 'TOTAL', no: `${live.length} bill(s)`,
          freight: sum(live, r => r.totals.freight), extra: sum(live, r => r.totals.additional_total),
          discount: sum(live, r => r.totals.discount_amount), taxable: sum(live, r => r.totals.taxable_amount),
          cgst: sum(live, r => r.totals.cgst), sgst: sum(live, r => r.totals.sgst), igst: sum(live, r => r.totals.igst),
          round: sum(live, r => r.totals.round_off), total: sum(live, r => r.totals.grand_total),
          paid: sum(live, r => r.paid), balance: sum(live, r => r.balance),
          cost: sum(live, r => r.totals.total_cost ?? 0), input_gst: sum(live, r => r.totals.input_gst || 0),
          profit: sum(live, r => r.totals.gross_profit ?? 0),
        },
      }],
      footnotes: rows.length > live.length ? ['Totals exclude draft and cancelled bills.'] : [],
    };
    deliver(req, res, report, `sales-report-${range.from}-to-${range.to}.csv`);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// ---------------------------------------------------------------- GST report
/**
 * GSTR-1 style output: a B2B section keyed by the recipient's GSTIN, a B2C
 * section, and a rate-wise summary. Allow-list: issued GST tax invoices only.
 * Internal (non-GST) bills, drafts and cancellations never reach this report,
 * and nothing in it mentions that non-GST bills exist.
 */
reportRouter.get('/reports/gst', requireReports, async (req: Request, res: Response) => {
  try {
    const range = resolveRange(req.query as any);
    const { rows } = await loadInvoices(range);
    const company = (await db.selectOne('company_settings')) || {};
    const live = rows.filter(r =>
      r.totals.doc_type === 'tax_invoice' && r.status !== 'cancelled' && r.status !== 'draft');
    if (live.some(r => calc.docType(r.inv) !== 'tax_invoice')) {
      throw new Error('Refusing to build the GST report: a non-GST bill reached it.');
    }

    const b2b = live.filter(r => gstinOf(r));
    const b2c = live.filter(r => !gstinOf(r));
    const pos = (r: any) => r.inv.place_of_supply || r.buyer.state || '';

    const byRate: Record<string, any> = {};
    for (const r of live) {
      const k = String(r.totals.gst_rate);
      byRate[k] ||= { rate: r.totals.gst_rate, count: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, gst: 0, total: 0 };
      const b = byRate[k];
      b.count += 1; b.taxable += r.totals.taxable_amount; b.cgst += r.totals.cgst; b.sgst += r.totals.sgst;
      b.igst += r.totals.igst; b.gst += r.totals.gst_amount; b.total += r.totals.grand_total;
    }
    const rates = Object.values(byRate).sort((a: any, b: any) => a.rate - b.rate)
      .map((b: any) => ({ ...b, taxable: calc.r2(b.taxable), cgst: calc.r2(b.cgst), sgst: calc.r2(b.sgst),
        igst: calc.r2(b.igst), gst: calc.r2(b.gst), total: calc.r2(b.total) }));

    const cancelled = rows.filter(r => r.totals.doc_type === 'tax_invoice' && r.status === 'cancelled').length;

    const report: Report = {
      key: 'gst', title: 'GST report', range,
      preamble: [
        [`GST Report - ${company.name || 'SHREE SANWARIYA LOGISTICS'}`],
        [`GSTIN: ${company.gstin || ''}`, `Period: ${range.label}`, `${range.from} to ${range.to}`],
      ],
      sections: [
        {
          id: 'b2b', title: 'B2B INVOICES', note: 'Registered recipients, keyed by their GSTIN',
          columns: [
            { key: 'gstin', label: 'GSTIN/UIN of Recipient', kind: 'mono' },
            { key: 'name', label: 'Receiver Name' },
            { key: 'no', label: 'Invoice Number', kind: 'mono' },
            { key: 'date', label: 'Invoice Date', kind: 'date' },
            { key: 'value', label: 'Invoice Value', kind: 'money' },
            { key: 'pos', label: 'Place Of Supply' },
            { key: 'rc', label: 'Reverse Charge' },
            { key: 'itype', label: 'Invoice Type' },
            { key: 'rate', label: 'Rate', kind: 'num' },
            { key: 'taxable', label: 'Taxable Value', kind: 'money' },
            { key: 'cess', label: 'Cess Amount', kind: 'money' },
            { key: 'cgst', label: 'CGST', kind: 'money' },
            { key: 'sgst', label: 'SGST', kind: 'money' },
            { key: 'igst', label: 'IGST', kind: 'money' },
          ],
          rows: b2b.map(r => ({
            gstin: gstinOf(r), name: partyOf(r), no: r.inv.invoice_no, date: r.inv.invoice_date,
            value: r.totals.grand_total, pos: pos(r), rc: 'N', itype: 'Regular', rate: r.totals.gst_rate,
            taxable: r.totals.taxable_amount, cess: 0, cgst: r.totals.cgst, sgst: r.totals.sgst, igst: r.totals.igst,
          })),
          total: {
            gstin: 'TOTAL', no: `${b2b.length} invoice(s)`, value: sum(b2b, r => r.totals.grand_total),
            taxable: sum(b2b, r => r.totals.taxable_amount), cess: 0,
            cgst: sum(b2b, r => r.totals.cgst), sgst: sum(b2b, r => r.totals.sgst), igst: sum(b2b, r => r.totals.igst),
          },
        },
        {
          id: 'b2c', title: 'B2C INVOICES (unregistered recipients)', note: 'Recipients without a GSTIN',
          columns: [
            { key: 'name', label: 'Receiver Name' },
            { key: 'no', label: 'Invoice Number', kind: 'mono' },
            { key: 'date', label: 'Invoice Date', kind: 'date' },
            { key: 'value', label: 'Invoice Value', kind: 'money' },
            { key: 'pos', label: 'Place Of Supply' },
            { key: 'rate', label: 'Rate', kind: 'num' },
            { key: 'taxable', label: 'Taxable Value', kind: 'money' },
            { key: 'cgst', label: 'CGST', kind: 'money' },
            { key: 'sgst', label: 'SGST', kind: 'money' },
            { key: 'igst', label: 'IGST', kind: 'money' },
          ],
          rows: b2c.map(r => ({
            name: partyOf(r), no: r.inv.invoice_no, date: r.inv.invoice_date, value: r.totals.grand_total,
            pos: pos(r), rate: r.totals.gst_rate, taxable: r.totals.taxable_amount,
            cgst: r.totals.cgst, sgst: r.totals.sgst, igst: r.totals.igst,
          })),
          total: {
            name: 'TOTAL', no: `${b2c.length} invoice(s)`, value: sum(b2c, r => r.totals.grand_total),
            taxable: sum(b2c, r => r.totals.taxable_amount),
            cgst: sum(b2c, r => r.totals.cgst), sgst: sum(b2c, r => r.totals.sgst), igst: sum(b2c, r => r.totals.igst),
          },
        },
        {
          id: 'rates', title: 'RATE-WISE SUMMARY', note: 'Tax grouped by GST rate',
          columns: [
            { key: 'rate', label: 'GST Rate %', kind: 'num' },
            { key: 'count', label: 'Invoices', kind: 'num' },
            { key: 'taxable', label: 'Taxable Value', kind: 'money' },
            { key: 'cgst', label: 'CGST', kind: 'money' },
            { key: 'sgst', label: 'SGST', kind: 'money' },
            { key: 'igst', label: 'IGST', kind: 'money' },
            { key: 'gst', label: 'Total GST', kind: 'money' },
            { key: 'total', label: 'Invoice Value', kind: 'money' },
          ],
          rows: rates,
          total: {
            rate: 'TOTAL', count: live.length, taxable: sum(rates, b => b.taxable), cgst: sum(rates, b => b.cgst),
            sgst: sum(rates, b => b.sgst), igst: sum(rates, b => b.igst), gst: sum(rates, b => b.gst),
            total: sum(rates, b => b.total),
          },
        },
      ],
      footnotes: cancelled > 0 ? [`${cancelled} cancelled invoice(s) excluded from this report.`] : [],
    };
    deliver(req, res, report, `gst-report-${range.from}-to-${range.to}.csv`);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// ---------------------------------------------------------------- payments
reportRouter.get('/reports/payments', requireModule('payments'), async (req: Request, res: Response) => {
  try {
    const range = resolveRange(req.query as any);
    const [payments, invoices, customers] = await Promise.all([
      db.select('payments', { order: 'payment_date.asc' }),
      db.select('invoices'),
      db.select('customers'),
    ]);
    const invMap = new Map<string, any>(invoices.map((i: any) => [i.id, i]));
    const custMap = new Map<string, any>(customers.map((c: any) => [c.id, c]));
    const inRange = payments.filter((p: any) => {
      const d = String(p.payment_date || p.created_at || '').slice(0, 10);
      return d >= range.from && d <= range.to;
    });

    const report: Report = {
      key: 'payments', title: 'Payments report', range,
      sections: [{
        id: 'payments', title: 'Payments received',
        columns: [
          { key: 'date', label: 'Payment Date', kind: 'date' },
          { key: 'customer', label: 'Customer' },
          { key: 'gstin', label: 'GSTIN', kind: 'mono' },
          { key: 'no', label: 'Invoice No', kind: 'mono' },
          { key: 'inv_date', label: 'Invoice Date', kind: 'date' },
          { key: 'inv_value', label: 'Invoice Value', kind: 'money' },
          { key: 'amount', label: 'Amount Received', kind: 'money' },
          { key: 'method', label: 'Method' },
          { key: 'ref', label: 'Reference', kind: 'mono' },
          { key: 'notes', label: 'Notes' },
        ],
        rows: inRange.map((p: any) => {
          const inv = invMap.get(p.invoice_id) || {};
          const cust = custMap.get(inv.customer_id) || {};
          const t = inv.id ? calc.compute(inv) : { grand_total: 0 };
          return {
            date: p.payment_date, customer: (inv.buyer || {}).name || cust.name || '',
            gstin: (inv.buyer || {}).gstin || cust.gstin || '', no: inv.invoice_no || '',
            inv_date: inv.invoice_date || '', inv_value: t.grand_total, amount: calc.num(p.amount),
            method: p.method || '', ref: p.reference || '', notes: p.notes || '',
          };
        }),
        total: { date: 'TOTAL', customer: `${inRange.length} receipt(s)`, amount: sum(inRange, (p: any) => calc.num(p.amount)) },
      }],
    };
    deliver(req, res, report, `payments-report-${range.from}-to-${range.to}.csv`);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// ---------------------------------------------------------------- outstanding
reportRouter.get('/reports/outstanding', requireReports, async (req: Request, res: Response) => {
  try {
    const range = resolveRange(req.query as any);
    const { rows } = await loadInvoices(range);
    const today = calc.todayIST();
    const pending = rows.filter(r => r.status !== 'cancelled' && r.status !== 'draft' && r.balance > 0.01);

    const report: Report = {
      key: 'outstanding', title: 'Outstanding report', range,
      sections: [{
        id: 'outstanding', title: 'Unpaid bills',
        columns: [
          { key: 'customer', label: 'Customer' },
          { key: 'gstin', label: 'GSTIN', kind: 'mono' },
          { key: 'phone', label: 'Phone', kind: 'mono' },
          { key: 'no', label: 'Invoice No', kind: 'mono' },
          { key: 'date', label: 'Invoice Date', kind: 'date' },
          { key: 'due', label: 'Due Date', kind: 'date' },
          { key: 'days', label: 'Days Overdue', kind: 'num' },
          { key: 'value', label: 'Invoice Value', kind: 'money' },
          { key: 'paid', label: 'Paid', kind: 'money' },
          { key: 'balance', label: 'Balance', kind: 'money' },
          { key: 'status', label: 'Status', kind: 'status' },
        ],
        rows: pending
          .map(r => {
            const due = String(r.inv.due_date || r.inv.invoice_date || '').slice(0, 10);
            const days = due && due < today
              ? Math.floor((new Date(today).getTime() - new Date(due).getTime()) / 86400000) : 0;
            return {
              customer: partyOf(r), gstin: gstinOf(r), phone: r.customer.phone || r.buyer.phone || '',
              no: r.inv.invoice_no, date: r.inv.invoice_date, due, days,
              value: r.totals.grand_total, paid: r.paid, balance: r.balance, status: r.status,
            };
          })
          .sort((a, b) => b.days - a.days),
        total: {
          customer: 'TOTAL', no: `${pending.length} bill(s)`,
          value: sum(pending, r => r.totals.grand_total), paid: sum(pending, r => r.paid), balance: sum(pending, r => r.balance),
        },
      }],
    };
    deliver(req, res, report, `outstanding-report-${range.from}-to-${range.to}.csv`);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// ---------------------------------------------------------------- profitability
/**
 * One row per LR (per trip), so profit can be read by lane and by vendor,
 * followed by bill-level costs such as commission. GST and non-GST bills both
 * appear, labelled; revenue is always the taxable value.
 */
reportRouter.get('/reports/profit', requireReports, async (req: Request, res: Response) => {
  try {
    const range = resolveRange(req.query as any);
    const { rows } = await loadInvoices(range);
    const live = rows.filter(r => r.status !== 'cancelled' && r.status !== 'draft');

    const out: Record<string, any>[] = [];
    for (const r of live) {
      const t = r.totals;
      const base = { type: docLabel(t), no: r.inv.invoice_no, date: r.inv.invoice_date, customer: partyOf(r) };
      const lines: any[] = t.lr_items.length ? t.lr_items : [null];
      lines.forEach((l, i) => {
        const first = i === 0;
        out.push({
          ...base,
          lr: l?.lr_no || r.inv.lr_no || '', origin: l?.origin || r.inv.origin || '',
          dest: l?.destination || r.inv.destination || '', vendor: l?.vendor || '',
          lr_freight: l ? l.amount : '', lr_cost: l && l.cost !== null ? l.cost : '',
          lr_gst: l && l.cost_gst ? l.cost_gst : '',
          credit: l && l.cost_gst ? (t.doc_type === 'internal' ? 'No (non-GST bill)' : l.itc ? 'Yes' : 'No') : '',
          revenue: first ? t.taxable_amount : '', cost: first ? (t.total_cost ?? 'Not costed') : '',
          profit: first ? (t.gross_profit ?? '') : '', margin: first ? (t.margin_pct ?? '') : '',
        });
      });
      for (const o of t.other_costs) out.push({
        ...base, vendor: o.label, lr_cost: o.amount, lr_gst: o.gst || '',
        credit: o.gst ? (t.doc_type === 'internal' ? 'No (non-GST bill)' : o.itc ? 'Yes' : 'No') : '',
      });
    }

    const costed = live.filter(r => r.totals.total_cost !== null);
    const revenue = sum(costed, r => r.totals.taxable_amount);
    const cost = sum(costed, r => r.totals.total_cost || 0);
    const uncosted = live.length - costed.length;

    const report: Report = {
      key: 'profit', title: 'Profitability report', range,
      sections: [{
        id: 'profit', title: 'Profit by trip',
        columns: [
          { key: 'type', label: 'Type' },
          { key: 'no', label: 'Invoice No', kind: 'mono' },
          { key: 'date', label: 'Invoice Date', kind: 'date' },
          { key: 'customer', label: 'Customer' },
          { key: 'lr', label: 'LR No', kind: 'mono' },
          { key: 'origin', label: 'Origin' },
          { key: 'dest', label: 'Destination' },
          { key: 'vendor', label: 'Vendor' },
          { key: 'lr_freight', label: 'LR Freight', kind: 'money' },
          { key: 'lr_cost', label: 'LR Cost', kind: 'money' },
          { key: 'lr_gst', label: 'Vendor GST', kind: 'money' },
          { key: 'credit', label: 'Input Credit' },
          { key: 'revenue', label: 'Bill Revenue (taxable)', kind: 'money' },
          { key: 'cost', label: 'Bill Cost', kind: 'money' },
          { key: 'profit', label: 'Bill Gross Profit', kind: 'money' },
          { key: 'margin', label: 'Margin %', kind: 'pct' },
        ],
        rows: out,
        total: {
          type: 'TOTAL', no: `${costed.length} costed bill(s)`, revenue, cost,
          profit: calc.r2(revenue - cost), margin: revenue > 0 ? calc.r2(((revenue - cost) / revenue) * 100) : '',
        },
      }],
      footnotes: uncosted > 0 ? [`${uncosted} bill(s) have no cost entered and are left out of the totals.`] : [],
    };
    deliver(req, res, report, `profit-report-${range.from}-to-${range.to}.csv`);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});
