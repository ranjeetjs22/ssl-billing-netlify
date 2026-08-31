import { Router, Request, Response } from 'express';
import * as db from '../db.js';
import * as calc from '../calc.js';
import { authMiddleware, requireModule } from '../auth.js';

export const paymentRouter = Router();
paymentRouter.use(authMiddleware);

export const METHODS = ['Bank Transfer', 'UPI', 'Cash', 'Cheque', 'Other'];

// Accept the many ways people label a payment mode and map to the canonical METHODS list.
const METHOD_ALIASES: Record<string, string> = {
  'bank transfer': 'Bank Transfer',
  'bank': 'Bank Transfer',
  'neft': 'Bank Transfer',
  'rtgs': 'Bank Transfer',
  'imps': 'Bank Transfer',
  'neft / rtgs': 'Bank Transfer',
  'neft/rtgs': 'Bank Transfer',
  'neft / rtgs / imps': 'Bank Transfer',
  'net banking': 'Bank Transfer',
  'netbanking': 'Bank Transfer',
  'online': 'Bank Transfer',
  'wire': 'Bank Transfer',
  'upi': 'UPI',
  'upi / qr': 'UPI',
  'upi/qr': 'UPI',
  'qr': 'UPI',
  'gpay': 'UPI',
  'google pay': 'UPI',
  'phonepe': 'UPI',
  'paytm': 'UPI',
  'bhim': 'UPI',
  'cash': 'Cash',
  'cheque': 'Cheque',
  'check': 'Cheque',
  'chq': 'Cheque',
  'dd': 'Cheque',
  'demand draft': 'Cheque',
  'other': 'Other',
  'others': 'Other',
};

/** Returns the canonical method name, or null when nothing usable was supplied. */
export function normaliseMethod(raw: any): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const key = s.toLowerCase();
  if (METHOD_ALIASES[key]) return METHOD_ALIASES[key];
  const exact = METHODS.find(m => m.toLowerCase() === key);
  if (exact) return exact;
  if (/neft|rtgs|imps|bank|transfer|net ?banking/.test(key)) return 'Bank Transfer';
  if (/upi|qr|gpay|phonepe|paytm/.test(key)) return 'UPI';
  if (/cheque|check|draft|\bdd\b/.test(key)) return 'Cheque';
  if (/cash/.test(key)) return 'Cash';
  return 'Other';
}

async function resolveBankLabel(body: any): Promise<string> {
  if (body.bank) return String(body.bank);
  if (body.bank_account_id) {
    try {
      const acct = await db.selectOne('bank_accounts', { id: `eq.${body.bank_account_id}` });
      if (acct) {
        const last4 = String(acct.account_number || '').slice(-4);
        return `${acct.bank_name || 'Bank'}${last4 ? ` (A/C ••${last4})` : ''}`;
      }
    } catch {
      // non-fatal
    }
  }
  return '';
}

function buildNotes(body: any, bankLabel: string, rawMethod: any, method: string): string {
  const parts: string[] = [];
  if (bankLabel) parts.push(`Bank: ${bankLabel}`);
  const rawStr = String(rawMethod ?? '').trim();
  if (method === 'Other' && rawStr && rawStr.toLowerCase() !== 'other') parts.push(`Mode: ${rawStr}`);
  if (body.notes) parts.push(String(body.notes));
  return parts.join(' · ');
}

async function paidTotal(invoiceId: string, excludePaymentId?: string): Promise<number> {
  const rows = await db.select('payments', { invoice_id: `eq.${invoiceId}` });
  const filtered = excludePaymentId ? rows.filter((r: any) => r.id !== excludePaymentId) : rows;
  return calc.r2(filtered.reduce((acc: number, r: any) => acc + calc.num(r.amount), 0));
}

async function syncInvoiceStatus(invoiceId: string) {
  const inv = await db.selectOne('invoices', { id: `eq.${invoiceId}` });
  if (!inv) return;
  const status = String(inv.status || '').toLowerCase();
  if (['cancelled', 'canceled', 'draft'].includes(status)) return;

  const totals = calc.compute(inv);
  const paid = await paidTotal(invoiceId);
  const target = totals.grand_total > 0 && paid >= totals.grand_total - 1 ? 'paid' : 'pending';

  if (target !== status) {
    await db.update('invoices', { id: `eq.${invoiceId}` }, {
      status: target,
      updated_at: new Date().toISOString(),
    });
  }
}

async function enrichPayments(payments: any[]) {
  const [invoices, customers] = await Promise.all([db.select('invoices'), db.select('customers')]);
  const invMap = new Map<string, any>(invoices.map((i: any) => [i.id, i]));
  const custMap = new Map<string, any>(customers.map((c: any) => [c.id, c]));

  return payments.map((p: any) => {
    const inv: any = invMap.get(p.invoice_id) || {};
    const cust: any = custMap.get(inv.customer_id) || {};
    const t = inv.id ? calc.compute(inv) : { grand_total: 0 };
    return {
      ...p,
      invoice_no: inv.invoice_no,
      invoice_date: inv.invoice_date,
      invoice_total: t.grand_total,
      customer_id: inv.customer_id,
      customer_name: (inv.buyer || {}).name || cust.name || 'Unknown',
    };
  });
}

