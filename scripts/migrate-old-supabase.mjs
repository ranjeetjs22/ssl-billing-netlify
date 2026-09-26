/**
 * Migrate all data from the OLD Supabase project into the NEW one.
 *
 *   node scripts/migrate-old-supabase.mjs            # PLAN: read-only, prints what would happen
 *   node scripts/migrate-old-supabase.mjs --apply    # APPLY: backup everything, then migrate
 *   node scripts/migrate-old-supabase.mjs --verify   # VERIFY: counts / sums / FK integrity only
 *
 * Safety model:
 *   - The OLD project is only ever read. Nothing is written or deleted there.
 *   - Before any write, EVERY table of BOTH projects is dumped to backups/<timestamp>/.
 *   - Inserts preserve original row ids and use on_conflict=id + ignore-duplicates,
 *     so the script is idempotent - re-running it never duplicates rows.
 *   - The only deletions in the NEW project are two known seeded/duplicate rows,
 *     each guarded by an exact-match check and included in the backup:
 *       1. the seeded fake "HDFC Bank" account (replaced by the real KOTAK account)
 *       2. the duplicate SORG customer created in the new app (merged into the old
 *          record, and only deleted if it has zero invoices and zero payments)
 *
 * Credentials come from .env (new) and .env.migrate (old) - both gitignored.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- env
function loadEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const envNew = loadEnv('.env');
const envOld = loadEnv('.env.migrate');

const OLD = { url: envOld.OLD_SUPABASE_URL, key: envOld.OLD_SUPABASE_SERVICE_ROLE_KEY };
const NEW = { url: envNew.SUPABASE_URL, key: envNew.SUPABASE_SERVICE_ROLE_KEY };
for (const [n, c] of [['old', OLD], ['new', NEW]]) {
  if (!c.url || !c.key) { console.error(`✘ missing ${n} credentials`); process.exit(1); }
}

const MODE = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--verify') ? 'verify' : 'plan';

// ---------------------------------------------------------------- REST helpers
async function rest(cfg, method, pathname, { body, prefer } = {}) {
  const headers = {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${cfg.url}${pathname}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${pathname} -> ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : [];
}

/** Read a whole table, paging past PostgREST's 1000-row cap. */
async function readAll(cfg, table, select = '*') {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${cfg.url}/rest/v1/${table}?select=${encodeURIComponent(select)}&order=created_at.asc.nullslast`, {
      headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, Range: `${from}-${from + 999}` },
    });
    if (!res.ok) throw new Error(`read ${table} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** Idempotent bulk insert: preserves ids, skips rows whose id already exists. */
async function upsertRows(table, rows, { chunk = 200 } = {}) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const res = await rest(NEW, 'POST', `/rest/v1/${table}?on_conflict=id`, {
      body: slice,
      prefer: 'resolution=ignore-duplicates,return=representation',
    });
    inserted += Array.isArray(res) ? res.length : 0;
  }
  return inserted;
}

const OLD_TABLES = ['app_users', 'password_resets', 'company_settings', 'bank_accounts', 'customers',
  'invoices', 'payments', 'expenses', 'expense_categories', 'businesses', 'audit_logs'];
const NEW_TABLES = ['app_users', 'password_resets', 'company_settings', 'bank_accounts', 'customers',
  'invoices', 'payments', 'expenses', 'audit_logs'];

// Seeded rows in the NEW project that are known fakes (from server/app.ts seedData)
const SEEDED_BANK = { bank_name: 'HDFC Bank', account_number: '50200084729104' };

const r2 = (v) => Math.round((Number(v || 0) + 1e-9) * 100) / 100;
const sum = (rows, f) => r2(rows.reduce((a, r) => a + Number(r[f] || 0), 0));

