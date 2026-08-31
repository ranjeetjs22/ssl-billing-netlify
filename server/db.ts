import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// ===========================================================================
// Configuration — read lazily. On Cloudflare Workers `process.env` is populated
// from bindings at request time, so nothing may be captured at module load.
// ===========================================================================
interface SupabaseConfig {
  enabled: boolean;
  base: string;   // https://<ref>.supabase.co
  rest: string;   // https://<ref>.supabase.co/rest/v1
  key: string;    // service-role key (server only, never sent to the browser)
}

let cfgCache: SupabaseConfig | null = null;
let announced = false;

function readConfig(): SupabaseConfig {
  const rawUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '').trim();
  const enabled = Boolean(rawUrl && key && !rawUrl.includes('your-') && !rawUrl.includes('placeholder'));
  const base = rawUrl.replace(/\/rest\/v1$/, '');
  return { enabled, base, rest: `${base}/rest/v1`, key };
}

export function config(): SupabaseConfig {
  // Re-evaluate while disabled in case the environment shows up later (Workers).
  if (cfgCache && !cfgCache.enabled && process.env.SUPABASE_URL) cfgCache = null;
  if (!cfgCache) {
    cfgCache = readConfig();
    if (!announced) {
      announced = true;
      console.log(cfgCache.enabled
        ? '[Database] Supabase is configured and ACTIVE as primary database.'
        : '[Database] Supabase credentials not detected; running in local offline storage mode.');
    }
    if (!cfgCache.enabled) loadDiskDb();
  }
  return cfgCache;
}

export function hasSupabase(): boolean {
  return config().enabled;
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const c = config();
  return { apikey: c.key, Authorization: `Bearer ${c.key}`, ...extra };
}

// ===========================================================================
// Tiny TTL cache for small, hot, rarely-changing tables. Every write to a table
// invalidates that table's entries, so reads stay consistent within a process.
// ===========================================================================
const CACHE_TTL_MS: Record<string, number> = {
  company_settings: 60_000,
  bank_accounts: 60_000,
  app_users: 30_000, // auth middleware looks the user up on every request
};
const cache = new Map<string, { exp: number; val: any }>();

function cacheGet(key: string): any | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.exp < Date.now()) { cache.delete(key); return undefined; }
  return JSON.parse(hit.val);
}
function cacheSet(key: string, val: any, ttl: number) {
  cache.set(key, { exp: Date.now() + ttl, val: JSON.stringify(val) });
}
export function invalidateTable(table: string) {
  for (const k of cache.keys()) if (k.startsWith(`${table}|`)) cache.delete(k);
}

