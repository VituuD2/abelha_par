-- Read-only validation for this operation, in the SAME Supabase project as the app.
-- Expected after v21: both entrypoints true, allocation_policy matching the value
-- below, and fita_purchase_cents = 0 (zero is correct; NULL is not).
WITH scope AS (
 SELECT 'fd694ddc-a2a6-4a56-9a4b-21b507b4645d'::uuid workspace_id
)
SELECT
 to_regprocedure('public.analytics_abc_components_v21(uuid,uuid,jsonb,jsonb,integer,integer,text,text)') IS NOT NULL AS report_v21_available,
 to_regprocedure('public.analytics_drilldown_components_v21(uuid,uuid,jsonb,jsonb,text,integer)') IS NOT NULL AS drilldown_v21_available,
 public.analytics_historical_cost_rules(workspace_id,'{"costBasis":"purchase","basis":"orders"}'::jsonb,'{}'::jsonb)#>>'{costSource,allocationPolicy}' AS allocation_policy,
 public.analytics_cost_at(workspace_id,'ACFS000-K001','2026-09-10'::date,'purchase') AS fita_purchase_cents
FROM scope;

-- Confirm the source data without changing its zero cost or effective date.
SELECT sku,effective_day,purchase_cents,average_cents,current
FROM public.analytics_cost_events
WHERE workspace_id='fd694ddc-a2a6-4a56-9a4b-21b507b4645d'
 AND sku='ACFS000-K001' AND current
ORDER BY effective_at;
