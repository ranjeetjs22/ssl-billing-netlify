-- SSL Billing - Rate Calculator
-- Zone-wise base rates, special rates (SPR), charge configuration and ODA slabs,
-- taken from SSL_Rate_card.pdf + the zone list. Idempotent: safe to re-run.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- zones
create table if not exists public.rate_zones (
  code        text primary key,               -- N1, N2, E, NE, W1, W2, S1, S2, Central
  name        text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

-- Which state belongs to which zone (a state maps to exactly one zone)
create table if not exists public.rate_states (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  zone_code   text not null references public.rate_zones(code) on delete restrict,
  created_at  timestamptz not null default now()
);

-- Named cities. A city inherits its state's zone but can carry its own special rates.
create table if not exists public.rate_cities (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  state_name  text not null,
  zone_code   text not null references public.rate_zones(code) on delete restrict,
  ref_id      integer,                        -- "ID Mapping" column from the rate card
  is_metro    boolean not null default false, -- fuel-hike reference cities (IDs 1-4)
  created_at  timestamptz not null default now(),
  unique (name, state_name)
);

-- ---------------------------------------------------------------- base matrix
-- The "conditional / basic" rate: origin zone x destination zone, Rs per kg.
create table if not exists public.rate_matrix (
  id            uuid primary key default gen_random_uuid(),
  origin_zone   text not null references public.rate_zones(code) on delete cascade,
  dest_zone     text not null references public.rate_zones(code) on delete cascade,
  rate_per_kg   numeric not null,
  updated_at    timestamptz,
  created_at    timestamptz not null default now(),
  unique (origin_zone, dest_zone)
);

-- ---------------------------------------------------------------- special rates (SPR)
-- Overrides the base matrix. `kind` says how the value is matched; the most
-- specific match wins (see rate_priority()).
create table if not exists public.rate_special (
  id            uuid primary key default gen_random_uuid(),
  origin_kind   text not null check (origin_kind in ('zone', 'state', 'city')),
  origin_value  text not null,
  dest_kind     text not null check (dest_kind in ('zone', 'state', 'city')),
  dest_value    text not null,
  rate_per_kg   numeric not null,
  note          text,
  is_active     boolean not null default true,
  updated_at    timestamptz,
  created_at    timestamptz not null default now(),
  unique (origin_kind, origin_value, dest_kind, dest_value)
);

-- ---------------------------------------------------------------- charge settings
create table if not exists public.rate_settings (
  key         text primary key,
  value       numeric,
  text_value  text,
  unit        text,                -- LR | per kg | %age | base_kg | Rs. per litre | days
  min_value   numeric,
  max_value   numeric,
  remark      text,
  updated_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- ODA slabs
create table if not exists public.rate_oda (
  id            uuid primary key default gen_random_uuid(),
  lower_kg      numeric not null default 0,
  upper_kg      numeric not null default 9999999999,
  per_kg        numeric not null default 0,
  min_amount    numeric not null default 0,
  max_amount    numeric,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------- saved quotes
create table if not exists public.rate_quotes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid,
  customer_id     uuid,
  origin_label    text,
  dest_label      text,
  origin_zone     text,
  dest_zone       text,
  dead_weight     numeric,
  volumetric_weight numeric,
  chargeable_weight numeric,
  declared_value  numeric,
  boxes           integer,
  rate_per_kg     numeric,
  rate_source     text,             -- 'matrix' | 'special'
  breakdown       jsonb,            -- full line-item breakup
  grand_total     numeric,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------- indexes
create index if not exists rate_states_zone_idx   on public.rate_states (zone_code);
create index if not exists rate_cities_name_idx   on public.rate_cities (lower(name));
create index if not exists rate_cities_zone_idx   on public.rate_cities (zone_code);
create index if not exists rate_special_dest_idx  on public.rate_special (dest_kind, dest_value);
create index if not exists rate_special_orig_idx  on public.rate_special (origin_kind, origin_value);
create index if not exists rate_quotes_created_idx on public.rate_quotes (created_at desc);

-- ---------------------------------------------------------------- lock down
alter table public.rate_zones    enable row level security;
alter table public.rate_states   enable row level security;
alter table public.rate_cities   enable row level security;
alter table public.rate_matrix   enable row level security;
alter table public.rate_special  enable row level security;
alter table public.rate_settings enable row level security;
alter table public.rate_oda      enable row level security;
alter table public.rate_quotes   enable row level security;

-- =====================================================================
-- SEED DATA (from SSL_Rate_card.pdf + zone list)
-- =====================================================================

insert into public.rate_zones (code, name, sort_order) values
  ('N1', 'North 1', 1), ('N2', 'North 2', 2), ('E', 'East', 3), ('NE', 'North East', 4),
  ('W1', 'West 1', 5),  ('W2', 'West 2', 6),  ('S1', 'South 1', 7), ('S2', 'South 2', 8),
  ('Central', 'Central', 9)
on conflict (code) do update set name = excluded.name, sort_order = excluded.sort_order;

insert into public.rate_states (name, zone_code) values
  ('Delhi','N1'), ('New Delhi','N1'), ('Uttar Pradesh','N1'), ('Haryana','N1'), ('Rajasthan','N1'),
  ('Chandigarh','N2'), ('Punjab','N2'), ('Himachal Pradesh','N2'), ('Jammu & Kashmir','N2'),
    ('Uttarakhand','N2'), ('Ladakh','N2'),
  ('Bihar','E'), ('Odisha','E'), ('Jharkhand','E'), ('West Bengal','E'),
  ('Arunachal Pradesh','NE'), ('Assam','NE'), ('Manipur','NE'), ('Meghalaya','NE'),
    ('Mizoram','NE'), ('Nagaland','NE'), ('Sikkim','NE'), ('Tripura','NE'),
  ('Gujarat','W1'), ('Daman & Diu','W1'), ('Dadra & Nagar Haveli','W1'),
  ('Maharashtra','W2'), ('Goa','W2'),
  ('Andhra Pradesh','S1'), ('Karnataka','S1'), ('Telangana','S1'), ('Tamil Nadu','S1'),
    ('Pondicherry','S1'), ('Andaman & Nicobar','S1'),
  ('Kerala','S2'),
  ('Madhya Pradesh','Central'), ('Chattisgarh','Central')
on conflict (name) do update set zone_code = excluded.zone_code;

insert into public.rate_cities (name, state_name, zone_code, ref_id, is_metro) values
  ('Mumbai','Maharashtra','W2',1,true), ('Chennai','Tamil Nadu','S1',2,true),
  ('Delhi','Delhi','N1',3,true), ('Kolkata','West Bengal','E',4,true),
  ('Ahmedabad','Gujarat','W1',5,false), ('Bengaluru','Karnataka','S1',6,false),
  ('Chandigarh','Chandigarh','N2',7,false), ('Gurgaon','Haryana','N1',8,false),
  ('Noida','Uttar Pradesh','N1',10,false), ('Patna','Bihar','E',11,false),
  ('Pondicherry','Pondicherry','S1',12,false), ('Pune','Maharashtra','W2',13,false),
  ('Bhopal','Madhya Pradesh','Central',14,false), ('Bhubhaneswar','Odisha','E',15,false),
  ('Gandhinagar','Gujarat','W1',16,false), ('Guwahati','Assam','NE',17,false),
  ('Hyderabad','Telangana','S1',18,false), ('Indore','Madhya Pradesh','Central',19,false),
  ('Kanpur','Uttar Pradesh','N1',20,false), ('Lucknow','Uttar Pradesh','N1',21,false),
  ('Nagpur','Maharashtra','W2',22,false), ('Panjim','Goa','W2',23,false),
  ('Raipur','Chattisgarh','Central',24,false), ('Ranchi','Jharkhand','E',25,false),
  ('Trivandrum','Kerala','S2',26,false), ('Agartala','Tripura','NE',27,false),
  ('Aizwal','Mizoram','NE',28,false), ('Amravati','Maharashtra','W2',29,false),
  ('Ambala','Haryana','N1',30,false), ('Daman','Daman & Diu','W1',31,false),
  ('Dehradun','Uttarakhand','N2',32,false), ('Faridabad','Haryana','N1',33,false),
  ('Gangtok','Sikkim','NE',34,false), ('Ghaziabad','Uttar Pradesh','N1',35,false),
  ('Imphal','Manipur','NE',36,false), ('Itanagar','Arunachal Pradesh','NE',37,false),
  ('Jaipur','Rajasthan','N1',38,false), ('Jammu','Jammu & Kashmir','N2',39,false),
  ('Jalandhar','Punjab','N2',40,false), ('Kohima','Nagaland','NE',41,false),
  ('Port Blair','Andaman & Nicobar','S1',42,false), ('Shillong','Meghalaya','NE',43,false),
  ('Silvassa','Dadra & Nagar Haveli','W1',45,false), ('Srinagar','Jammu & Kashmir','N2',46,false),
  -- cities that carry their own special rates
  ('Surat','Gujarat','W1',null,false),
  ('Baddi','Himachal Pradesh','N2',null,false)
on conflict (name, state_name) do update
  set zone_code = excluded.zone_code, ref_id = excluded.ref_id, is_metro = excluded.is_metro;

-- ---------------------------------------------------------------- base zone matrix
insert into public.rate_matrix (origin_zone, dest_zone, rate_per_kg) values
  ('N1','N1',7),    ('N1','N2',7),    ('N1','E',14.5), ('N1','NE',18), ('N1','W1',9),
  ('N1','W2',10),   ('N1','S1',14.5), ('N1','S2',14.5),('N1','Central',9),
  ('N2','N1',7),    ('N2','N2',7),    ('N2','E',14.5), ('N2','NE',18), ('N2','W1',10),
  ('N2','W2',10),   ('N2','S1',14.5), ('N2','S2',14.5),('N2','Central',10),
  ('E','N1',10),    ('E','N2',14.5),  ('E','E',7),     ('E','NE',9),   ('E','W1',10),
  ('E','W2',14.5),  ('E','S1',10),    ('E','S2',14.5), ('E','Central',9),
  ('NE','N1',10),   ('NE','N2',14.5), ('NE','E',9),    ('NE','NE',7),  ('NE','W1',14.5),
  ('NE','W2',14.5), ('NE','S1',14.5), ('NE','S2',18),  ('NE','Central',10),
  ('W1','N1',9),    ('W1','N2',10),   ('W1','E',14.5), ('W1','NE',18), ('W1','W1',7),
  ('W1','W2',7),    ('W1','S1',10),   ('W1','S2',14.5),('W1','Central',9),
  ('W2','N1',10),   ('W2','N2',10),   ('W2','E',14.5), ('W2','NE',18), ('W2','W1',7),
  ('W2','W2',7),    ('W2','S1',9),    ('W2','S2',14.5),('W2','Central',9),
  ('S1','N1',10),   ('S1','N2',14.5), ('S1','E',14.5), ('S1','NE',18), ('S1','W1',10),
  ('S1','W2',9),    ('S1','S1',7),    ('S1','S2',9),   ('S1','Central',9),
  ('S2','N1',14.5), ('S2','N2',14.5), ('S2','E',14.5), ('S2','NE',18), ('S2','W1',10),
  ('S2','W2',10),   ('S2','S1',7),    ('S2','S2',7),   ('S2','Central',9),
  ('Central','N1',9),   ('Central','N2',10),  ('Central','E',14.5), ('Central','NE',18),
  ('Central','W1',7),   ('Central','W2',9),   ('Central','S1',9),   ('Central','S2',14.5),
  ('Central','Central',7)
on conflict (origin_zone, dest_zone) do update
  set rate_per_kg = excluded.rate_per_kg, updated_at = now();

-- ---------------------------------------------------------------- special rates (SPR)
-- 1. Any zone -> Himachal Pradesh / Jammu & Kashmir (state level)
insert into public.rate_special (origin_kind, origin_value, dest_kind, dest_value, rate_per_kg, note)
select 'zone', z.code, 'state', s.name, v.rate, 'SPR: hill state'
from (values ('N1',11),('N2',11),('E',18.5),('NE',18.5),('W1',14),('W2',14),('S1',18.5),('S2',18.5),('Central',14)) as v(zone, rate)
join public.rate_zones z on z.code = v.zone
cross join (values ('Himachal Pradesh'),('Jammu & Kashmir')) as s(name)
on conflict (origin_kind, origin_value, dest_kind, dest_value) do update
  set rate_per_kg = excluded.rate_per_kg, updated_at = now();

-- 2. Any zone -> North-East states (state level)
insert into public.rate_special (origin_kind, origin_value, dest_kind, dest_value, rate_per_kg, note)
select 'zone', v.zone, 'state', s.name, v.rate, 'SPR: north-east state'
from (values ('N1',22),('N2',22),('E',13),('NE',11),('W1',22),('W2',22),('S1',22),('S2',22),('Central',22)) as v(zone, rate)
cross join (values ('Arunachal Pradesh'),('Manipur'),('Meghalaya'),('Mizoram'),
                   ('Nagaland'),('Tripura'),('Sikkim'),('Assam')) as s(name)
on conflict (origin_kind, origin_value, dest_kind, dest_value) do update
  set rate_per_kg = excluded.rate_per_kg, updated_at = now();

-- 3. Any zone -> Guwahati (city level, cheaper than the Assam state rate)
insert into public.rate_special (origin_kind, origin_value, dest_kind, dest_value, rate_per_kg, note)
select 'zone', v.zone, 'city', 'Guwahati', v.rate, 'SPR: Guwahati city'
from (values ('N1',17),('N2',17),('E',8),('NE',6),('W1',17),('W2',17),('S1',17),('S2',17),('Central',17)) as v(zone, rate)
on conflict (origin_kind, origin_value, dest_kind, dest_value) do update
  set rate_per_kg = excluded.rate_per_kg, updated_at = now();

-- 4. Any zone -> Baddi / Jammu (city level)
insert into public.rate_special (origin_kind, origin_value, dest_kind, dest_value, rate_per_kg, note)
select 'zone', v.zone, 'city', c.name, v.rate, 'SPR: hill city'
from (values ('N1',6),('N2',6),('E',13.5),('NE',13.5),('W1',9),('W2',9),('S1',13.5),('S2',13.5),('Central',9)) as v(zone, rate)
cross join (values ('Baddi'),('Jammu')) as c(name)
on conflict (origin_kind, origin_value, dest_kind, dest_value) do update
  set rate_per_kg = excluded.rate_per_kg, updated_at = now();

-- 5. Surat (origin city) -> every zone
insert into public.rate_special (origin_kind, origin_value, dest_kind, dest_value, rate_per_kg, note)
values
  ('city','Surat','zone','N1',7.6,'SPR: ex-Surat'),
  ('city','Surat','zone','N2',8.6,'SPR: ex-Surat'),
  ('city','Surat','zone','E',12.8,'SPR: ex-Surat'),
  ('city','Surat','zone','NE',17,'SPR: ex-Surat'),
  ('city','Surat','zone','W1',6,'SPR: ex-Surat'),
  ('city','Surat','zone','W2',6,'SPR: ex-Surat'),
  ('city','Surat','zone','S1',8.6,'SPR: ex-Surat'),
  ('city','Surat','zone','S2',12.8,'SPR: ex-Surat'),
  ('city','Surat','zone','Central',7.6,'SPR: ex-Surat'),
  ('city','Surat','state','Himachal Pradesh',13.6,'SPR: ex-Surat'),
  ('city','Surat','state','Jammu & Kashmir',13.6,'SPR: ex-Surat'),
  ('city','Surat','state','Arunachal Pradesh',22,'SPR: ex-Surat'),
  ('city','Surat','state','Manipur',22,'SPR: ex-Surat'),
  ('city','Surat','state','Meghalaya',22,'SPR: ex-Surat'),
  ('city','Surat','state','Mizoram',22,'SPR: ex-Surat'),
  ('city','Surat','state','Nagaland',22,'SPR: ex-Surat'),
  ('city','Surat','state','Assam',22,'SPR: ex-Surat'),
  ('city','Surat','state','Sikkim',22,'SPR: ex-Surat'),
  ('city','Surat','state','Tripura',22,'SPR: ex-Surat'),
  ('city','Surat','city','Guwahati',17,'SPR: ex-Surat'),
  ('city','Surat','city','Baddi',8.6,'SPR: ex-Surat'),
  ('city','Surat','city','Jammu',8.6,'SPR: ex-Surat')
on conflict (origin_kind, origin_value, dest_kind, dest_value) do update
  set rate_per_kg = excluded.rate_per_kg, updated_at = now();

-- ---------------------------------------------------------------- charge settings
insert into public.rate_settings (key, value, text_value, unit, min_value, max_value, remark) values
  ('processing',          100,  null, 'LR',            null, null, 'Processing charge per LR'),
  ('fsc',                 20,   null, '%age',          null, null, 'Fuel surcharge as %age of base freight'),
  ('rov_owner',           0.05, null, '%age',          50,   null, 'Risk as %age of declared value - owner risk'),
  ('rov_carrier',         0.4,  null, '%age',          200,  null, 'Risk as %age of declared value - carrier risk'),
  ('divisor',             4500, null, 'base_mul',      null, null, 'Volumetric weight divisor (L*W*H/divisor)'),
  ('handling_100_250',    0,    null, 'per kg',        0,    null, 'Package handling 100-250 kg'),
  ('handling_250_400',    0,    null, 'per kg',        0,    null, 'Package handling 250-400 kg'),
  ('handling_400_plus',   3,    null, 'per kg',        0,    null, 'Package handling >= 400 kg'),
  ('oda_pincode',         1,    null, 'flag',          null, null, 'Apply ODA based on destination pincode'),
  ('demurrage_charge',    1,    null, 'per kg',        100,  null, 'Demurrage per kg after free days'),
  ('demurrage_free_days', 4,    null, 'days',          null, null, 'Free days before demurrage'),
  ('floor_delivery',      0,    null, 'per kg',        null, null, 'Floor delivery charge'),
  ('mall_delivery',       0,    null, 'LR',            0,    null, 'Mall delivery charge'),
  ('fuel_base_rate',      92.72,null, 'Rs. per litre', null, null, 'Base diesel rate the freight was built on'),
  ('fuel_hike_threshold', 0,    null, 'Rs. per litre', null, null, 'Threshold before a hike applies'),
  ('fuel_hike_duration',  1,    null, 'days',          null, null, 'Duration over which the hike is measured'),
  ('fuel_rate_step',      3,    null, 'Rs. per litre', null, null, 'Change in fuel rate per step'),
  ('fuel_freight_step',   2,    null, '%age',          null, null, 'Change in freight per fuel step'),
  ('fuel_hike_applicable',1,    null, 'flag',          null, null, 'Apply DPH on base freight'),
  ('fuel_hike_logic',     1,    null, 'flag',          null, null, 'Do not consider negative DPH'),
  ('fuel_current_rate',   92.72,null, 'Rs. per litre', null, null, 'Current diesel rate - update to drive the hike'),
  ('csd_army_delivery',   0,    null, 'per kg',        null, null, 'CSD / Army delivery'),
  ('pod_charges',         0,    null, 'LR',            null, null, 'Charge for sharing POD'),
  ('re_attempt_free',     2,    null, 'count',         null, null, 'Number of free re-attempts'),
  ('re_attempt_charge',   0,    null, 'per kg',        0,    null, 'Re-attempt charge'),
  ('sun_hol_delivery',    0,    null, 'LR',            null, null, 'Sunday / public holiday delivery'),
  ('fm_cost',             1,    null, 'per kg',        100,  null, 'First mile / pickup cost'),
  ('lm_cost',             0,    null, 'per kg',        0,    null, 'Last mile cost'),
  ('to_pay',              100,  null, 'LR',            null, null, 'To-pay charge per LR'),
  ('cheque_handling',     300,  null, 'LR',            null, null, 'Cheque handling per LR'),
  ('cash_handling',       0,    null, '%age',          0,    null, 'Cash handling'),
  ('apt_handling',        2,    null, 'per kg',        1000, null, 'Appointment-based delivery per kg'),
  ('min_chg_wt',          20,   null, 'LR',            null, null, 'Minimum chargeable weight per LR (kg)'),
  ('max_dead_wt',         0,    null, 'per package',   null, null, 'Max dead weight per package (0 = no cap)'),
  ('green_tax',           0.5,  null, 'per kg',        100,  null, 'Green tax'),
  ('min_lr_charge',       350,  null, 'LR',            null, null, 'Minimum charge per LR'),
  ('intra_city_rate',     0,    null, 'per kg',        null, null, 'Intra-city rate'),
  ('liability_limit',     0,    null, 'Rs.',           null, null, 'Liability limit'),
  ('gst_rate',            18,   null, '%age',          null, null, 'GST on the freight bill'),
  ('weight_rule',         null, 'max_dead_vol_weight', 'rule', null, null, 'Chargeable = max(dead, volumetric)'),
  ('invoice_type',        null, 'delivery',   'option', null, null, 'Options: pickup, delivery'),
  ('billing_cycle',       null, 'bi-monthly', 'option', null, null, 'Options: weekly, bi-monthly, monthly'),
  ('round_off',           null, 'yes',        'option', null, null, 'Round the charged weight / amount')
on conflict (key) do update set
  value = excluded.value, text_value = excluded.text_value, unit = excluded.unit,
  min_value = excluded.min_value, max_value = excluded.max_value,
  remark = excluded.remark, updated_at = now();

-- ---------------------------------------------------------------- ODA slabs
delete from public.rate_oda;
insert into public.rate_oda (lower_kg, upper_kg, per_kg, min_amount) values
  (0, 500, 3, 500),
  (500, 9999999999, 3, 500);

notify pgrst, 'reload schema';
