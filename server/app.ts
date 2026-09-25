import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import dotenv from 'dotenv';

import * as db from './db.js';
import {
  hashPassword,
  verifyPassword,
  needsRehash,
  createToken,
  publicUser,
  authMiddleware,
} from './auth.js';
import { customerRouter } from './routes/customers.js';
import { invoiceRouter } from './routes/invoices.js';
import { paymentRouter } from './routes/payments.js';
import { settingsRouter } from './routes/settings.js';
import { dashboardRouter } from './routes/dashboard.js';
import { lookupRouter } from './routes/lookup.js';
import { rateRouter } from './routes/rates.js';

dotenv.config();

let seedPromise: Promise<void> | null = null;

export async function seedData(): Promise<void> {
  try {
    const adminEmail = (process.env.ADMIN_EMAIL || 'rorjptronaksingh5241@gmail.com').toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD || 'Ronak@9725';
    const adminName = process.env.ADMIN_NAME || 'Ronak Singh';

    const users = await db.select('app_users');
    let admin = users?.find((u: any) => u.email === adminEmail);
    if (!admin) {
      admin = await db.insert('app_users', {
        email: adminEmail,
        password_hash: await hashPassword(adminPassword),
        full_name: adminName,
        role: 'admin',
        is_active: true,
        created_at: new Date().toISOString(),
      });
      console.log('Seeded admin user:', adminEmail);
    }

    let company = await db.selectOne('company_settings');
    if (!company) {
      company = await db.insert('company_settings', {
        name: 'SHREE SANWARIYA LOGISTICS',
        address: 'Opp. Transport Nagar, Ring Road',
        city: 'Ahmedabad',
        state: 'Gujarat',
        pin: '382443',
        gstin: '24AABCS1429B1Z8',
        pan: 'AABCS1429B',
        phone: '+91 98765 43210',
        whatsapp: '+91 98765 43210',
        email: 'billing@shreesanwariya.com',
        website: 'www.shreesanwariyalogistics.com',
        invoice_prefix: 'SSL',
        next_number: 1001,
        gst_rate: 18,
        gst_type: 'cgst_sgst',
        terms: "1. Goods booked at owner's risk.\n2. All disputes subject to Ahmedabad jurisdiction only.\n3. Interest @ 18% p.a. will be charged if payment is delayed beyond due date.",
        created_at: new Date().toISOString(),
      });
      console.log('Seeded company settings');
    }

    const banks = await db.select('bank_accounts');
    if (!banks || banks.length === 0) {
      await db.insert('bank_accounts', {
        account_holder: 'SHREE SANWARIYA LOGISTICS',
        bank_name: 'HDFC Bank',
        account_number: '50200084729104',
        ifsc: 'HDFC0001234',
        branch: 'Transport Nagar, Ahmedabad',
        upi_id: 'shreesanwariya@hdfcbank',
        is_default: true,
        created_at: new Date().toISOString(),
      });
      console.log('Seeded default bank account');
    }

    // Demo customers/invoices only in local mode (or when explicitly requested) — never
    // pollute a production database with sample data.
    const seedSamples = !db.hasSupabase() || process.env.SEED_SAMPLE_DATA === 'true';
    const customers = seedSamples ? await db.select('customers') : [{}];
    if (!customers || customers.length === 0) {
      const c1 = await db.insert('customers', {
        name: 'Apex Industrial Corp',
        address: 'Plot 42, GIDC Industrial Estate',
        city: 'Surat',
        state: 'Gujarat',
        pin: '395006',
        gstin: '24AAACA1234A1Z5',
        pan: 'AAACA1234A',
        phone: '+91 98250 11223',
        email: 'accounts@apexcorp.in',
        payment_terms: 'Net 15 Days',
        credit_days: 15,
        is_active: true,
        created_at: new Date().toISOString(),
      });

      const c2 = await db.insert('customers', {
        name: 'Maharashtra Logistics Hub',
        address: 'B-10, MIDC Warehousing Complex',
        city: 'Bhiwandi',
        state: 'Maharashtra',
        pin: '421302',
        gstin: '27AABCM9876M1Z2',
        pan: 'AABCM9876M',
        phone: '+91 97654 32100',
        email: 'billing@mahalogistics.com',
        payment_terms: 'Net 30 Days',
        credit_days: 30,
        is_active: true,
        created_at: new Date().toISOString(),
      });

      const c3 = await db.insert('customers', {
        name: 'Rajasthan Textiles & Crafts',
        address: '14, Industrial Area Phase 2',
        city: 'Jaipur',
        state: 'Rajasthan',
        pin: '302013',
        gstin: '08AAACR5544R1Z0',
        pan: 'AAACR5544R',
        phone: '+91 94140 99887',
        email: 'finance@rajtextiles.co',
        payment_terms: 'Immediate',
        credit_days: 0,
        is_active: true,
        created_at: new Date().toISOString(),
      });

      // Seed 2 initial invoices to showcase complete calculation engine & status
      const inv1 = await db.insert('invoices', {
        customer_id: c1.id,
        invoice_no: 'SSL/2026-27/0001',
        invoice_date: new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10),
        buyer: {
          name: c1.name,
          address: c1.address,
          city: c1.city,
          state: c1.state,
          pin: c1.pin,
          gstin: c1.gstin,
          phone: c1.phone,
        },
        ship_to: {
          name: c1.name,
          address: c1.address,
          city: c1.city,
          state: c1.state,
          pin: c1.pin,
        },
        same_as_buyer: true,
        lr_no: 'LR-98412',
        origin: 'Ahmedabad',
        destination: 'Surat',
        weight: 1250,
        rate_kg: 8.5,
        sac: '996511',
        place_of_supply: 'Gujarat',
        freight: 10625,
        extra_charges: [
          { label: 'Loading / Unloading', amount: 800 },
          { label: 'Dock Handling', amount: 450 },
        ],
        additional_total: 1250,
        discount_type: 'percent',
        discount_value: 5,
        discount_amount: 593.75,
        taxable_amount: 11281.25,
        gst_type: 'intra',
        gst_rate: 18,
        gst_amount: 2030.63,
        cgst: 1015.31,
        sgst: 1015.32,
        igst: 0,
        round_off: 0.12,
        grand_total: 13312,
        due_date: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
        status: 'pending',
        created_at: new Date(Date.now() - 10 * 86400000).toISOString(),
      });

      // Partial payment on inv1
      await db.insert('payments', {
        invoice_id: inv1.id,
        payment_date: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
        amount: 8000,
        method: 'Bank Transfer',
        reference: 'NEFT-AXIS-98214',
        notes: 'Advance part payment received',
        created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
      });

      // Inter-state invoice to c2
      await db.insert('invoices', {
        customer_id: c2.id,
        invoice_no: 'SSL/2026-27/0002',
        invoice_date: new Date(Date.now() - 25 * 86400000).toISOString().slice(0, 10),
        buyer: {
          name: c2.name,
          address: c2.address,
          city: c2.city,
          state: c2.state,
          pin: c2.pin,
          gstin: c2.gstin,
          phone: c2.phone,
        },
        ship_to: {
          name: c2.name,
          address: c2.address,
          city: c2.city,
          state: c2.state,
          pin: c2.pin,
        },
        same_as_buyer: true,
        lr_no: 'LR-98480',
        origin: 'Ahmedabad',
        destination: 'Bhiwandi',
        weight: 3400,
        rate_kg: 7.2,
        sac: '996511',
        place_of_supply: 'Maharashtra',
        freight: 24480,
        extra_charges: [{ label: 'Transit Insurance', amount: 1200 }],
        additional_total: 1200,
        discount_type: 'percent',
        discount_value: 0,
        discount_amount: 0,
        taxable_amount: 25680,
        gst_type: 'inter',
        gst_rate: 18,
        gst_amount: 4622.4,
        cgst: 0,
        sgst: 0,
        igst: 4622.4,
        round_off: -0.4,
        grand_total: 30302,
        due_date: new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10),
        status: 'pending',
        created_at: new Date(Date.now() - 25 * 86400000).toISOString(),
      });
      console.log('Seeded sample customers and invoices');
    }
  } catch (err) {
    console.error('Seed data error:', err);
  }
}