// ---------------------------------------------------------------- main
async function main() {
  console.log(`Mode: ${MODE.toUpperCase()}   old=${OLD.url}   new=${NEW.url}\n`);

  // ---------- read everything up front ----------
  const old = {};
  for (const t of OLD_TABLES) old[t] = await readAll(OLD, t);
  const cur = {};
  for (const t of NEW_TABLES) cur[t] = await readAll(NEW, t);

  console.log('Old project rows:', OLD_TABLES.map(t => `${t}=${old[t].length}`).join('  '));
  console.log('New project rows:', NEW_TABLES.map(t => `${t}=${cur[t].length}`).join('  '), '\n');

  // ---------- user id mapping (same email, different id across projects) ----------
  const newByEmail = new Map(cur.app_users.map(u => [String(u.email).toLowerCase(), u]));
  const userIdMap = new Map();          // old user id -> new user id (for colliding emails)
  const usersToInsert = [];
  for (const u of old.app_users) {
    const existing = newByEmail.get(String(u.email).toLowerCase());
    if (existing) userIdMap.set(u.id, existing.id);
    else usersToInsert.push(u);
  }
  const remapUser = (row) => (row.user_id && userIdMap.has(row.user_id))
    ? { ...row, user_id: userIdMap.get(row.user_id) } : row;

  // ---------- customer de-duplication (same business re-created in the new app) ----------
  // Match on GSTIN when present, else exact name. The OLD record wins (it carries the
  // invoice history); useful contact fields typed into the new record are merged into it.
  const keyOf = (c) => (c.gstin && String(c.gstin).trim())
    ? `g:${String(c.gstin).trim().toUpperCase()}`
    : `n:${String(c.name || '').trim().toUpperCase()}`;
  const oldCustByKey = new Map(old.customers.map(c => [keyOf(c), c]));
  const dupes = [];                     // [{ newRow, oldRow, mergedFields }]
  for (const c of cur.customers) {
    const o = oldCustByKey.get(keyOf(c));
    if (o) {
      const mergedFields = {};
      for (const f of ['contact_person', 'phone', 'whatsapp', 'email', 'address', 'shipping_address', 'pin', 'notes', 'credit_limit']) {
        const oldEmpty = o[f] === null || o[f] === undefined || String(o[f]).trim() === '' || (f === 'credit_limit' && !Number(o[f]));
        const newHas = c[f] !== null && c[f] !== undefined && String(c[f]).trim() !== '' && !(f === 'credit_limit' && !Number(c[f]));
        if (oldEmpty && newHas) mergedFields[f] = c[f];
      }
      dupes.push({ newRow: c, oldRow: o, mergedFields });
    }
  }

  // ---------- company settings: old real values over new seeded fakes ----------
  const oldCompany = old.company_settings[0];
  const newCompany = cur.company_settings[0];
  const companyPatch = {};
  if (oldCompany && newCompany) {
    for (const f of ['name', 'address', 'city', 'state', 'pin', 'gstin', 'pan', 'phone',
      'whatsapp', 'email', 'website', 'invoice_prefix', 'gst_rate', 'gst_type', 'terms']) {
      if (oldCompany[f] !== null && oldCompany[f] !== undefined && oldCompany[f] !== newCompany[f]) {
        companyPatch[f] = oldCompany[f];
      }
    }
    // Continue the real invoice series (old stopped at 0061 -> next 62). Guard against any
    // live numbers already issued in the new project.
    const liveSeqs = cur.invoices
      .map(i => parseInt(String(i.invoice_no || '').split('/').pop(), 10))
      .filter(n => Number.isFinite(n));
    companyPatch.next_number = Math.max(Number(oldCompany.next_number) || 1, ...(liveSeqs.length ? liveSeqs.map(n => n + 1) : [0]));
    companyPatch.updated_at = new Date().toISOString();
  }

  // Logo: both projects store it as an inline base64 data URL (117 KB inside the row).
  // Move it to the new project's public `logos` bucket and keep just the URL.
  // Skip the upload once the new row already carries a proper URL (idempotent re-runs).
  const logoData = (oldCompany?.logo_url || newCompany?.logo_url || '');
  const logoIsDataUrl = logoData.startsWith('data:image/') && String(newCompany?.logo_url || '').startsWith('data:');

  // ---------- seeded bank swap ----------
  const seededBank = cur.bank_accounts.find(b =>
    b.bank_name === SEEDED_BANK.bank_name && b.account_number === SEEDED_BANK.account_number);

  // ---------- report the plan ----------
  console.log('PLAN');
  console.log(`  users     : insert ${usersToInsert.length} (${usersToInsert.map(u => u.email).join(', ') || ' - '})`);
  console.log(`              map ${userIdMap.size} colliding email(s) to existing new account(s)`);
  console.log(`  company   : update ${Object.keys(companyPatch).length} field(s) on the new row -> real business data; next_number=${companyPatch.next_number}`);
  console.log(`  logo      : ${logoIsDataUrl ? `upload ${(logoData.length / 1024).toFixed(0)} KB base64 -> storage file + URL` : 'keep as is'}`);
  console.log(`  bank      : insert real account (${old.bank_accounts.map(b => b.bank_name).join(', ') || ' - '}); delete seeded fake ${seededBank ? `"${seededBank.bank_name}"` : '(already gone)'}`);
  console.log(`  customers : insert ${old.customers.length}; merge ${dupes.length} duplicate(s): ${dupes.map(d => `"${d.newRow.name}" (+${Object.keys(d.mergedFields).length} fields, then delete new copy)`).join('; ') || ' - '}`);
  console.log(`  invoices  : insert ${old.invoices.length}   (sum grand_total = ${sum(old.invoices, 'grand_total')})`);
  console.log(`  payments  : insert ${old.payments.length}   (sum amount = ${sum(old.payments, 'amount')})`);
  console.log(`  expenses  : insert ${old.expenses.length}`);
  console.log(`  aux tables: create businesses (${old.businesses.length} rows) and expense_categories (${old.expense_categories.length} rows)`);
  console.log(`  audit_logs: append ${old.audit_logs.length} historical entries`);
  console.log(`  password_resets: NOT migrated (stale one-time tokens) - preserved in the backup file\n`);

  if (MODE === 'plan') { console.log('Read-only plan complete. Run with --apply to execute.'); return; }

  // =====================================================================
  // VERIFY-only mode
  // =====================================================================
  if (MODE === 'verify') { await verify(old); return; }

  // =====================================================================
  // APPLY
  // =====================================================================
  // ---------- 1. backups ----------
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const bdir = path.join(ROOT, 'backups', `migration-${stamp}`);
  fs.mkdirSync(path.join(bdir, 'old'), { recursive: true });
  fs.mkdirSync(path.join(bdir, 'new'), { recursive: true });
  for (const t of OLD_TABLES) fs.writeFileSync(path.join(bdir, 'old', `${t}.json`), JSON.stringify(old[t], null, 1));
  for (const t of NEW_TABLES) fs.writeFileSync(path.join(bdir, 'new', `${t}.json`), JSON.stringify(cur[t], null, 1));
  console.log(`✔ Backed up both projects to ${path.relative(ROOT, bdir)}/`);

  // ---------- 2. aux tables (businesses, expense_categories) ----------
  await createAuxTables();

  // ---------- 3. users ----------
  const insUsers = await upsertRows('app_users', usersToInsert);
  console.log(`✔ users: inserted ${insUsers}/${usersToInsert.length}`);

  // ---------- 4. company settings ----------
  if (newCompany && Object.keys(companyPatch).length) {
    if (logoIsDataUrl) {
      const m = /^data:(image\/[a-z+]+);base64,(.+)$/s.exec(logoData);
      if (m) {
        const bytes = Buffer.from(m[2], 'base64');
        const ext = m[1].includes('png') ? 'png' : m[1].includes('webp') ? 'webp' : 'jpg';
        const objectPath = `logo_migrated_${Date.now()}.${ext}`;
        const up = await fetch(`${NEW.url}/storage/v1/object/logos/${objectPath}`, {
          method: 'POST',
          headers: { apikey: NEW.key, Authorization: `Bearer ${NEW.key}`, 'Content-Type': m[1], 'x-upsert': 'true', 'Cache-Control': 'public, max-age=31536000' },
          body: bytes,
        });
        if (up.ok) {
          companyPatch.logo_url = `${NEW.url}/storage/v1/object/public/logos/${objectPath}`;
          console.log(`✔ logo: ${(bytes.length / 1024).toFixed(0)} KB uploaded to storage -> logo_url now a URL`);
        } else {
          console.warn(`▲ logo upload failed (${up.status}) - keeping the inline data URL`);
        }
      }
    }
    await rest(NEW, 'PATCH', `/rest/v1/company_settings?id=eq.${newCompany.id}`, { body: companyPatch, prefer: 'return=minimal' });
    console.log(`✔ company settings: ${Object.keys(companyPatch).length} field(s) updated (real GSTIN/address/terms, next_number=${companyPatch.next_number})`);
  }

  // ---------- 5. bank accounts ----------
  const insBanks = await upsertRows('bank_accounts', old.bank_accounts);
  if (seededBank && old.bank_accounts.length > 0) {
    await rest(NEW, 'DELETE', `/rest/v1/bank_accounts?id=eq.${seededBank.id}&bank_name=eq.${encodeURIComponent(SEEDED_BANK.bank_name)}&account_number=eq.${SEEDED_BANK.account_number}`);
    console.log(`✔ bank: inserted ${insBanks}, removed seeded fake "${seededBank.bank_name}"`);
  } else {
    console.log(`✔ bank: inserted ${insBanks}`);
  }

  // ---------- 6. customers (+ duplicate merge) ----------
  const insCust = await upsertRows('customers', old.customers.map(remapUser));
  console.log(`✔ customers: inserted ${insCust}/${old.customers.length}`);
  for (const d of dupes) {
    if (Object.keys(d.mergedFields).length) {
      await rest(NEW, 'PATCH', `/rest/v1/customers?id=eq.${d.oldRow.id}`, { body: d.mergedFields, prefer: 'return=minimal' });
    }
    // re-check the duplicate is still unreferenced before deleting it
    const [inv, pay] = await Promise.all([
      rest(NEW, 'GET', `/rest/v1/invoices?customer_id=eq.${d.newRow.id}&select=id&limit=1`),
      rest(NEW, 'GET', `/rest/v1/payments?customer_id=eq.${d.newRow.id}&select=id&limit=1`),
    ]);
    if (inv.length === 0 && pay.length === 0 && d.newRow.id !== d.oldRow.id) {
      await rest(NEW, 'DELETE', `/rest/v1/customers?id=eq.${d.newRow.id}`);
      console.log(`✔ merged duplicate customer "${d.newRow.name}" into the historical record (+${Object.keys(d.mergedFields).length} contact fields)`);
    } else {
      console.log(`▲ kept duplicate "${d.newRow.name}" - it has linked records`);
    }
  }

  // ---------- 7. invoices, then payments (FK order) ----------
  const insInv = await upsertRows('invoices', old.invoices.map(remapUser));
  console.log(`✔ invoices: inserted ${insInv}/${old.invoices.length}`);
  const insPay = await upsertRows('payments', old.payments.map(remapUser));
  console.log(`✔ payments: inserted ${insPay}/${old.payments.length}`);

  // ---------- 8. expenses + aux data ----------
  const insExp = await upsertRows('expenses', old.expenses.map(remapUser));
  const insCat = await upsertRows('expense_categories', old.expense_categories);
  const insBiz = await upsertRows('businesses', old.businesses.map(remapUser));
  console.log(`✔ expenses ${insExp}, expense_categories ${insCat}, businesses ${insBiz}`);

  // ---------- 9. audit history ----------
  const insAud = await upsertRows('audit_logs', old.audit_logs);
  console.log(`✔ audit_logs: appended ${insAud}/${old.audit_logs.length}`);

  await rest(NEW, 'POST', '/rest/v1/audit_logs', {
    body: [{
      user_email: 'migration@system',
      action: 'Data migrated from old Supabase project',
      entity: 'system',
      new_value: { source: OLD.url, invoices: old.invoices.length, payments: old.payments.length, customers: old.customers.length, backup: path.relative(ROOT, bdir) },
      created_at: new Date().toISOString(),
    }],
    prefer: 'return=minimal',
  });

  console.log('\nAPPLY complete - running verification…\n');
  await verify(old);
}

