-- GST vs non-GST separation, per-bill costing, and profit.
--
-- doc_type splits bills into two worlds that never mix:
--   tax_invoice  numbered SSL/<FY>/NNNN, feeds GSTR-1 and every GST report
--   internal     numbered <internal_prefix>/<FY>/NNNN, management reports only
-- Existing rows are all GST tax invoices, so the default backfills them correctly.

alter table public.invoices
  add column if not exists doc_type     text not null default 'tax_invoice',
  add column if not exists other_costs  jsonb not null default '[]'::jsonb,
  -- NULL means "not costed yet", which is different from a cost of zero:
  -- a zero would report a 100% margin on every bill nobody has costed.
  add column if not exists total_cost   numeric,
  add column if not exists gross_profit numeric;

do $$ begin
  alter table public.invoices
    add constraint invoices_doc_type_check check (doc_type in ('tax_invoice', 'internal'));
exception when duplicate_object then null; end $$;

create index if not exists invoices_doc_type_idx on public.invoices (doc_type);
create index if not exists invoices_invoice_date_idx on public.invoices (invoice_date);

alter table public.company_settings
  add column if not exists internal_prefix text not null default 'TRP';

-- Expenses: overheads only. Direct trip costs now live on the bill, so the
-- seeded direct-cost categories would double count against them.
alter table public.expenses
  add column if not exists payment_method text,
  add column if not exists reference      text;
create index if not exists expenses_expense_date_idx on public.expenses (expense_date);

update public.expense_categories set name = 'Transport (overhead)'
 where name = 'Transport' and not exists (select 1 from public.expense_categories where name = 'Transport (overhead)');

notify pgrst, 'reload schema';
