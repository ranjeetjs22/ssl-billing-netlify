import { Router, Request, Response } from 'express';
import * as db from '../db.js';
import * as calc from '../calc.js';
import { authMiddleware, requireModule } from '../auth.js';

export const customerRouter = Router();
customerRouter.use(authMiddleware);

async function logAudit(userEmail: string, action: string, entityId: string, oldVal: any, newVal: any) {
  try {
    await db.insert('audit_logs', {
      user_email: userEmail,
      action,
      entity: 'customers',
      entity_id: entityId,
      old_value: oldVal,
      new_value: newVal,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('audit log failed', e);
  }
}

// Human-friendly labels for fields that may not exist as columns in an older Supabase schema.
const FOLDABLE_FIELDS: Record<string, string> = {
  contact_person: 'Contact Person',
  whatsapp: 'WhatsApp',
  shipping_address: 'Shipping Address',
  credit_limit: 'Credit Limit',
};

/**
 * When the DB schema lacks a column (see db.insertEx), keep the information anyway by
 * appending it to `notes`, and echo the original values back so the UI stays consistent.
 */
async function preserveDroppedFields(table: string, row: any, data: Record<string, any>, dropped: string[]) {
  if (!row || dropped.length === 0) return row;

  const lines: string[] = [];
  for (const col of dropped) {
    const val = data[col];
    if (val === undefined || val === null || String(val).trim() === '' || Number(val) === 0 && col === 'credit_limit') continue;
    const label = FOLDABLE_FIELDS[col];
    if (label) lines.push(`${label}: ${String(val).trim()}`);
  }

  let merged = { ...row };
  for (const col of dropped) {
    if (data[col] !== undefined) merged[col] = data[col];
  }

  if (lines.length > 0 && !dropped.includes('notes')) {
    const existing = String(row.notes || '').trim();
    const missingLines = lines.filter(l => !existing.includes(l));
    if (missingLines.length > 0) {
      const notes = [existing, ...missingLines].filter(Boolean).join('\n');
      try {
        const updated = await db.update(table, { id: `eq.${row.id}` }, { notes });
        if (updated) merged = { ...merged, ...updated, notes };
      } catch (e) {
        console.warn(`[Customers] Could not fold dropped fields into notes:`, (e as Error).message);
      }
    }
  }
  return merged;
}

customerRouter.get('/customers', requireModule('customers'), async (req: Request, res: Response) => {
  try {
    const search = (req.query.search as string || '').trim().toLowerCase();
    const active = req.query.active !== undefined ? req.query.active === 'true' : undefined;
    const filter = req.query.filter as string; // 'all' | 'outstanding' | 'zero_balance' | 'overdue'
    const sort = (req.query.sort as string) || 'name';
    const order = (req.query.order as string) || 'asc';
    const page = parseInt(req.query.page as string, 10) || 1;
    const pageSize = parseInt(req.query.page_size as string, 10) || 50;

    // Fetch customers, invoices and payments together to compute exact, live financial metrics
    const [rowsRaw, allInvoices, allPayments] = await Promise.all([
      db.select('customers', {}),
      db.select('invoices', {}),
      db.select('payments', {}),
    ]);
    let rows = rowsRaw;
    if (active !== undefined) {
      rows = rows.filter((r: any) => Boolean(r.is_active ?? true) === active);
    }

    // Build paid map by invoice_id
    const paidByInvoice: Record<string, number> = {};
    for (const p of allPayments) {
      paidByInvoice[p.invoice_id] = (paidByInvoice[p.invoice_id] || 0) + calc.num(p.amount);
    }

    const todayStr = new Date().toISOString().slice(0, 10);

    // Compute metrics for each customer
    const customerStats: Record<string, {
      total_invoiced: number;
      total_paid: number;
      outstanding: number;
      invoice_count: number;
      pending_invoices_count: number;
      overdue_amount: number;
      overdue_invoices_count: number;
      last_invoice_date?: string;
      last_payment_date?: string;
    }> = {};

    for (const inv of allInvoices) {
      const custId = inv.customer_id;
      if (!custId) continue;
      if (!customerStats[custId]) {
        customerStats[custId] = {
          total_invoiced: 0,
          total_paid: 0,
          outstanding: 0,
          invoice_count: 0,
          pending_invoices_count: 0,
          overdue_amount: 0,
          overdue_invoices_count: 0,
        };
      }

      const t = calc.compute(inv);
      const paid = paidByInvoice[inv.id] || 0;
      const status = calc.displayStatus(inv, paid, t);

      if (status !== 'cancelled') {
        customerStats[custId].total_invoiced += t.grand_total;
        customerStats[custId].invoice_count += 1;
        const balance = Math.max(0, t.grand_total - paid);
        customerStats[custId].outstanding += balance;

        if (balance > 0.01) {
          customerStats[custId].pending_invoices_count += 1;
          const dueDate = inv.due_date || inv.invoice_date;
          if (dueDate && dueDate < todayStr) {
            customerStats[custId].overdue_amount += balance;
            customerStats[custId].overdue_invoices_count += 1;
          }
        }

        if (!customerStats[custId].last_invoice_date || (inv.invoice_date && inv.invoice_date > customerStats[custId].last_invoice_date!)) {
          customerStats[custId].last_invoice_date = inv.invoice_date;
        }
      }
    }

    for (const p of allPayments) {
      // Find invoice customer if not directly on payment
      let custId = p.customer_id;
      if (!custId && p.invoice_id) {
        const inv = allInvoices.find((i: any) => i.id === p.invoice_id);
        if (inv) custId = inv.customer_id;
      }
      if (custId) {
        if (!customerStats[custId]) {
          customerStats[custId] = {
            total_invoiced: 0,
            total_paid: 0,
            outstanding: 0,
            invoice_count: 0,
            pending_invoices_count: 0,
            overdue_amount: 0,
            overdue_invoices_count: 0,
          };
        }
        customerStats[custId].total_paid += calc.num(p.amount);
        const pDate = p.payment_date || (p.created_at || '').slice(0, 10);
        if (pDate && (!customerStats[custId].last_payment_date || pDate > customerStats[custId].last_payment_date!)) {
          customerStats[custId].last_payment_date = pDate;
        }
      }
    }

    // Attach calculated financial values to each customer row
    let enriched = rows.map((c: any) => {
      const stats = customerStats[c.id] || {
        total_invoiced: 0,
        total_paid: 0,
        outstanding: 0,
        invoice_count: 0,
        pending_invoices_count: 0,
        overdue_amount: 0,
        overdue_invoices_count: 0,
      };

      const outstandingVal = calc.r2(stats.outstanding);
      return {
        ...c,
        total_invoiced: calc.r2(stats.total_invoiced),
        total_paid: calc.r2(stats.total_paid),
        outstanding: outstandingVal,
        balance: outstandingVal, // for backwards-compatibility
        invoice_count: stats.invoice_count,
        pending_invoices_count: stats.pending_invoices_count,
        overdue_amount: calc.r2(stats.overdue_amount),
        overdue_invoices_count: stats.overdue_invoices_count,
        last_invoice_date: stats.last_invoice_date,
        last_payment_date: stats.last_payment_date,
      };
    });

    // Global summary metrics
    const summary = {
      total_customers: enriched.length,
      total_outstanding: calc.r2(enriched.reduce((acc: number, c: any) => acc + (c.outstanding || 0), 0)),
      total_invoiced: calc.r2(enriched.reduce((acc: number, c: any) => acc + (c.total_invoiced || 0), 0)),
      total_paid: calc.r2(enriched.reduce((acc: number, c: any) => acc + (c.total_paid || 0), 0)),
      customers_with_outstanding: enriched.filter((c: any) => (c.outstanding || 0) > 0.01).length,
      total_overdue: calc.r2(enriched.reduce((acc: number, c: any) => acc + (c.overdue_amount || 0), 0)),
    };

    // Filter by search query
    if (search) {
      enriched = enriched.filter((c: any) => {
        const str = `${c.name || ''} ${c.city || ''} ${c.state || ''} ${c.gstin || ''} ${c.phone || ''} ${c.contact_person || ''}`.toLowerCase();
        return str.includes(search);
      });
    }

    // Filter by status tab
    if (filter === 'outstanding') {
      enriched = enriched.filter((c: any) => (c.outstanding || 0) > 0.01);
    } else if (filter === 'zero_balance') {
      enriched = enriched.filter((c: any) => (c.outstanding || 0) <= 0.01);
    } else if (filter === 'overdue') {
      enriched = enriched.filter((c: any) => (c.overdue_amount || 0) > 0.01);
    }

    // Sorting
    enriched.sort((a: any, b: any) => {
      let valA = a[sort];
      let valB = b[sort];
      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();
      if (valA === undefined || valA === null) valA = '';
      if (valB === undefined || valB === null) valB = '';

      if (order === 'desc') {
        return valA < valB ? 1 : valA > valB ? -1 : 0;
      }
      return valA > valB ? 1 : valA < valB ? -1 : 0;
    });

    const total = enriched.length;
    const start = Math.max(0, (page - 1) * pageSize);
    const items = enriched.slice(start, start + pageSize);

    res.json({
      total,
      page,
      page_size: pageSize,
      items,
      summary,
    });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

customerRouter.get('/customers/export', requireModule('customers'), async (_req: Request, res: Response) => {
  try {
    const rows = await db.select('customers', { order: 'name.asc' });
    const cols = ['name', 'gstin', 'pan', 'phone', 'whatsapp', 'email', 'address', 'shipping_address', 'city', 'state', 'pin', 'payment_terms', 'credit_days', 'is_active'];
    
    let csv = cols.map(c => c.replace(/_/g, ' ').toUpperCase()).join(',') + '\n';
    for (const r of rows) {
      csv += cols.map(c => `"${String(r[c] || '').replace(/"/g, '""')}"`).join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=customers.csv');
    res.send(csv);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Helper function to build Customer Statement & Ledger with date/month filtering
async function buildCustomerStatement(custId: string, query: Record<string, any>) {
  const [cust, allInvoices, allPayments] = await Promise.all([
    db.selectOne('customers', { id: `eq.${custId}` }),
    db.select('invoices', { customer_id: `eq.${custId}`, order: 'invoice_date.asc' }),
    db.select('payments', { order: 'payment_date.asc' }),
  ]);
  if (!cust) return null;

  const month = query.month as string; // '2026-08'
  let startDate = query.start_date as string;
  let endDate = query.end_date as string;

  if (month && month !== 'all') {
    const [yr, mo] = month.split('-');
    const year = parseInt(yr, 10);
    const m = parseInt(mo, 10);
    startDate = `${month}-01`;
    const lastDay = new Date(year, m, 0).getDate();
    endDate = `${month}-${String(lastDay).padStart(2, '0')}`;
  }

  const custPayments = allPayments.filter((p: any) => {
    if (p.customer_id === custId) return true;
    const inv = allInvoices.find((i: any) => i.id === p.invoice_id);
    return Boolean(inv);
  });

  const paidMap: Record<string, number> = {};
  for (const p of custPayments) {
    paidMap[p.invoice_id] = (paidMap[p.invoice_id] || 0) + calc.num(p.amount);
  }

  // Compute opening balance prior to startDate
  let openingBalance = 0;
  let openingInvoiced = 0;
  let openingReceived = 0;

  if (startDate) {
    for (const inv of allInvoices) {
      if (inv.invoice_date && inv.invoice_date < startDate) {
        const t = calc.compute(inv);
        if (inv.status !== 'cancelled') {
          openingInvoiced += t.grand_total;
        }
      }
    }

    for (const p of custPayments) {
      const pDate = p.payment_date || (p.created_at || '').slice(0, 10);
      if (pDate && pDate < startDate) {
        openingReceived += calc.num(p.amount);
      }
    }

    openingBalance = calc.r2(openingInvoiced - openingReceived);
  }

  // Filter period invoices & payments
  const periodInvoices = allInvoices.filter((inv: any) => {
    if (startDate && inv.invoice_date < startDate) return false;
    if (endDate && inv.invoice_date > endDate) return false;
    return true;
  });

  const periodPayments = custPayments.filter((p: any) => {
    const pDate = p.payment_date || (p.created_at || '').slice(0, 10);
    if (startDate && pDate < startDate) return false;
    if (endDate && pDate > endDate) return false;
    return true;
  });

  let periodInvoiced = 0;
  let periodTaxable = 0;
  let periodGst = 0;
  let periodReceived = 0;
  let totalOverallOutstanding = 0;
  let periodOverdue = 0;
  const todayStr = new Date().toISOString().slice(0, 10);

  // Process all invoices for total overall outstanding
  for (const inv of allInvoices) {
    const t = calc.compute(inv);
    const paid = paidMap[inv.id] || 0;
    const status = calc.displayStatus(inv, paid, t);
    if (status !== 'cancelled') {
      const balance = Math.max(0, t.grand_total - paid);
      totalOverallOutstanding += balance;
    }
  }

  const enrichedInvoices: any[] = [];
  const ledger: any[] = [];

  // Add Opening Balance to Ledger if filtered by date
  if (startDate && (openingBalance !== 0 || month)) {
    ledger.push({
      date: startDate,
      type: 'opening',
      particulars: 'Opening Balance (Brought Forward)',
      debit: openingBalance > 0 ? openingBalance : 0,
      credit: openingBalance < 0 ? Math.abs(openingBalance) : 0,
      balance: openingBalance,
    });
  }

  for (const inv of periodInvoices) {
    const t = calc.compute(inv);
    const paid = paidMap[inv.id] || 0;
    const status = calc.displayStatus(inv, paid, t);
    const balance = Math.max(0, t.grand_total - paid);

    if (status !== 'cancelled') {
      periodInvoiced += t.grand_total;
      periodTaxable += t.taxable_amount;
      periodGst += t.gst_amount;

      const dueDate = inv.due_date || inv.invoice_date;
      if (balance > 0.01 && dueDate && dueDate < todayStr) {
        periodOverdue += balance;
      }

      // Ledger entry for invoice
      const routeStr = (inv.origin && inv.destination) ? ` [${inv.origin} → ${inv.destination}]` : '';
      const lrStr = inv.lr_no ? ` · LR #${inv.lr_no}` : '';
      ledger.push({
        date: inv.invoice_date,
        type: 'invoice',
        particulars: `Tax Invoice #${inv.invoice_no}${lrStr}${routeStr}`,
        reference_no: inv.invoice_no,
        lr_no: inv.lr_no,
        vehicle_no: inv.vehicle_no,
        route: (inv.origin && inv.destination) ? `${inv.origin} - ${inv.destination}` : undefined,
        debit: t.grand_total,
        credit: 0,
      });
    }

    enrichedInvoices.push({
      id: inv.id,
      invoice_no: inv.invoice_no,
      invoice_date: inv.invoice_date,
      lr_no: inv.lr_no,
      vehicle_no: inv.vehicle_no,
      origin: inv.origin,
      destination: inv.destination,
      weight: inv.weight,
      rate_kg: inv.rate_kg,
      due_date: inv.due_date,
      totals: t,
      taxable_amount: t.taxable_amount,
      gst_amount: t.gst_amount,
      grand_total: t.grand_total,
      paid: calc.r2(paid),
      balance: calc.r2(balance),
      status,
      display_status: status,
    });
  }

  for (const p of periodPayments) {
    const pAmt = calc.num(p.amount);
    periodReceived += pAmt;
    const pDate = p.payment_date || (p.created_at || '').slice(0, 10);
    const refStr = p.reference ? ` · Ref: ${p.reference}` : '';
    const invStr = p.invoice_no ? ` · Inv: ${p.invoice_no}` : '';

    ledger.push({
      date: pDate,
      type: 'payment',
      particulars: `Payment Received (${p.method || 'Bank Transfer'}${refStr}${invStr})`,
      reference_no: p.reference,
      debit: 0,
      credit: pAmt,
    });
  }

  // Sort ledger chronologically (with opening balance first on matching dates)
  ledger.sort((a, b) => {
    if (a.date === b.date) {
      if (a.type === 'opening') return -1;
      if (b.type === 'opening') return 1;
      if (a.type === 'invoice' && b.type === 'payment') return -1;
      if (a.type === 'payment' && b.type === 'invoice') return 1;
      return 0;
    }
    return (a.date || '').localeCompare(b.date || '');
  });

  // Compute running balance
  let runningBalance = 0;
  for (const row of ledger) {
    if (row.type === 'opening') {
      runningBalance = row.balance;
    } else {
      runningBalance += (row.debit || 0) - (row.credit || 0);
      row.balance = calc.r2(runningBalance);
    }
  }

  const closingBalance = calc.r2(openingBalance + periodInvoiced - periodReceived);

  // Period label
  let periodLabel = 'All Time Statement';
  if (month && month !== 'all') {
    const [yr, mo] = month.split('-');
    const dateObj = new Date(parseInt(yr, 10), parseInt(mo, 10) - 1, 1);
    periodLabel = dateObj.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  } else if (startDate && endDate) {
    periodLabel = `${startDate} to ${endDate}`;
  }

  const summary = {
    invoice_count: enrichedInvoices.length,
    opening_balance: calc.r2(openingBalance),
    period_invoiced: calc.r2(periodInvoiced),
    period_taxable: calc.r2(periodTaxable),
    period_gst: calc.r2(periodGst),
    period_received: calc.r2(periodReceived),
    closing_balance: closingBalance,
    total_overall_outstanding: calc.r2(totalOverallOutstanding),
    overdue_amount: calc.r2(periodOverdue),
    revenue: calc.r2(periodInvoiced),
    taxable: calc.r2(periodTaxable),
    gst: calc.r2(periodGst),
    received: calc.r2(periodReceived),
    outstanding: closingBalance,
  };

  return {
    customer: {
      ...cust,
      balance: calc.r2(totalOverallOutstanding),
      outstanding: calc.r2(totalOverallOutstanding),
    },
    period: {
      month: month || undefined,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
      label: periodLabel,
    },
    invoices: enrichedInvoices,
    payments: periodPayments,
    ledger,
    summary,
  };
}

// GET /customers/:customer_id - Customer statement & details
customerRouter.get('/customers/:customer_id', requireModule('customers'), async (req: Request, res: Response) => {
  try {
    const result = await buildCustomerStatement(req.params.customer_id, req.query);
    if (!result) {
      return res.status(404).json({ detail: 'This customer could not be found.' });
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// GET /customers/:customer_id/statement - Explicit statement endpoint
customerRouter.get('/customers/:customer_id/statement', requireModule('customers'), async (req: Request, res: Response) => {
  try {
    const result = await buildCustomerStatement(req.params.customer_id, req.query);
    if (!result) {
      return res.status(404).json({ detail: 'This customer could not be found.' });
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

customerRouter.post('/customers', requireModule('customers'), async (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!body.name || !body.name.trim()) {
      return res.status(400).json({ detail: 'Customer name is required.' });
    }

    const user = (req as any).user;
    const userId = user?.id || '5fecd6f5-7c32-488c-b1bc-b2a5f80b6927';

    const data = {
      ...body,
      user_id: userId,
      name: body.name.trim(),
      is_active: body.is_active ?? true,
      created_at: new Date().toISOString(),
    };

    const { row: createdRow, dropped } = await db.insertEx('customers', data);
    const row = await preserveDroppedFields('customers', createdRow, data, dropped);
    if (user && user.email) {
      await logAudit(user.email, 'Customer created', row.id, null, { name: row.name });
    }

    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

customerRouter.put('/customers/:customer_id', requireModule('customers'), async (req: Request, res: Response) => {
  try {
    const custId = req.params.customer_id;
    const old = await db.selectOne('customers', { id: `eq.${custId}` });
    if (!old) {
      return res.status(404).json({ detail: 'This customer could not be found.' });
    }

    const data = { ...req.body, updated_at: new Date().toISOString() };
    delete data.id;
    const { row: updatedRow, dropped } = await db.updateEx('customers', { id: `eq.${custId}` }, data);
    const row = await preserveDroppedFields('customers', updatedRow, data, dropped);

    const user = (req as any).user;
    await logAudit(user.email, 'Customer modified', custId, { name: old.name }, { name: row.name });

    res.json(row);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

customerRouter.delete('/customers/:customer_id', requireModule('customers'), async (req: Request, res: Response) => {
  try {
    const custId = req.params.customer_id;
    const old = await db.selectOne('customers', { id: `eq.${custId}` });
    if (!old) {
      return res.status(404).json({ detail: 'This customer could not be found.' });
    }

    const linked = await db.select('invoices', { customer_id: `eq.${custId}`, limit: 1 });
    if (linked && linked.length > 0) {
      return res.status(400).json({ detail: 'This customer has invoices and cannot be deleted. Mark them inactive instead.' });
    }

    await db.remove('customers', { id: `eq.${custId}` });
    const user = (req as any).user;
    await logAudit(user.email, 'Customer deleted', custId, { name: old.name }, null);

    res.json({ message: 'Customer removed.' });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});