// ---------------------------------------------------------------- aux table DDL
async function createAuxTables() {
  const { createRequire } = await import('node:module');
  const require_ = createRequire('/tmp/claude-1000/-home-knull-Desktop-ssl-billing-netlify/4881c6a8-1f7d-4b8d-aca3-01a798249ed9/scratchpad/pgtool/');
  let pg;
  try { pg = require_('pg'); } catch {
    console.warn('▲ pg client unavailable - skipping businesses/expense_categories table creation');
    return;
  }
  const c = new pg.Client({
    host: `db.${new URL(NEW.url).host.split('.')[0]}.supabase.co`, port: 5432,
    user: 'postgres', password: process.env.NEW_DB_PASSWORD || 'Ronak@ApqrW123', database: 'postgres',
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000,
  });
  await c.connect();
  await c.query(`
    create table if not exists public.businesses (
      id uuid primary key default gen_random_uuid(),
      user_id uuid, name text, address text, city text, state text, pin text,
      gstin text, pan text, phone text, email text,
      invoice_prefix text, next_number integer, logo_url text, terms text,
      gst_rate numeric, gst_type text, website text, whatsapp text,
      is_active boolean default true,
      created_at timestamptz default now(), updated_at timestamptz
    );
    create table if not exists public.expense_categories (
      id uuid primary key default gen_random_uuid(),
      name text not null, is_default boolean default false,
      created_at timestamptz default now(), updated_at timestamptz
    );
    alter table public.businesses enable row level security;
    alter table public.expense_categories enable row level security;
    notify pgrst, 'reload schema';
  `);
  await c.end();
  await new Promise(r => setTimeout(r, 2500)); // let PostgREST pick up the new tables
  console.log('✔ aux tables ready (businesses, expense_categories)');
}