// ===========================================================================
// Schema-cache resilience
// ===========================================================================
// If the hosted schema lags behind the app (missing column), PostgREST rejects the
// whole write with PGRST204. We drop the unknown column, remember it, retry, and log
// loudly so supabase/migrations can be applied. insertEx/updateEx report what was dropped.
const missingColumns: Record<string, Set<string>> = {};
const MISSING_COLUMN_RE = /Could not find the '([^']+)' column of '([^']+)'/i;

export function knownMissingColumns(table: string): string[] {
  return Array.from(missingColumns[table] || []);
}

function missingColumnFromError(err: any): string | null {
  const body = err?.supabaseError;
  const msg = String((body && typeof body === 'object' && body.message) || err?.message || '');
  const m = MISSING_COLUMN_RE.exec(msg);
  return m ? m[1] : null;
}

function stripKnownMissing(table: string, json: any, dropped?: string[]): any {
  const miss = missingColumns[table];
  if (!miss || miss.size === 0 || !json || typeof json !== 'object' || Array.isArray(json)) return json;
  const out: Record<string, any> = { ...json };
  for (const col of miss) {
    if (Object.prototype.hasOwnProperty.call(out, col)) {
      delete out[col];
      if (dropped && !dropped.includes(col)) dropped.push(col);
    }
  }
  return out;
}

// ===========================================================================
// Local JSON database (only when Supabase credentials are absent)
// ===========================================================================
let memoryDb: Record<string, any[]> = {
  app_users: [],
  password_resets: [],
  company_settings: [],
  bank_accounts: [],
  customers: [],
  invoices: [],
  payments: [],
  expenses: [],
  audit_logs: [],
};
let diskLoaded = false;

function dbFile(): string {
  return path.join(process.cwd(), 'data', 'app_db.json');
}

function loadDiskDb() {
  if (diskLoaded) return;
  diskLoaded = true;
  try {
    const file = dbFile();
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf-8');
      if (raw) memoryDb = { ...memoryDb, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.warn('Failed to load local DB file:', (e as Error).message);
  }
}

function saveDiskDb() {
  try {
    const file = dbFile();
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(memoryDb, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Failed to persist local DB file:', (e as Error).message);
  }
}

// ===========================================================================
// Request router
// ===========================================================================
type RequestOptions = { params?: Record<string, any>; json?: any; prefer?: string; dropped?: string[] };

export async function request(method: string, table: string, options: RequestOptions = {}) {
  if (!hasSupabase()) {
    return localRequest(method, table, options);
  }

  const isWrite = method === 'POST' || method === 'PATCH' || method === 'DELETE';
  if (isWrite) invalidateTable(table);

  // Read-through cache for small hot tables
  const ttl = CACHE_TTL_MS[table];
  const cacheKey = method === 'GET' && ttl ? `${table}|${JSON.stringify(options.params || {})}` : null;
  if (cacheKey) {
    const hit = cacheGet(cacheKey);
    if (hit !== undefined) return hit;
  }

  let json = isWrite ? stripKnownMissing(table, options.json, options.dropped) : options.json;

  for (let attempt = 0; attempt < 16; attempt++) {
    if (method === 'PATCH' && json && typeof json === 'object' && Object.keys(json).length === 0) {
      // Every field was stripped — nothing to update; return the current row(s).
      return await request('GET', table, { params: { select: '*', ...(options.params || {}) } });
    }
    try {
      const result = await supabaseRequest(method, table, { ...options, json });
      if (cacheKey) cacheSet(cacheKey, result, ttl);
      return result;
    } catch (err: any) {
      const col = isWrite ? missingColumnFromError(err) : null;
      if (col && json && typeof json === 'object' && Object.prototype.hasOwnProperty.call(json, col)) {
        if (!missingColumns[table]) missingColumns[table] = new Set();
        missingColumns[table].add(col);
        if (options.dropped && !options.dropped.includes(col)) options.dropped.push(col);
        console.warn(
          `[Database] Column '${table}.${col}' does not exist in Supabase — value dropped and request retried. ` +
          `Apply supabase/migrations/*.sql to persist this field.`
        );
        const { [col]: _omit, ...rest } = json;
        json = rest;
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Supabase request to ${table} failed after stripping unknown columns.`);
}

const PAGE_SIZE = 1000; // PostgREST's default max-rows; larger tables are fetched in pages

async function supabaseRequest(method: string, table: string, options: RequestOptions = {}) {
  const c = config();
  let url = `${c.rest}/${table}`;
  if (options.params) {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(options.params)) {
      if (v !== undefined && v !== null) query.append(k, String(v));
    }
    const qs = query.toString();
    if (qs) url += `?${qs}`;
  }

  const baseHeaders: Record<string, string> = authHeaders({ 'Content-Type': 'application/json' });
  if (options.prefer) baseHeaders['Prefer'] = options.prefer;

  // Unbounded GETs page through the table so nothing is silently truncated at 1000 rows.
  const paged = method === 'GET' && !(options.params && options.params.limit);
  if (!paged) {
    return await supabaseFetch(method, table, url, baseHeaders, options.json);
  }

  const all: any[] = [];
  for (let from = 0; from < 500_000; from += PAGE_SIZE) {
    const rows = await supabaseFetch(method, table, url, { ...baseHeaders, Range: `${from}-${from + PAGE_SIZE - 1}` }, undefined);
    if (!Array.isArray(rows)) return rows;
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

async function supabaseFetch(method: string, table: string, url: string, headers: Record<string, string>, json: any) {
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: json ? JSON.stringify(json) : undefined });
  } catch (networkErr: any) {
    // Never log secrets, keys, or auth headers.
    console.error(`[Supabase Connection Error] Method: ${method} | Table: ${table} | Error:`, networkErr.message || networkErr);
    throw new Error(`Supabase Connection Error (${method} ${table}): ${networkErr.message || 'Network request failed'}`);
  }

  if (res.ok) {
    if (res.status === 204) return [];
    const text = await res.text();
    return text ? JSON.parse(text) : [];
  }

  const errorText = await res.text();
  let errorBody: any = errorText;
  try { errorBody = JSON.parse(errorText); } catch { /* keep string */ }

  console.error(
    `[Supabase Error] Method: ${method} | Table: ${table} | Status: ${res.status} | Body:`,
    typeof errorBody === 'object' ? JSON.stringify(errorBody) : errorBody
  );

  let detailMessage = `Supabase request failed with status ${res.status}`;
  if (typeof errorBody === 'object' && errorBody !== null) {
    const parts = [errorBody.message, errorBody.details, errorBody.hint, errorBody.error].filter(Boolean);
    if (parts.length > 0) detailMessage = parts.join(' - ');
  } else if (typeof errorText === 'string' && errorText.trim()) {
    detailMessage = errorText;
  }

  const err = new Error(`Supabase Error (${res.status}): ${detailMessage}`);
  (err as any).status = res.status;
  (err as any).supabaseError = errorBody;
  throw err;
}

// ---------------------------------------------------------------------------
// Local Memory + Disk DB Engine
// ---------------------------------------------------------------------------
function localRequest(method: string, table: string, options: RequestOptions = {}) {
  if (!memoryDb[table]) memoryDb[table] = [];
  const items = memoryDb[table];

  if (method === 'GET') {
    let result = [...items];
    const params = options.params || {};

    for (const [key, val] of Object.entries(params)) {
      if (val === undefined || val === null) continue;
      if (key === 'limit' || key === 'order' || key === 'select') continue;
      const strVal = String(val);
      if (strVal.startsWith('eq.')) {
        const target = strVal.slice(3);
        result = result.filter(item => String(item[key] ?? '') === target);
      } else if (strVal.startsWith('neq.')) {
        const target = strVal.slice(4);
        result = result.filter(item => String(item[key] ?? '') !== target);
      } else if (strVal.startsWith('gte.')) {
        const target = strVal.slice(4);
        result = result.filter(item => String(item[key] || '') >= target);
      } else if (strVal.startsWith('lte.')) {
        const target = strVal.slice(4);
        result = result.filter(item => String(item[key] || '') <= target);
      } else if (strVal.startsWith('gt.')) {
        const target = strVal.slice(3);
        result = result.filter(item => String(item[key] || '') > target);
      } else if (strVal.startsWith('lt.')) {
        const target = strVal.slice(3);
        result = result.filter(item => String(item[key] || '') < target);
      } else if (strVal.startsWith('ilike.*')) {
        const target = strVal.slice(7).replace(/\*$/, '').toLowerCase();
        result = result.filter(item => String(item[key] || '').toLowerCase().includes(target));
      }
    }

    if (params.order) {
      const [col, dir] = String(params.order).split(',')[0].split('.');
      result.sort((a, b) => {
        const va = a[col] ?? '';
        const vb = b[col] ?? '';
        if (va !== vb) {
          if (dir === 'desc') return va > vb ? -1 : 1;
          return va > vb ? 1 : -1;
        }
        const ca = a.created_at || '';
        const cb = b.created_at || '';
        return ca > cb ? -1 : ca < cb ? 1 : 0;
      });
    }

    if (params.limit) {
      const lim = parseInt(String(params.limit), 10);
      if (!isNaN(lim) && lim > 0) result = result.slice(0, lim);
    }
    return result;
  }

  if (method === 'POST') {
    const data = { ...options.json };
    if (!data.id) data.id = crypto.randomUUID();
    if (!data.created_at) data.created_at = new Date().toISOString();
    items.push(data);
    saveDiskDb();
    return [data];
  }

  const targetId = (() => {
    for (const [k, v] of Object.entries(options.params || {})) {
      if (k === 'id' && String(v).startsWith('eq.')) return String(v).slice(3);
    }
    return '';
  })();

  if (method === 'PATCH') {
    const idx = items.findIndex(item => item.id === targetId);
    if (idx !== -1) {
      items[idx] = { ...items[idx], ...options.json, updated_at: new Date().toISOString() };
      saveDiskDb();
      return [items[idx]];
    }
    return [];
  }

  if (method === 'DELETE') {
    const idx = items.findIndex(item => item.id === targetId);
    if (idx !== -1) {
      items.splice(idx, 1);
      saveDiskDb();
    }
    return [];
  }

  return [];
}

// ===========================================================================
// Public helpers
// ===========================================================================
export async function select(table: string, params: Record<string, any> = {}) {
  return await request('GET', table, { params: { select: '*', ...params } });
}

export async function selectOne(table: string, params: Record<string, any> = {}) {
  const rows = await select(table, { ...params, limit: 1 });
  return rows && rows.length > 0 ? rows[0] : null;
}

/** Insert and report which columns (if any) had to be dropped because the DB schema lacks them. */
export async function insertEx(table: string, data: any): Promise<{ row: any; dropped: string[] }> {
  const dropped: string[] = [];
  const rows = await request('POST', table, { json: data, prefer: 'return=representation', dropped });
  return { row: rows && rows.length > 0 ? rows[0] : null, dropped };
}

export async function insert(table: string, data: any) {
  return (await insertEx(table, data)).row;
}

/** Update and report which columns (if any) had to be dropped because the DB schema lacks them. */
export async function updateEx(table: string, params: Record<string, any>, data: any): Promise<{ row: any; dropped: string[] }> {
  const dropped: string[] = [];
  const rows = await request('PATCH', table, { params, json: data, prefer: 'return=representation', dropped });
  return { row: rows && rows.length > 0 ? rows[0] : null, dropped };
}

export async function update(table: string, params: Record<string, any>, data: any) {
  return (await updateEx(table, params, data)).row;
}

export async function remove(table: string, params: Record<string, any>) {
  return await request('DELETE', table, { params, prefer: 'return=representation' });
}

// ===========================================================================
// Supabase Storage (public buckets, e.g. company logo)
// ===========================================================================
const bucketsReady = new Set<string>();

async function ensureBucket(bucket: string) {
  if (bucketsReady.has(bucket)) return;
  const c = config();
  const res = await fetch(`${c.base}/storage/v1/bucket`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id: bucket, name: bucket, public: true }),
  });
  // 409 = already exists — fine
  if (!res.ok && res.status !== 409) {
    const txt = await res.text();
    if (!/already exists/i.test(txt)) throw new Error(`Could not create storage bucket '${bucket}' (${res.status}): ${txt}`);
  }
  bucketsReady.add(bucket);
}

/** Upload bytes to a public bucket and return the public URL. */
export async function uploadPublicFile(bucket: string, objectPath: string, body: Uint8Array, contentType: string): Promise<string> {
  const c = config();
  if (!c.enabled) throw new Error('Supabase storage is not configured.');
  await ensureBucket(bucket);
  const res = await fetch(`${c.base}/storage/v1/object/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': contentType, 'x-upsert': 'true', 'Cache-Control': 'public, max-age=31536000' }),
    body: body as any,
  });
  if (!res.ok) {
    throw new Error(`Storage upload failed (${res.status}): ${await res.text()}`);
  }
  return `${c.base}/storage/v1/object/public/${bucket}/${objectPath}`;
}
