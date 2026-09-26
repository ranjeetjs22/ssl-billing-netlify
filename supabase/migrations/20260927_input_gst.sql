-- Input GST (ITC) paid to vendors on a bill's costs.
-- input_gst is the claimable part only; GST that cannot be claimed is folded
-- into total_cost instead, because then it really is a cost.
alter table public.invoices add column if not exists input_gst numeric;
notify pgrst, 'reload schema';