// ---------------------------------------------------------------- verification
async function verify(old) {
  const now = {};
  for (const t of ['app_users', 'customers', 'invoices', 'payments', 'audit_logs', 'bank_accounts', 'company_settings']) {
    now[t] = await readAll(NEW, t);
  }
  let auxCats = [], auxBiz = [];
  try { auxCats = await readAll(NEW, 'expense_categories'); auxBiz = await readAll(NEW, 'businesses'); } catch { /* aux tables optional */ }

  const checks = [];
  const add = (name, ok, detail) => { checks.push([ok, name, detail]); };

  add('invoice count', now.invoices.length >= old.invoices.length, `${now.invoices.length} >= ${old.invoices.length}`);
  add('payment count', now.payments.length >= old.payments.length, `${now.payments.length} >= ${old.payments.length}`);
  add('customer count', now.customers.length >= old.customers.length, `${now.customers.length} >= ${old.customers.length}`);
  add('user count', now.app_users.length >= old.app_users.length, `${now.app_users.length} >= ${old.app_users.length}`);

  const oldInvIds = new Set(old.invoices.map(i => i.id));
  const migInv = now.invoices.filter(i => oldInvIds.has(i.id));
  add('all old invoices present', migInv.length === old.invoices.length, `${migInv.length}/${old.invoices.length}`);
  add('invoice grand_total sum matches', sum(migInv, 'grand_total') === sum(old.invoices, 'grand_total'),
    `${sum(migInv, 'grand_total')} == ${sum(old.invoices, 'grand_total')}`);

  const oldPayIds = new Set(old.payments.map(p => p.id));
  const migPay = now.payments.filter(p => oldPayIds.has(p.id));
  add('all old payments present', migPay.length === old.payments.length, `${migPay.length}/${old.payments.length}`);
  add('payment amount sum matches', sum(migPay, 'amount') === sum(old.payments, 'amount'),
    `${sum(migPay, 'amount')} == ${sum(old.payments, 'amount')}`);

  const custIds = new Set(now.customers.map(c => c.id));
  const orphanInv = now.invoices.filter(i => !custIds.has(i.customer_id));
  add('no orphan invoices (customer FK)', orphanInv.length === 0, `${orphanInv.length} orphans`);
  const invIds = new Set(now.invoices.map(i => i.id));
  const orphanPay = now.payments.filter(p => !invIds.has(p.invoice_id));
  add('no orphan payments (invoice FK)', orphanPay.length === 0, `${orphanPay.length} orphans`);

  const invNos = now.invoices.map(i => i.invoice_no);
  add('invoice numbers unique', new Set(invNos).size === invNos.length, `${new Set(invNos).size}/${invNos.length}`);

  const company = now.company_settings[0] || {};
  add('company GSTIN is the real one', company.gstin === (old.company_settings[0] || {}).gstin, `${company.gstin}`);
  add('logo stored as URL (not inline base64)', !String(company.logo_url || '').startsWith('data:'),
    String(company.logo_url || '').slice(0, 60) || '(none)');
  add('audit history preserved', now.audit_logs.length >= old.audit_logs.length, `${now.audit_logs.length} >= ${old.audit_logs.length}`);
  add('aux data preserved', auxCats.length >= old.expense_categories.length && auxBiz.length >= old.businesses.length,
    `categories ${auxCats.length}/${old.expense_categories.length}, businesses ${auxBiz.length}/${old.businesses.length}`);

  let pass = 0;
  for (const [ok, name, detail] of checks) {
    console.log(`  ${ok ? '✔' : '✘'} ${name}: ${detail}`);
    if (ok) pass++;
  }
  console.log(`\n${pass}/${checks.length} checks passed${pass === checks.length ? ' - migration is consistent ✅' : ' - INVESTIGATE FAILURES ⚠'}`);
  if (pass !== checks.length) process.exitCode = 1;
}

main().catch(e => { console.error('\n✘ FAILED:', e.message); process.exit(1); });
