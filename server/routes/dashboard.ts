import { Router, Request, Response } from 'express';
import * as db from '../db.js';
import * as calc from '../calc.js';
import { authMiddleware } from '../auth.js';

export const dashboardRouter = Router();
dashboardRouter.use(authMiddleware);

const handleDashboard = async (req: Request, res: Response) => {
  try {
    const from = String(req.query.from_date || req.query.from || '').slice(0, 10) || undefined;
    const to = String(req.query.to_date || req.query.to || '').slice(0, 10) || undefined;
    const today = calc.todayIST();

    // Expenses has no write path in the app yet, so a missing or blocked table
    // must not take the whole dashboard down with it.
    const [invoices, payments, customers, expenses] = await Promise.all([
      db.select('invoices', { order: 'invoice_date.asc' }),
      db.select('payments'),
      db.select('customers'),
      db.select('expenses').catch(() => [] as any[]),
    ]);

    // One definition of sales / collected / outstanding, shared with the
    // reports and the invoice list, so the three screens cannot disagree.
    const s = calc.summarise(invoices, payments, { from, to, today });

    const inPeriod = (d: any) => {
      const v = String(d || '').slice(0, 10);
      return (!from || v >= from) && (!to || v <= to);
    };
    const periodExpenses = expenses.filter((e: any) => inPeriod(e.expense_date));
    const totalExpenses = calc.r2(periodExpenses.reduce((a: number, e: any) => a + calc.num(e.amount), 0));
    const expenseByMonth: Record<string, number> = {};
    for (const e of periodExpenses) {
      const m = String(e.expense_date || '').slice(0, 7);
      if (m) expenseByMonth[m] = (expenseByMonth[m] || 0) + calc.num(e.amount);
    }

    // Gross profit is revenue minus direct trip cost, over the bills that have
    // a cost entered (calc.summarise). Net profit then takes off overheads.
    const netProfit = calc.r2(s.gross_profit - totalExpenses);

    const { series: monthRows, range, ...money } = s;
    const metricsObj = {
      ...money,
      // kept for callers that still read the old name
      payments_received: s.collected,
      expenses: totalExpenses,
      net_profit: netProfit,
      // kept for older callers; now the real net figure rather than sales - expenses
      estimated_profit: netProfit,
      profit_margin: s.margin_pct ?? 0,
      customers: customers.length,
    };

    const series = monthRows.map(m => ({
      ...m,
      expenses: calc.r2(expenseByMonth[m.month] || 0),
    }));

    const chart_data = series.map(m => ({
      month: m.month,
      sales: m.sales,
      collected: m.collected,
    }));

    // Latest five bills raised in the period, newest first. Status comes from
    // the same rule every other screen uses, so a cancelled bill says cancelled.
    const paidBy: Record<string, number> = {};
    for (const p of payments) paidBy[p.invoice_id] = (paidBy[p.invoice_id] || 0) + calc.num(p.amount);

    const recent_invoices = invoices
      .filter((inv: any) => inPeriod(inv.invoice_date))
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
        const paid = calc.r2(paidBy[inv.id] || 0);
        return {
          ...inv,
          buyer_name: inv.buyer?.name || inv.customer_name || 'Customer',
          from_city: inv.origin || '',
          to_city: inv.destination || '',
          totals: t,
          paid,
          balance: calc.r2(Math.max(0, t.grand_total - paid)),
          status: calc.displayStatus(inv, paid, t, today),
        };
      });

    res.json({
      ...metricsObj,
      range,
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