export function ensureDataSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = seedData();
  }
  return seedPromise;
}

export const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Path Normalization Middleware for Netlify Functions routing
app.use((req: Request, _res: Response, next: NextFunction) => {
  // Strip Netlify Functions prefix if invoked directly or via raw URL
  if (req.url.startsWith('/.netlify/functions/api')) {
    req.url = req.url.replace(/^\/\.netlify\/functions\/api/, '') || '/';
    if (!req.url.startsWith('/api')) {
      req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
    }
  }
  next();
});

// Lazy-seed database initialization for serverless / container execution
app.use(async (_req: Request, _res: Response, next: NextFunction) => {
  try {
    await ensureDataSeeded();
  } catch (e) {
    console.error('Seed check error:', e);
  }
  next();
});

// ---------------- Public Auth Endpoints ----------------
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', database: 'connected', app: 'SSL Billing Web App GST' });
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = req.body.password;

    if (!email || !password) {
      return res.status(400).json({ detail: 'Please enter both email and password.' });
    }

    const user = await db.selectOne('app_users', { email: `eq.${email}` });
    if (!user) {
      return res.status(401).json({ detail: 'No account found with this email address.' });
    }

    if (!(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ detail: 'Incorrect password. Please try again.' });
    }

    if (user.is_active === false) {
      return res.status(403).json({ detail: 'This account has been deactivated. Contact your administrator.' });
    }

    const patch: Record<string, any> = { last_login: new Date().toISOString() };
    if (needsRehash(user.password_hash)) {
      // Transparently upgrade legacy bcrypt hashes to the fast native scheme.
      patch.password_hash = await hashPassword(password);
    }
    await db.update('app_users', { id: `eq.${user.id}` }, patch);

    const token = createToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