paymentRouter.get('/payments/methods', requireModule('payments'), (_req: Request, res: Response) => {
  res.json({ methods: METHODS });
});

paymentRouter.get('/payments/open-invoices', requireModule('payments'), async (req: Request, res: Response) => {
  try {
    const customerId = req.query.customer_id as string;
    const [invoicesRaw, payments] = await Promise.all([
      db.select('invoices', { order: 'invoice_date.desc' }),
      db.select('payments'),
    ]);
    let invoices = invoicesRaw;
    if (customerId) {
      invoices = invoices.filter((i: any) => i.customer_id === customerId);
    }
    const paidMap: Record<string, number> = {};
    for (const p of payments) {
      paidMap[p.invoice_id] = (paidMap[p.invoice_id] || 0) + calc.num(p.amount);
    }

    const out: any[] = [];
    for (const inv of invoices) {
      const status = String(inv.status || '').toLowerCase();
      if (['cancelled', 'canceled', 'draft'].includes(status)) continue;

      const t = calc.compute(inv);
      const paid = calc.r2(paidMap[inv.id] || 0);
      const balance = calc.r2(t.grand_total - paid);

      if (balance <= 0.5) continue;

      out.push({
        id: inv.id,
        invoice_no: inv.invoice_no,
        invoice_date: inv.invoice_date,
        due_date: inv.due_date,
        customer_id: inv.customer_id,
        customer_name: (inv.buyer || {}).name || 'Customer',
        grand_total: t.grand_total,
        paid,
        balance,
        display_status: calc.displayStatus(inv, paid, t),
      });
    }

    res.json({
      count: out.length,
      total_balance: calc.r2(out.reduce((acc, o) => acc + o.balance, 0)),
      items: out,
    });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

paymentRouter.get('/payments', requireModule('payments'), async (req: Request, res: Response) => {
  try {
    const invoiceId = req.query.invoice_id as string;
    const customerId = req.query.customer_id as string;
    const method = req.query.method as string;
    const fromDate = req.query.from_date as string;
    const toDate = req.query.to_date as string;
    const search = req.query.search as string;
    const page = parseInt(req.query.page as string, 10) || 1;
    const pageSize = parseInt(req.query.page_size as string, 10) || 20;

    let rows = await db.select('payments', { order: 'payment_date.desc' });
    if (invoiceId) {
      rows = rows.filter((r: any) => r.invoice_id === invoiceId);
    }
    if (method) {
      rows = rows.filter((r: any) => r.method === method);
    }
    if (fromDate) {
      rows = rows.filter((r: any) => (r.payment_date || '') >= fromDate);
    }
    if (toDate) {
      rows = rows.filter((r: any) => (r.payment_date || '') <= toDate);
    }

    let items = await enrichPayments(rows);
    if (customerId) {
      items = items.filter((i: any) => i.customer_id === customerId);
    }
    if (search) {
      const s = search.toLowerCase();
      items = items.filter((i: any) =>
        (i.invoice_no || '').toLowerCase().includes(s) ||
        (i.reference || '').toLowerCase().includes(s) ||
        (i.customer_name || '').toLowerCase().includes(s)
      );
    }

    const summary = {
      count: items.length,
      received: calc.r2(items.reduce((acc: number, i: any) => acc + calc.num(i.amount), 0)),
    };

    const start = Math.max(0, (page - 1) * pageSize);
    res.json({
      total: items.length,
      page,
      page_size: pageSize,
      summary,
      items: items.slice(start, start + pageSize),
    });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

paymentRouter.get('/payments/export', requireModule('payments'), async (_req: Request, res: Response) => {
  try {
    const rows = await db.select('payments', { order: 'payment_date.desc' });
    const items = await enrichPayments(rows);

    const headers = ['Payment Date', 'Customer', 'Invoice No', 'Invoice Total', 'Amount', 'Method', 'Reference', 'Notes'];
    let csv = headers.join(',') + '\n';
    for (const i of items) {
      const line = [
        i.payment_date,
        `"${String(i.customer_name || '').replace(/"/g, '""')}"`,
        i.invoice_no,
        i.invoice_total,
        i.amount,
        i.method,
        `"${String(i.reference || '').replace(/"/g, '""')}"`,
        `"${String(i.notes || '').replace(/"/g, '""')}"`,
      ];
      csv += line.join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=payments.csv');
    res.send(csv);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

paymentRouter.post('/payments', requireModule('payments'), async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const inv = await db.selectOne('invoices', { id: `eq.${body.invoice_id}` });
    if (!inv) {
      return res.status(404).json({ detail: 'That invoice could not be found.' });
    }

    const status = String(inv.status || '').toLowerCase();
    if (['cancelled', 'canceled'].includes(status)) {
      return res.status(400).json({ detail: 'This invoice is cancelled — a payment cannot be recorded against it.' });
    }
    if (status === 'draft') {
      return res.status(400).json({ detail: 'Please issue this draft invoice before recording a payment.' });
    }
    const method = normaliseMethod(body.method);
    if (!method) {
      return res.status(400).json({ detail: `Please select a payment method (${METHODS.join(', ')}).` });
    }

    const amount = calc.r2(calc.num(body.amount));
    if (amount <= 0) {
      return res.status(400).json({ detail: 'Payment amount must be greater than 0.' });
    }

    const totals = calc.compute(inv);
    const already = await paidTotal(inv.id);
    const balance = calc.r2(totals.grand_total - already);

    if (balance <= 0) {
      return res.status(400).json({ detail: 'This invoice is already fully paid.' });
    }
    if (amount > balance + 0.5) {
      return res.status(400).json({ detail: `The amount is more than the outstanding balance of Rs. ${balance.toFixed(2)}.` });
    }

    const bankLabel = await resolveBankLabel(body);
    const notes = buildNotes(body, bankLabel, body.method, method);

    const paymentDate = String(body.payment_date || new Date().toISOString()).slice(0, 10);
    const user = (req as any).user;
    const userId = user?.id || '5fecd6f5-7c32-488c-b1bc-b2a5f80b6927';

    const created = await db.insert('payments', {
      user_id: userId,
      invoice_id: body.invoice_id,
      payment_date: paymentDate,
      amount,
      method,
      reference: body.reference || '',
      notes,
      created_at: new Date().toISOString(),
    });

    await syncInvoiceStatus(inv.id);

    if (user && user.email) {
      await db.insert('audit_logs', {
        user_email: user.email,
        action: 'Payment recorded',
        entity: 'payments',
        entity_id: created.id,
        new_value: { invoice_no: inv.invoice_no, amount: created.amount, method: created.method },
        created_at: new Date().toISOString(),
      });
    }

    const newPaid = await paidTotal(inv.id);
    const [enriched] = await enrichPayments([created]);

    res.status(201).json({
      ...enriched,
      invoice_balance: calc.r2(Math.max(0, totals.grand_total - newPaid)),
      invoice_paid: newPaid,
    });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

paymentRouter.put('/payments/:payment_id', requireModule('payments'), async (req: Request, res: Response) => {
  try {
    const payId = req.params.payment_id;
    const old = await db.selectOne('payments', { id: `eq.${payId}` });
    if (!old) {
      return res.status(404).json({ detail: 'That payment could not be found.' });
    }

    const body = req.body;
    const inv = await db.selectOne('invoices', { id: `eq.${body.invoice_id}` });
    if (!inv) {
      return res.status(404).json({ detail: 'That invoice could not be found.' });
    }

    const method = normaliseMethod(body.method ?? old.method) || 'Other';
    const amount = calc.r2(calc.num(body.amount ?? old.amount));
    if (amount <= 0) {
      return res.status(400).json({ detail: 'Payment amount must be greater than 0.' });
    }

    const totals = calc.compute(inv);
    const others = await paidTotal(inv.id, payId);
    const room = calc.r2(totals.grand_total - others);

    if (amount > room + 0.5) {
      return res.status(400).json({ detail: `The amount is more than the outstanding balance of Rs. ${room.toFixed(2)}.` });
    }

    const bankLabel = await resolveBankLabel(body);
    const notes = body.notes !== undefined || bankLabel
      ? buildNotes(body, bankLabel, body.method, method)
      : (old.notes || '');

    const updated = await db.update('payments', { id: `eq.${payId}` }, {
      invoice_id: body.invoice_id,
      payment_date: String(body.payment_date || old.payment_date || new Date().toISOString()).slice(0, 10),
      amount,
      method,
      reference: body.reference ?? old.reference ?? '',
      notes,
    });

    if (old.invoice_id !== body.invoice_id) {
      await syncInvoiceStatus(old.invoice_id);
    }
    await syncInvoiceStatus(inv.id);

    const [enriched] = await enrichPayments([updated]);
    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

paymentRouter.delete('/payments/:payment_id', requireModule('payments'), async (req: Request, res: Response) => {
  try {
    const payId = req.params.payment_id;
    const old = await db.selectOne('payments', { id: `eq.${payId}` });
    if (!old) {
      return res.status(404).json({ detail: 'That payment could not be found.' });
    }

    await db.remove('payments', { id: `eq.${payId}` });
    await syncInvoiceStatus(old.invoice_id);

    const user = (req as any).user;
    await db.insert('audit_logs', {
      user_email: user.email,
      action: 'Payment deleted',
      entity: 'payments',
      entity_id: payId,
      old_value: { amount: old.amount, invoice_id: old.invoice_id },
      created_at: new Date().toISOString(),
    });

    res.json({ message: 'Payment removed and the invoice balance has been updated.' });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});
