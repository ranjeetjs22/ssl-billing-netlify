import { Router, Request, Response } from 'express';
import * as db from '../db.js';
import * as calc from '../calc.js';
import { authMiddleware } from '../auth.js';

export const dashboardRouter = Router();
dashboardRouter.use(authMiddleware);

const handleDashboard = async (req: Request, res: Response) => {
  try {
    const fromDate = (req.query.from_date || req.query.from) as string;
    const toDate = (req.query.to_date || req.query.to) as string;

    let [invoices, payments, expenses, customers] = await Promise.all([
      db.select('invoices', { order: 'invoice_date.asc' }),
      db.select('payments'),
      db.select('expenses'),
      db.select('customers'),
    ]);

    if (fromDate) {
      invoices = invoices.filter((i: any) => (i.invoice_date || '') >= fromDate);
      payments = payments.filter((p: any) => (p.payment_date || p.created_at || '').slice(0, 10) >= fromDate);
      expenses = expenses.filter((e: any) => (e.expense_date || '').slice(0, 10) >= fromDate);
    }
    if (toDate) {
      invoices = invoices.filter((i: any) => (i.invoice_date || '') <= toDate);
      payments = payments.filter((p: any) => (p.payment_date || p.created_at || '').slice(0, 10) <= toDate);
      expenses = expenses.filter((e: any) => (e.expense_date || '').slice(0, 10) <= toDate);
    }

    const paidByInvoice: Record<string, number> = {};
    for (const p of payments) {
      paidByInvoice[p.invoice_id] = (paidByInvoice[p.invoice_id] || 0) + calc.num(p.amount);
    }

    const totals = {
      total_sales: 0,
      taxable_sales: 0,
      gst: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
    };
    const counts = {
      invoices: 0,
      paid: 0,
      pending: 0,
      overdue: 0,
      draft: 0,
      cancelled: 0,
    };

    const monthly: Record<string, { month: string; sales: number; payments: number; expenses: number }> = {};
    const today = new Date().toISOString().slice(0, 10);

    for (const inv of invoices) {
      counts.invoices += 1;
      const status = String(inv.status || 'issued').toLowerCase();
      if (status === 'cancelled') {
        counts.cancelled += 1;
        continue;
      }
      if (status === 'draft') {
        counts.draft += 1;
      }

      const t = calc.compute(inv);
      totals.total_sales += t.grand_total;
      totals.taxable_sales += t.taxable_amount;
      totals.gst += t.gst_amount;
      totals.cgst += t.cgst;
      totals.sgst += t.sgst;
      totals.igst += t.igst;

      const received = paidByInvoice[inv.id] || 0;
      if (status !== 'draft') {
        if (received >= t.grand_total - 1) {
          counts.paid += 1;
        } else {
          counts.pending += 1;
          const due = String(inv.due_date || inv.invoice_date || today).slice(0, 10);
          if (due < today) {
            counts.overdue += 1;
          }
        }
      }

      const m = String(inv.invoice_date || '').slice(0, 7);
      if (m) {
        if (!monthly[m]) monthly[m] = { month: m, sales: 0, payments: 0, expenses: 0 };
        monthly[m].sales += t.grand_total;
      }
    }

    const totalPayments = payments.reduce((acc: number, p: any) => acc + calc.num(p.amount), 0);
    for (const p of payments) {
      const m = String(p.payment_date || p.created_at || '').slice(0, 7);
      if (m) {
        if (!monthly[m]) monthly[m] = { month: m, sales: 0, payments: 0, expenses: 0 };
        monthly[m].payments += calc.num(p.amount);
      }
    }

    const totalExpenses = expenses.reduce((acc: number, e: any) => acc + calc.num(e.amount), 0);
    for (const e of expenses) {
      const m = String(e.expense_date || '').slice(0, 7);
      if (m) {
        if (!monthly[m]) monthly[m] = { month: m, sales: 0, payments: 0, expenses: 0 };
        monthly[m].expenses += calc.num(e.amount);
      }
    }

    const series = Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month)).map(s => ({
      month: s.month,
      sales: calc.r2(s.sales),
      payments: calc.r2(s.payments),
      expenses: calc.r2(s.expenses),
      profit: calc.r2(s.sales - s.expenses),
      outstanding: calc.r2(s.sales - s.payments),
    }));

    const chart_data = series.map(s => ({
      month: s.month,
      sales: s.sales,
      collected: s.payments,
    }));

    const outstanding = calc.r2(totals.total_sales - totalPayments);
    const profit = calc.r2(totals.taxable_sales - totalExpenses);

    const metricsObj = {
      total_sales: calc.r2(totals.total_sales),
      taxable_sales: calc.r2(totals.taxable_sales),
      gst: calc.r2(totals.gst),
      cgst: calc.r2(totals.cgst),
      sgst: calc.r2(totals.sgst),
      igst: calc.r2(totals.igst),
      payments_received: calc.r2(totalPayments),
      outstanding: Math.max(0, outstanding),
      expenses: calc.r2(totalExpenses),
      estimated_profit: profit,
      profit_margin: totals.taxable_sales ? calc.r2((profit / totals.taxable_sales) * 100) : 0,
      customers: customers.length,
      ...counts,
    };

    // Format recent 5 invoices (sorted newest first)
    const recent_invoices = [...invoices]
      .sort((a: any, b: any) => {
        const da = a.invoice_date || '';
        const dbDate = b.invoice_date || '';
        if (da !== dbDate) return da > dbDate ? -1 : 1;
        const ca = a.created_at || '';
        const cb = b.created_at || '';
        if (ca !== cb) return ca > cb ? -1 : 1;
        return String(a.invoice_no || '') > String(b.invoice_no || '') ? -1 : 1;
      })
      .slice(0, 5)
      .map((inv: any) => {
        const t = calc.compute(inv);
        const received = paidByInvoice[inv.id] || 0;
        let st = 'PENDING';
        if (received >= t.grand_total - 1) st = 'PAID';
        else if (received > 0) st = 'PARTIAL';
        else if (String(inv.due_date || '').slice(0, 10) < today) st = 'OVERDUE';

        return {
          ...inv,
          buyer_name: inv.buyer?.name || inv.customer_name || 'Customer',
          from_city: inv.origin || 'Ahmedabad',
          to_city: inv.destination || 'Destination',
          totals: t,
          status: st,
        };
      });

    res.json({
      ...metricsObj,
      metrics: metricsObj,
      series,
      chart_data,
      recent_invoices,
    });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
};

dashboardRouter.get('/dashboard', handleDashboard);
dashboardRouter.get('/dashboard/summary', handleDashboard);