app.get('/api/auth/me', authMiddleware, (req: Request, res: Response) => {
  const user = (req as any).user;
  res.json(publicUser(user));
});

app.post('/api/auth/logout', authMiddleware, (_req: Request, res: Response) => {
  res.json({ message: 'Signed out successfully.' });
});

app.post('/api/auth/forgot-password', async (req: Request, res: Response) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = await db.selectOne('app_users', { email: `eq.${email}` });
    if (!user) {
      return res.status(404).json({ detail: 'No account found with this email address.' });
    }
    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    await db.insert('password_resets', {
      user_id: user.id,
      token,
      expires_at: expiresAt,
      used: false,
    });
    res.json({ message: 'Reset link generated. Use the token below to set a new password.', token });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

app.post('/api/auth/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body;
    if (!token || !password || password.length < 6) {
      return res.status(400).json({ detail: 'Password must be at least 6 characters.' });
    }
    const row = await db.selectOne('password_resets', { token: `eq.${token}` });
    if (!row || row.used) {
      return res.status(400).json({ detail: 'This reset link is invalid or has already been used.' });
    }
    if (new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ detail: 'This reset link has expired. Please request a new one.' });
    }

    await db.update('app_users', { id: `eq.${row.user_id}` }, {
      password_hash: await hashPassword(password),
      updated_at: new Date().toISOString(),
    });
    await db.update('password_resets', { id: `eq.${row.id}` }, { used: true });

    res.json({ message: 'Password updated. You can now log in with your new password.' });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// ---------------- Feature Routers ----------------
app.use('/api', customerRouter);
app.use('/api', invoiceRouter);
app.use('/api', paymentRouter);
app.use('/api', settingsRouter);
app.use('/api', dashboardRouter);
app.use('/api', lookupRouter);
app.use('/api', rateRouter);

// ---------------- API 404 Handler (Guarantees JSON response for unmatched API routes) ----------------
app.all('/api/*', (req: Request, res: Response) => {
  res.status(404).json({ error: 'Endpoint not found', path: req.originalUrl || req.url });
});

// ---------------- Global API Error Handler ----------------
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('API Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
  });
});
