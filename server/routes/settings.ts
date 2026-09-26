import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as db from '../db.js';
import { authMiddleware, requireModule, requireAdmin, hashPassword, publicUser, ROLE_MODULES } from '../auth.js';

export const settingsRouter = Router();

const upload = multer({
  limits: { fileSize: 2 * 1024 * 1024 },
  storage: multer.memoryStorage(),
});

// Stored in-memory image files for local branding
const fileStore = new Map<string, { buffer: Buffer; mime: string }>();

settingsRouter.get('/files/:filename', (req: Request, res: Response) => {
  const file = fileStore.get(req.params.filename);
  if (!file) {
    return res.status(404).json({ detail: 'This file could not be found.' });
  }
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(file.buffer);
});

settingsRouter.use(authMiddleware);

settingsRouter.get('/settings/company', async (_req: Request, res: Response) => {
  try {
    const row = await db.selectOne('company_settings');
    if (!row) {
      return res.status(404).json({ detail: 'Company profile has not been configured yet.' });
    }
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

const updateCompanyHandler = async (req: Request, res: Response) => {
  try {
    const old = await db.selectOne('company_settings');
    const data = { ...req.body, updated_at: new Date().toISOString() };

    let row;
    if (old && old.id) {
      row = await db.update('company_settings', { id: `eq.${old.id}` }, data);
    } else {
      row = await db.insert('company_settings', data);
    }

    const user = (req as any).user;
    if (user) {
      await db.insert('audit_logs', {
        user_email: user.email || 'system',
        action: 'Settings changed',
        entity: 'company_settings',
        entity_id: row?.id || old?.id,
        old_value: old,
        new_value: data,
        created_at: new Date().toISOString(),
      });
    }

    res.json(row || data);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
};

settingsRouter.put('/settings/company', requireModule('settings'), updateCompanyHandler);
settingsRouter.post('/settings/company', requireModule('settings'), updateCompanyHandler);

settingsRouter.post('/settings/logo', requireModule('settings'), upload.single('file'), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ detail: 'The selected file is empty. Please choose a valid image.' });
    }

    const ext = file.originalname.split('.').pop()?.toLowerCase() || 'png';
    if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      return res.status(400).json({ detail: 'Please upload a PNG, JPG or WEBP image. SVG files cannot be embedded in invoice PDFs.' });
    }

    const filename = `logo_${Date.now()}.${ext}`;
    let logo_url: string;
    if (db.hasSupabase()) {
      // Persist in Supabase Storage - serverless instances have no durable disk/memory.
      logo_url = await db.uploadPublicFile('logos', filename, new Uint8Array(file.buffer), file.mimetype || `image/${ext === 'jpg' ? 'jpeg' : ext}`);
    } else {
      fileStore.set(filename, { buffer: file.buffer, mime: file.mimetype });
      logo_url = `/api/files/${filename}`;
    }

    const company = await db.selectOne('company_settings');
    if (company && company.id) {
      await db.update('company_settings', { id: `eq.${company.id}` }, {
        logo_url,
        updated_at: new Date().toISOString(),
      });
    }

    res.json({ logo_url, size: file.size });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

const getBankAccountsHandler = async (_req: Request, res: Response) => {
  try {
    const banks = await db.select('bank_accounts', { order: 'is_default.desc,created_at.asc' });
    res.json(banks);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
};

const createBankAccountHandler = async (req: Request, res: Response) => {
  try {
    const existing = await db.select('bank_accounts');
    const data = { ...req.body, created_at: new Date().toISOString() };
    if (!existing || existing.length === 0) {
      data.is_default = true;
    }
    if (data.is_default) {
      for (const b of existing) {
        if (b.is_default) {
          await db.update('bank_accounts', { id: `eq.${b.id}` }, { is_default: false });
        }
      }
    }

    const row = await db.insert('bank_accounts', data);
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
};

const updateBankAccountHandler = async (req: Request, res: Response) => {
  try {
    const bankId = req.params.bank_id;
    const old = await db.selectOne('bank_accounts', { id: `eq.${bankId}` });
    if (!old) {
      return res.status(404).json({ detail: 'Bank account not found.' });
    }

    const data = { ...req.body };
    if (data.is_default) {
      const all = await db.select('bank_accounts');
      for (const b of all) {
        if (b.is_default && b.id !== bankId) {
          await db.update('bank_accounts', { id: `eq.${b.id}` }, { is_default: false });
        }
      }
    }

    const row = await db.update('bank_accounts', { id: `eq.${bankId}` }, data);
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
};

const deleteBankAccountHandler = async (req: Request, res: Response) => {
  try {
    const bankId = req.params.bank_id;
    const old = await db.selectOne('bank_accounts', { id: `eq.${bankId}` });
    if (!old) {
      return res.status(404).json({ detail: 'Bank account not found.' });
    }

    await db.remove('bank_accounts', { id: `eq.${bankId}` });
    if (old.is_default) {
      const rest = await db.select('bank_accounts', { limit: 1 });
      if (rest && rest.length > 0) {
        await db.update('bank_accounts', { id: `eq.${rest[0].id}` }, { is_default: true });
      }
    }

    res.json({ message: 'Bank account removed.' });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
};

settingsRouter.get('/settings/banks', getBankAccountsHandler);
settingsRouter.get('/settings/bank-accounts', getBankAccountsHandler);
settingsRouter.get('/bank-accounts', getBankAccountsHandler);

settingsRouter.post('/settings/banks', requireModule('settings'), createBankAccountHandler);
settingsRouter.post('/settings/bank-accounts', requireModule('settings'), createBankAccountHandler);
settingsRouter.post('/bank-accounts', requireModule('settings'), createBankAccountHandler);

settingsRouter.put('/settings/banks/:bank_id', requireModule('settings'), updateBankAccountHandler);
settingsRouter.put('/settings/bank-accounts/:bank_id', requireModule('settings'), updateBankAccountHandler);

settingsRouter.delete('/settings/banks/:bank_id', requireModule('settings'), deleteBankAccountHandler);
settingsRouter.delete('/settings/bank-accounts/:bank_id', requireModule('settings'), deleteBankAccountHandler);

// Users
settingsRouter.get('/users', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db.select('app_users', { order: 'created_at.asc' });
    res.json(rows.map(publicUser));
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

settingsRouter.get('/users/roles', (_req: Request, res: Response) => {
  res.json(ROLE_MODULES);
});

settingsRouter.post('/users', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { email, password, full_name, role } = req.body;
    if (!role || !ROLE_MODULES[role]) {
      return res.status(400).json({ detail: 'Role must be admin, staff or accountant.' });
    }
    const cleanEmail = String(email || '').trim().toLowerCase();
    const existing = await db.selectOne('app_users', { email: `eq.${cleanEmail}` });
    if (existing) {
      return res.status(409).json({ detail: 'A user with this email already exists.' });
    }

    const created = await db.insert('app_users', {
      email: cleanEmail,
      password_hash: await hashPassword(password || 'Password@123'),
      full_name: full_name || '',
      role,
      is_active: true,
      created_at: new Date().toISOString(),
    });

    res.status(201).json(publicUser(created));
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

settingsRouter.put('/users/:user_id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const userId = req.params.user_id;
    const target = await db.selectOne('app_users', { id: `eq.${userId}` });
    if (!target) {
      return res.status(404).json({ detail: 'User not found.' });
    }

    const currentUser = (req as any).user;
    const { full_name, role, is_active, password } = req.body;
    const data: Record<string, any> = { updated_at: new Date().toISOString() };

    if (full_name !== undefined) data.full_name = full_name;
    if (role !== undefined) {
      if (!ROLE_MODULES[role]) {
        return res.status(400).json({ detail: 'Role must be admin, staff or accountant.' });
      }
      data.role = role;
    }
    if (is_active !== undefined) {
      if (target.id === currentUser.id && is_active === false) {
        return res.status(400).json({ detail: 'You cannot deactivate your own account.' });
      }
      data.is_active = is_active;
    }
    if (password) {
      if (password.length < 6) {
        return res.status(400).json({ detail: 'Password must be at least 6 characters.' });
      }
      data.password_hash = await hashPassword(password);
    }

    const updated = await db.update('app_users', { id: `eq.${userId}` }, data);
    res.json(publicUser(updated));
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

settingsRouter.delete('/users/:user_id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const userId = req.params.user_id;
    const currentUser = (req as any).user;
    if (userId === currentUser.id) {
      return res.status(400).json({ detail: 'You cannot delete your own account.' });
    }
    const target = await db.selectOne('app_users', { id: `eq.${userId}` });
    if (!target) {
      return res.status(404).json({ detail: 'User not found.' });
    }

    await db.remove('app_users', { id: `eq.${userId}` });
    res.json({ message: 'User removed.' });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Audit
settingsRouter.get('/audit-logs', requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const logs = await db.select('audit_logs', { order: 'created_at.desc', limit: Math.min(limit, 200) });
    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});
