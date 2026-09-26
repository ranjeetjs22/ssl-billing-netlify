import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import * as db from './db.js';

// Read lazily - on Cloudflare Workers process.env is populated per request.
export function secret(): string {
  return process.env.JWT_SECRET || 'ssl-billing-gst-4f8c1d9b2e7a6350bd1c8ea4297f5b6031ac';
}
export function expireHours(): number {
  return parseInt(process.env.JWT_EXPIRE_HOURS || '12', 10);
}

export const ROLE_MODULES: Record<string, string[]> = {
  admin: ['dashboard', 'invoices', 'customers', 'payments', 'expenses', 'reports', 'settings', 'users'],
  staff: ['dashboard', 'invoices', 'customers', 'payments'],
  accountant: ['dashboard', 'invoices', 'payments', 'expenses', 'reports'],
};

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------
// New hashes use PBKDF2-SHA256 via WebCrypto (native, fast, available in Node and on
// Cloudflare Workers - bcryptjs is pure JS and burns ~80 ms of CPU per hash, which
// exceeds the Workers free-plan CPU budget). Legacy bcrypt hashes ("$2…") still verify.
const PBKDF2_ITERATIONS = 60_000;
const subtle = globalThis.crypto.subtle;

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as any, iterations }, keyMaterial, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(pw, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${Buffer.from(salt).toString('base64')}$${Buffer.from(hash).toString('base64')}`;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  try {
    if (!stored || !pw) return false;
    if (stored.startsWith('pbkdf2$')) {
      const [, algo, iterStr, saltB64, hashB64] = stored.split('$');
      if (algo !== 'sha256') return false;
      const salt = new Uint8Array(Buffer.from(saltB64, 'base64'));
      const expected = new Uint8Array(Buffer.from(hashB64, 'base64'));
      const actual = await pbkdf2(pw, salt, parseInt(iterStr, 10));
      return constantTimeEqual(actual, expected);
    }
    // Legacy bcrypt hash
    return bcrypt.compareSync(pw, stored);
  } catch {
    return false;
  }
}

/** True when a stored hash should be upgraded to the current scheme after a successful login. */
export function needsRehash(stored: string): boolean {
  return !String(stored || '').startsWith(`pbkdf2$sha256$${PBKDF2_ITERATIONS}$`);
}

// ---------------------------------------------------------------------------
// JWT
// ---------------------------------------------------------------------------
export function createToken(user: Record<string, any>): string {
  const payload = { sub: user.id, email: user.email, role: user.role };
  return jwt.sign(payload, secret(), { expiresIn: `${expireHours()}h` });
}

export function publicUser(u: Record<string, any>) {
  return {
    id: u.id,
    email: u.email,
    full_name: u.full_name || '',
    role: u.role,
    is_active: u.is_active ?? true,
    last_login: u.last_login,
    created_at: u.created_at,
    modules: ROLE_MODULES[u.role] || [],
  };
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ detail: 'You are not signed in. Please log in to continue.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, secret()) as { sub: string; email: string; role: string };
    const user = await db.selectOne('app_users', { id: `eq.${payload.sub}` });
    if (!user) {
      return res.status(401).json({ detail: 'This user account no longer exists.' });
    }
    if (user.is_active === false) {
      return res.status(403).json({ detail: 'This account has been deactivated. Contact your administrator.' });
    }
    (req as any).user = user;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ detail: 'Your session has expired. Please log in again.' });
    }
    return res.status(401).json({ detail: 'Your session is invalid. Please log in again.' });
  }
}

export function requireModule(moduleName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ detail: 'You are not signed in.' });
    }
    const allowed = ROLE_MODULES[user.role] || [];
    if (!allowed.includes(moduleName)) {
      return res.status(403).json({ detail: `Your role (${user.role}) does not have access to ${moduleName}.` });
    }
    next();
  };
}

export const requireAdmin = requireModule('users');
