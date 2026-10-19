-- Apply after v15 (or migration_v14_v15_analytics_complete.sql).
-- Read-only mapping of unlinked sales ONLY for exact SKUs explicitly approved by the server catalog.
-- Existing imported sales, synthetic order identities, workers and checkpoints are preserved.
BEGIN;
DO $prerequisite$
BEGIN
 IF to_regprocedure('public.analytics_abc_components(uuid,uuid,jsonb,jsonb,integer,integer,text,text)') IS NULL THEN
  RAISE EXCEPTION 'Apply migration v15 before v16';
 END IF;
END
$prerequisite$;

CREATE OR REPLACE FUNCTION public.analytics_composition_lines(p_workspace uuid,p_filters jsonb,p_rules jsonb)
RETURNS TABLE(entity_id text,entity_name text,sku text,quantity numeric,gross_cents numeric,
 order_id uuid,company_id uuid,source_id uuid,connection_id uuid,source_sku text,source_name text,
 source_quantity numeric,composition_factor numeric,composition_state text,composition_reason text,
 source_line bigint,source_gross_cents numeric,allocation_state text,reference_cost_cents numeric)
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 WITH original AS MATERIALIZED (
  SELECT f.*,row_number() OVER() line_id,upper(btrim(coalesce(f.sku,''))) normalized_sku,
   strpos(f.entity_id,':order:')>0 unlinked
  FROM analytics_filtered_items(p_workspace,p_filters||jsonb_build_object('grouping','product')) f
 ), matched AS (
  SELECT original.*,CASE WHEN unlinked THEN p_rules->'unlinkedRules'->normalized_sku ELSE p_rules->'rules'->normalized_sku END rule,
   CASE WHEN unlinked THEN p_rules->'unlinkedBundles'->normalized_sku ELSE p_rules->'bundles'->normalized_sku END bundle FROM original
 ), expanded AS (
  SELECT m.*,c.component,coalesce((c.component->>'factor')::numeric,1) factor,
   CASE WHEN p_rules->'referenceCosts'->>(c.component->>'target') ~ '^[0-9]+$'
    THEN (p_rules->'referenceCosts'->>(c.component->>'target'))::numeric END unit_cost
  FROM matched m CROSS JOIN LATERAL jsonb_array_elements(
   CASE WHEN bundle IS NOT NULL THEN bundle->'components'
    WHEN rule IS NOT NULL THEN jsonb_build_array(rule) ELSE '[null]'::jsonb END) c(component)
 ), weights AS (
  SELECT *,factor*unit_cost weight,
   sum(factor*unit_cost) OVER(PARTITION BY line_id) total_weight,
   bool_and(unit_cost>0 AND factor>0 AND p_rules->>'revenuePolicy'='cost') OVER(PARTITION BY line_id)
    AND count(unit_cost) OVER(PARTITION BY line_id)=count(*) OVER(PARTITION BY line_id) valid_costs
  FROM expanded
 ), portions AS (
  SELECT *,CASE WHEN bundle IS NULL THEN abs(gross_cents)
    WHEN valid_costs THEN div(abs(gross_cents)*weight,total_weight) ELSE 0 END base_cents,
   CASE WHEN valid_costs THEN mod(abs(gross_cents)*weight,total_weight) ELSE 0 END remainder_weight
  FROM weights
 ), allocated AS (
  SELECT *,sum(base_cents) OVER(PARTITION BY line_id) assigned,
   row_number() OVER(PARTITION BY line_id ORDER BY remainder_weight DESC,component->>'target' COLLATE "C") remainder_rank
  FROM portions
 )
 SELECT CASE WHEN component IS NOT NULL AND component<>'null'::jsonb THEN 'composition:'||(component->>'target') ELSE a.entity_id END,
  coalesce(component->>'name',a.entity_name),coalesce(component->>'target',a.sku),a.quantity*factor,
  sign(a.gross_cents)*(base_cents+CASE WHEN bundle IS NOT NULL AND valid_costs AND remainder_rank<=abs(a.gross_cents)-assigned THEN 1 ELSE 0 END),
  a.order_id,a.company_id,a.source_id,a.connection_id,a.sku,a.entity_name,a.quantity,factor,
  CASE WHEN unlinked AND rule IS NULL AND bundle IS NULL THEN 'unlinked' WHEN bundle IS NOT NULL THEN 'mapped'
   WHEN rule IS NOT NULL THEN CASE WHEN rule->>'target'=normalized_sku THEN 'base' ELSE 'mapped' END
   WHEN (p_rules->'pending') ? normalized_sku OR normalized_sku ~ '-K[0-9]{3}[A-Z]*$' THEN 'pending' ELSE 'individual' END,
  CASE WHEN unlinked AND rule IS NULL AND bundle IS NULL THEN 'Item sem vínculo de catálogo: identidade preservada por pedido'
   WHEN rule IS NOT NULL OR bundle IS NOT NULL THEN NULL
   ELSE coalesce(p_rules->'pending'->>normalized_sku,'Sem composição confirmada') END,
  line_id,a.gross_cents,
  CASE WHEN bundle IS NULL THEN 'direct' WHEN valid_costs OR a.gross_cents=0 THEN 'cost' ELSE 'missing_cost' END,unit_cost
 FROM allocated a;
$$;


-- Versioned entry points ensure an older database cannot silently ignore the new approvals.
-- Existing v15 entry points still work; they enforce membership before reading data.
CREATE OR REPLACE FUNCTION public.analytics_abc_components_v16(p_workspace uuid,p_actor uuid,p_filters jsonb,p_rules jsonb,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50,p_sort text DEFAULT 'rank',p_direction text DEFAULT 'asc')
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT public.analytics_abc_components(p_workspace,p_actor,p_filters,p_rules,p_offset,p_limit,p_sort,p_direction);
$$;
CREATE OR REPLACE FUNCTION public.analytics_drilldown_components_v16(p_workspace uuid,p_actor uuid,p_filters jsonb,p_rules jsonb,p_entity text,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT public.analytics_drilldown_components(p_workspace,p_actor,p_filters,p_rules,p_entity,p_offset);
$$;

REVOKE ALL ON FUNCTION public.analytics_composition_lines(uuid,jsonb,jsonb),public.analytics_abc_components_v16(uuid,uuid,jsonb,jsonb,integer,integer,text,text),public.analytics_drilldown_components_v16(uuid,uuid,jsonb,jsonb,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_composition_lines(uuid,jsonb,jsonb),public.analytics_abc_components_v16(uuid,uuid,jsonb,jsonb,integer,integer,text,text),public.analytics_drilldown_components_v16(uuid,uuid,jsonb,jsonb,text,integer) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
