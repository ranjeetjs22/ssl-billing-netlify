import { Router, Request, Response } from 'express';
import * as db from '../db.js';
import * as calc from '../calc.js';
import { authMiddleware, requireModule } from '../auth.js';

/**
 * Operating expenses (overheads): rent, salaries, phone, office and the like.
 * Direct trip costs such as lorry hire are entered on the bill itself, so they
 * are not recorded here; putting them in both places would count them twice.
 */
export const expenseRouter = Router();
expenseRouter.use(authMiddleware);
const requireExpenses = requireModule('expenses');

const clean = (b: Record<string, any>) => ({
  expense_date: String(b.expense_date || calc.todayIST()).slice(0, 10),
  category: String(b.category || 'Miscellaneous').trim(),
  description: String(b.description || '').trim(),
  amount: calc.r2(calc.num(b.amount)),
  payment_method: b.payment_method ? String(b.payment_method).trim() : null,
  reference: b.reference ? String(b.reference).trim() : null,
  notes: b.notes ? String(b.notes).trim() : null,
});

// Literal paths stay above `/:id` routes: Express matches in registration order.
expenseRouter.get('/expenses/categories', requireExpenses, async (_req: Request, res: Response) => {
  try {
    const rows = await db.select('expense_categories', { order: 'name.asc' });
    res.json(rows.map((r: any) => r.name));
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

expenseRouter.get('/expenses', requireExpenses, async (req: Request, res: Response) => {
  try {
    const from = String(req.query.from || req.query.from_date || '').slice(0, 10);
    const to = String(req.query.to || req.query.to_date || '').slice(0, 10);
    let rows = await db.select('expenses', { order: 'expense_date.desc' });
    rows = rows.filter((e: any) => {
      const d = String(e.expense_date || '').slice(0, 10);
      return (!from || d >= from) && (!to || d <= to);
    });
    const byCategory: Record<string, number> = {};
    for (const e of rows) byCategory[e.category || 'Miscellaneous'] = (byCategory[e.category || 'Miscellaneous'] || 0) + calc.num(e.amount);
    res.json({
      items: rows,
      total: calc.r2(rows.reduce((a: number, e: any) => a + calc.num(e.amount), 0)),
      by_category: Object.entries(byCategory)
        .map(([category, amount]) => ({ category, amount: calc.r2(amount) }))
        .sort((a, b) => b.amount - a.amount),
    });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

expenseRouter.post('/expenses', requireExpenses, async (req: Request, res: Response) => {
  try {
    const data = clean(req.body || {});
    if (data.amount <= 0) return res.status(400).json({ detail: 'Enter an amount greater than zero.' });
    const user = (req as any).user;
    const { row } = await db.insertEx('expenses', {
      ...data, user_id: user?.id || null, created_at: new Date().toISOString(),
    });
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

expenseRouter.put('/expenses/:id', requireExpenses, async (req: Request, res: Response) => {
  try {
    const data = clean(req.body || {});
    if (data.amount <= 0) return res.status(400).json({ detail: 'Enter an amount greater than zero.' });
    const { row } = await db.updateEx('expenses', { id: `eq.${req.params.id}` }, {
      ...data, updated_at: new Date().toISOString(),
    });
    if (!row) return res.status(404).json({ detail: 'This expense could not be found.' });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

expenseRouter.delete('/expenses/:id', requireExpenses, async (req: Request, res: Response) => {
  try {
    await db.remove('expenses', { id: `eq.${req.params.id}` });
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});
