-- SSL Billing — schema catch-up migration
-- Safe to run multiple times (every statement is idempotent).
-- Run in the Supabase SQL editor (Dashboard → SQL → New query → Run).

-- Customers: fields captured by the "Register Customer" / "Quick Add Customer" forms
alter table public.customers add column if not exists contact_person   text;
alter table public.customers add column if not exists whatsapp         text;
alter table public.customers add column if not exists shipping_address text;
alter table public.customers add column if not exists credit_limit     numeric default 0;
alter table public.customers add column if not exists notes            text;
alter table public.customers add column if not exists user_id          uuid;

-- Invoices: multiple LR / consignment lines on one bill, optional vehicle number
alter table public.invoices  add column if not exists lr_items         jsonb default '[]'::jsonb;
alter table public.invoices  add column if not exists vehicle_no       text;
alter table public.invoices  add column if not exists dimensions       text;
alter table public.invoices  add column if not exists seller           jsonb;

-- Payments: audit trail of who recorded the receipt
alter table public.payments  add column if not exists user_id          uuid;
alter table public.payments  add column if not exists notes            text;

-- Ask PostgREST to refresh its schema cache immediately
notify pgrst, 'reload schema';
