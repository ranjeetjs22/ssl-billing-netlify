-- Per-customer rate charts.
-- One row per customer holding a FULL, independent copy of the global rate card
-- (zone matrix, special lanes and charge settings) taken when it was created or
-- last reset. Later edits to the global card do not touch it.
-- id = the customer's id, so the row can be read and patched by primary key.
-- Idempotent: safe to re-run.

create table if not exists public.customer_rate_cards (
  id            uuid primary key,                       -- = customers.id
  customer_id   uuid not null unique references public.customers(id) on delete cascade,
  use_custom    boolean not null default true,          -- false = this customer is billed on the global card
  matrix        jsonb not null default '[]'::jsonb,     -- [{origin_zone, dest_zone, rate_per_kg}]
  specials      jsonb not null default '[]'::jsonb,     -- [{id, origin_kind, origin_value, dest_kind, dest_value, rate_per_kg, note, is_active}]
  settings      jsonb not null default '{}'::jsonb,     -- {key: {value, text_value, min_value, max_value}}
  copied_at     timestamptz,                            -- when the snapshot was taken from the global card
  updated_at    timestamptz,
  created_at    timestamptz not null default now()
);

alter table public.customer_rate_cards enable row level security;

notify pgrst, 'reload schema';
