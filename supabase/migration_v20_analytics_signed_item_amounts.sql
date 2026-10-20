-- Independent hotfix: apply after v13+; does not require or activate v18/v19 CMV features.
-- ERP order 382643017 has a negative unit price. Preserve its actual sign and quantity.
BEGIN;
ALTER TABLE public.analytics_items DROP CONSTRAINT IF EXISTS analytics_items_unit_price_check;
ALTER TABLE public.analytics_items DROP CONSTRAINT IF EXISTS analytics_items_gross_cents_check;
ALTER TABLE public.analytics_items DROP CONSTRAINT IF EXISTS analytics_items_amount_sign_check;
ALTER TABLE public.analytics_items ADD CONSTRAINT analytics_items_amount_sign_check CHECK (
 (unit_price>=0 AND gross_cents>=0) OR (unit_price<0 AND gross_cents<=0)
);
-- Keep quantity>0, numeric precision, tenant FKs, leases, atomic ingestion and RLS intact.
-- No rows, job counters, date cursors, pending IDs, costs or ERP values are changed here.
NOTIFY pgrst, 'reload schema';
COMMIT;
