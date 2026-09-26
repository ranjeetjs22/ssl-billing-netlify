-- SSL Billing - full schema for a fresh Supabase project.
-- Idempotent: safe to re-run. Run in the Supabase SQL editor or via psql.
-- The app talks to these tables with the service-role key (bypasses RLS);
-- RLS is enabled with NO policies so the anon/publishable key cannot read anything.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- users
create table if not exists public.app_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  full_name     text default '',
  role          text not null default 'staff' check (role in ('admin','staff','accountant')),
  is_active     boolean not null default true,
  last_login    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz
);

create table if not exists public.password_resets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.app_users(id) on delete cascade,
  token      text not null unique,
  expires_at timestamptz not null,
  used       boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- company
create table if not exists public.company_settings (
  id               uuid primary key default gen_random_uuid(),
  name             text not null default 'SHREE SANWARIYA LOGISTICS',
  logo_url         text,
  address          text, city text, state text, pin text,
  gstin            text, pan text,
  phone            text, whatsapp text, email text, website text,
  invoice_prefix   text default 'SSL',
  next_number      integer default 1,
  gst_rate         numeric default 18,
  gst_type         text default 'cgst_sgst',
  terms            text,
  gst_api_key      text, gst_api_provider text, gst_api_url text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz
);

create table if not exists public.bank_accounts (
  id             uuid primary key default gen_random_uuid(),
  account_holder text not null default '',
  bank_name      text not null default '',
  account_number text not null default '',
  ifsc           text, branch text, upi_id text,
  is_default     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz
);

-- ---------------------------------------------------------------- customers
create table if not exists public.customers (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid,
  name             text not null,
  contact_person   text,
  address          text, shipping_address text,
  city             text, state text, pin text,
  gstin            text, pan text,
  phone            text, whatsapp text, email text,
  payment_terms    text,
  credit_days      integer default 0,
  credit_limit     numeric default 0,
  is_active        boolean not null default true,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz
);

-- ---------------------------------------------------------------- invoices
create table if not exists public.invoices (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid,
  customer_id       uuid not null references public.customers(id) on delete restrict,
  invoice_no        text not null,
  invoice_date      date not null default current_date,
  buyer             jsonb default '{}'::jsonb,
  ship_to           jsonb default '{}'::jsonb,
  seller            jsonb default '{}'::jsonb,
  same_as_buyer     boolean default true,
  lr_no             text default '',
  lr_items          jsonb default '[]'::jsonb,       -- multiple LRs on one bill
  shipment_date     date,
  origin            text default '',
  destination       text default '',
  vehicle_no        text default '',
  weight            numeric default 0,
  rate_kg           numeric default 0,
  dimensions        text default '',
  sac               text default '996511',
  place_of_supply   text,
  freight           numeric default 0,
  fuel_surcharge_pct numeric default 0,
  fuel_hike_pct     numeric default 0,
  processing        numeric default 0,
  insurance_amt     numeric default 0,
  extra_charges     jsonb default '[]'::jsonb,
  additional_total  numeric default 0,
  discount_type     text default 'percent',
  discount_value    numeric default 0,
  discount_amount   numeric default 0,
  gst_type          text default 'intra',
  gst_rate          numeric default 18,
  taxable_amount    numeric default 0,
  gst_amount        numeric default 0,
  cgst              numeric default 0,
  sgst              numeric default 0,
  igst              numeric default 0,
  round_off         numeric default 0,
  grand_total       numeric default 0,
  payment_terms     text,
  due_date          date,
  terms             text,
  notes             text,
  status            text not null default 'pending',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz
);
create unique index if not exists invoices_invoice_no_key on public.invoices (invoice_no);

-- ---------------------------------------------------------------- payments
create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid,
  invoice_id   uuid not null references public.invoices(id) on delete cascade,
  customer_id  uuid,
  payment_date date not null default current_date,
  amount       numeric not null default 0,
  method       text not null default 'Bank Transfer',
  reference    text default '',
  notes        text default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

-- ---------------------------------------------------------------- expenses (dashboard)
create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid,
  expense_date date not null default current_date,
  category     text,
  description  text,
  amount       numeric not null default 0,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

-- ---------------------------------------------------------------- audit trail
create table if not exists public.audit_logs (
  id         uuid primary key default gen_random_uuid(),
  user_email text,
  action     text not null,
  entity     text,
  entity_id  text,
  old_value  jsonb,
  new_value  jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- indexes
create index if not exists customers_name_idx        on public.customers (lower(name));
create index if not exists customers_gstin_idx       on public.customers (gstin);
create index if not exists invoices_customer_idx     on public.invoices (customer_id);
create index if not exists invoices_date_idx         on public.invoices (invoice_date desc, created_at desc);
create index if not exists invoices_status_idx       on public.invoices (status);
create index if not exists payments_invoice_idx      on public.payments (invoice_id);
create index if not exists payments_date_idx         on public.payments (payment_date desc);
create index if not exists audit_logs_created_idx    on public.audit_logs (created_at desc);
create index if not exists password_resets_token_idx on public.password_resets (token);

-- ---------------------------------------------------------------- lock down
alter table public.app_users        enable row level security;
alter table public.password_resets  enable row level security;
alter table public.company_settings enable row level security;
alter table public.bank_accounts    enable row level security;
alter table public.customers        enable row level security;
alter table public.invoices         enable row level security;
alter table public.payments         enable row level security;
alter table public.expenses         enable row level security;
alter table public.audit_logs       enable row level security;

notify pgrst, 'reload schema';
