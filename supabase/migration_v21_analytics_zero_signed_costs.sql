-- Apply after v19. Keeps dated ERP costs, including explicit zero and signed values.
-- Requires v20 separately for negative sales item prices.
-- No prices, source histories, jobs or quantities are overwritten.
BEGIN;
ALTER TABLE public.analytics_product_costs DROP CONSTRAINT IF EXISTS analytics_product_costs_cost_cents_check;
ALTER TABLE public.analytics_orders DROP CONSTRAINT IF EXISTS analytics_orders_total_cents_check;

CREATE OR REPLACE FUNCTION public.analytics_cost_at(p_workspace uuid,p_sku text,p_day date,p_basis text DEFAULT 'average')
RETURNS numeric LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 WITH candidates AS (
  SELECT e.external_id,e.effective_at,CASE WHEN p_basis='purchase' THEN e.purchase_cents ELSE e.average_cents END cost
  FROM analytics_cost_events e JOIN analytics_cost_sync s ON s.workspace_id=e.workspace_id AND s.connection_id=e.connection_id
  WHERE e.workspace_id=p_workspace AND e.sku=p_sku AND e.current AND e.effective_day<=p_day
 ), latest AS (
  SELECT external_id,max(effective_at) at FROM candidates GROUP BY external_id
 ), products AS (
  SELECT c.external_id,CASE WHEN count(DISTINCT coalesce(c.cost::text,'missing'))=1 THEN min(c.cost) END cost
  FROM candidates c JOIN latest l ON l.external_id=c.external_id AND l.at=c.effective_at GROUP BY c.external_id
 ) SELECT CASE WHEN count(*)=1 AND count(cost)=1 THEN min(cost) END FROM products;
$$;

CREATE OR REPLACE FUNCTION public.analytics_composition_lines(p_workspace uuid,p_filters jsonb,p_rules jsonb)
RETURNS TABLE(entity_id text,entity_name text,sku text,quantity numeric,gross_cents numeric,
 order_id uuid,company_id uuid,source_id uuid,connection_id uuid,source_sku text,source_name text,
 source_quantity numeric,composition_factor numeric,composition_state text,composition_reason text,
 source_line bigint,source_gross_cents numeric,allocation_state text,reference_cost_cents numeric)
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 WITH original AS MATERIALIZED (
  SELECT f.*,CASE WHEN p_filters->>'basis'='invoiced' THEN o.invoice_date ELSE o.sale_date END cost_day,row_number() OVER() line_id,upper(btrim(coalesce(f.sku,''))) normalized_sku,
   strpos(f.entity_id,':order:')>0 unlinked
  FROM analytics_filtered_items(p_workspace,p_filters||jsonb_build_object('grouping','product')) f JOIN analytics_orders o ON o.workspace_id=p_workspace AND o.id=f.order_id
 ), matched AS (
  SELECT original.*,CASE WHEN unlinked THEN p_rules->'unlinkedRules'->normalized_sku ELSE p_rules->'rules'->normalized_sku END rule,
   CASE WHEN unlinked THEN p_rules->'unlinkedBundles'->normalized_sku ELSE p_rules->'bundles'->normalized_sku END bundle FROM original
 ), leaves AS (
  SELECT m.*,c.component,coalesce((c.component->>'factor')::numeric,1) factor
  FROM matched m CROSS JOIN LATERAL jsonb_array_elements(
   CASE WHEN bundle IS NOT NULL THEN bundle->'components'
    WHEN rule IS NOT NULL THEN jsonb_build_array(rule) ELSE '[null]'::jsonb END) c(component)
 ), cost_keys AS MATERIALIZED (
  SELECT DISTINCT component->>'target' target,cost_day FROM leaves
  WHERE p_rules->'costSource'->>'policy'='effective_date' AND component->>'target' IS NOT NULL
 ), resolved_costs AS MATERIALIZED (
  SELECT target,cost_day,analytics_cost_at(p_workspace,target,cost_day,coalesce(p_filters->>'costBasis','average')) cost FROM cost_keys
 ), expanded AS (
  SELECT leaves.*,CASE WHEN p_rules->'costSource'->>'policy'='effective_date' THEN rc.cost ELSE
   CASE WHEN p_rules->'referenceCosts'->>(leaves.component->>'target') ~ '^-?[0-9]+([.][0-9]{1,4})?$'
    THEN (p_rules->'referenceCosts'->>(leaves.component->>'target'))::numeric END END unit_cost
  FROM leaves LEFT JOIN resolved_costs rc ON rc.target=leaves.component->>'target' AND rc.cost_day=leaves.cost_day
 ), cost_weights AS (
  SELECT *,abs(factor*unit_cost) cost_weight,
   sum(abs(factor*unit_cost)) OVER(PARTITION BY line_id) cost_total,
   sum(factor) OVER(PARTITION BY line_id) quantity_total,
   bool_and(unit_cost IS NOT NULL AND factor>0 AND p_rules->>'revenuePolicy'='cost') OVER(PARTITION BY line_id) valid_costs
  FROM expanded
 ), weights AS (
  SELECT *,CASE WHEN cost_total=0 THEN factor ELSE cost_weight END weight,
   CASE WHEN cost_total=0 THEN quantity_total ELSE cost_total END total_weight
  FROM cost_weights
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
  CASE WHEN bundle IS NULL THEN 'direct' WHEN valid_costs AND cost_total=0 THEN 'quantity' WHEN valid_costs OR a.gross_cents=0 THEN 'cost' ELSE 'missing_cost' END,unit_cost
 FROM allocated a;
$$;

CREATE OR REPLACE FUNCTION public.analytics_historical_cost_rules(p_workspace uuid,p_filters jsonb,p_rules jsonb) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT p_rules||jsonb_build_object('referenceCosts','{}'::jsonb,'costSource',jsonb_build_object('kind','olist','policy','effective_date','allocationPolicy','signed_cost_magnitude_zero_quantity',
  'field',CASE WHEN p_filters->>'costBasis'='purchase' THEN 'precoCusto' ELSE 'custoMedio' END,
  'basis',coalesce(p_filters->>'costBasis','average'),'granularity','day','dateBasis',p_filters->>'basis',
  'connectionId',(SELECT connection_id FROM analytics_cost_sync WHERE workspace_id=p_workspace),
  'name','Olist 1','lastSyncedAt',(SELECT CASE WHEN bool_and(last_synced_at IS NOT NULL) THEN min(last_synced_at) END FROM analytics_cost_history_sync WHERE workspace_id=p_workspace),
  'lastError',(SELECT last_error FROM analytics_cost_history_sync WHERE workspace_id=p_workspace AND last_error IS NOT NULL ORDER BY updated_at DESC LIMIT 1)));
$$;

CREATE OR REPLACE FUNCTION public.analytics_abc_components(p_workspace uuid,p_actor uuid,p_filters jsonb,p_rules jsonb,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50,p_sort text DEFAULT 'rank',p_direction text DEFAULT 'asc') RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; BEGIN
 PERFORM analytics_assert_member(p_workspace,p_actor);
 IF p_filters->>'grouping' IS DISTINCT FROM 'composition' THEN RAISE EXCEPTION 'INVALID_GROUPING'; END IF;
 IF NOT (p_filters->>'mode'=ANY(ARRAY['TINY_LEGACY','STRICT_CUMULATIVE'])) OR NOT (p_filters->>'metric'=ANY(ARRAY['revenue','quantity'])) OR NOT (0<(p_filters->>'thresholdA')::numeric AND (p_filters->>'thresholdA')::numeric<(p_filters->>'thresholdB')::numeric AND (p_filters->>'thresholdB')::numeric<100) THEN RAISE EXCEPTION 'INVALID_FILTERS'; END IF;
 result := (WITH filtered AS MATERIALIZED (SELECT * FROM analytics_composition_lines(p_workspace,p_filters,p_rules)),
 grouped AS (SELECT entity_id,min(entity_name) name,min(sku) sku,sum(gross_cents) revenue,sum(quantity) quantity,count(DISTINCT order_id) orders FROM filtered GROUP BY entity_id),
 metrics AS (SELECT *,CASE WHEN p_filters->>'metric'='quantity' THEN quantity ELSE revenue END metric FROM grouped),
 ranked AS (SELECT *,row_number() OVER w rank,sum(metric) OVER () total_metric,sum(metric) OVER (w ROWS UNBOUNDED PRECEDING) accumulated FROM metrics WINDOW w AS(ORDER BY metric DESC,quantity DESC,entity_id COLLATE "C" ASC)),
 classified AS (SELECT *,CASE WHEN total_metric=0 THEN 'C' WHEN (CASE WHEN p_filters->>'mode'='TINY_LEGACY' THEN accumulated-metric ELSE accumulated END)*100<total_metric*(p_filters->>'thresholdA')::numeric THEN 'A' WHEN (CASE WHEN p_filters->>'mode'='TINY_LEGACY' THEN accumulated-metric ELSE accumulated END)*100<total_metric*(p_filters->>'thresholdB')::numeric THEN 'B' ELSE 'C' END class FROM ranked),
 payload AS (SELECT *,jsonb_build_object('entityId',entity_id,'name',name,'sku',sku,'revenue',revenue::text,'quantity',quantity::text,'orders',orders,'rank',rank,'class',class,'percent',coalesce(metric*100/nullif(total_metric,0),0),'cumulativeBefore',coalesce((accumulated-metric)*100/nullif(total_metric,0),0),'cumulative',coalesce(accumulated*100/nullif(total_metric,0),0)) row FROM classified),
 displayed AS (SELECT row FROM payload ORDER BY
 CASE WHEN p_direction='asc' THEN CASE p_sort WHEN 'rank' THEN rank WHEN 'revenue' THEN revenue WHEN 'quantity' THEN quantity WHEN 'orders' THEN orders WHEN 'percent' THEN metric WHEN 'cumulative' THEN accumulated END END ASC,
 CASE WHEN p_direction='desc' THEN CASE p_sort WHEN 'rank' THEN rank WHEN 'revenue' THEN revenue WHEN 'quantity' THEN quantity WHEN 'orders' THEN orders WHEN 'percent' THEN metric WHEN 'cumulative' THEN accumulated END END DESC,
 CASE WHEN p_direction='asc' THEN CASE p_sort WHEN 'name' THEN name WHEN 'sku' THEN sku END END COLLATE "C" ASC,
 CASE WHEN p_direction='desc' THEN CASE p_sort WHEN 'name' THEN name WHEN 'sku' THEN sku END END COLLATE "C" DESC,rank ASC
 OFFSET greatest(p_offset,0) LIMIT CASE WHEN p_limit=-1 THEN NULL ELSE least(greatest(p_limit,1),100) END)
 SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(row) FROM displayed),'[]'),'total',(SELECT count(*) FROM payload),
 'revenue',coalesce((SELECT sum(revenue)::text FROM payload),'0'),'quantity',coalesce((SELECT sum(quantity)::text FROM payload),'0'),'orders',(SELECT count(DISTINCT order_id) FROM filtered),
 'classes',(SELECT jsonb_object_agg(class,jsonb_build_object('count',n,'revenue',r::text,'quantity',q::text,'percent',pct)) FROM(SELECT class,count(*) n,sum(revenue) r,sum(quantity) q,coalesce(sum(metric)*100/nullif(max(total_metric),0),0) pct FROM classified GROUP BY class) c),
 'top10',coalesce((SELECT sum(metric)*100/nullif(max(total_metric),0) FROM ranked WHERE rank<=10),0),
 'pareto',coalesce((SELECT jsonb_agg(row ORDER BY rank) FROM payload WHERE rank<=60),'[]'),'generatedAt',now(),'composition',jsonb_build_object(
 'version',p_rules->>'version',
 'revenuePolicy',p_rules->>'revenuePolicy','costSource',p_rules->'costSource',
 'originalRevenue',coalesce((SELECT sum(original)::text FROM (SELECT max(source_gross_cents) original FROM filtered GROUP BY source_line) x),'0'),
 'unallocatedRevenue',coalesce((SELECT sum(original)::text FROM (SELECT max(source_gross_cents) original FROM filtered WHERE allocation_state='missing_cost' GROUP BY source_line) x),'0'),
 'unallocatedLines',(SELECT count(DISTINCT source_line) FROM filtered WHERE allocation_state='missing_cost'),
 'mixedLines',(SELECT count(DISTINCT source_line) FROM filtered WHERE allocation_state IN ('cost','quantity','missing_cost')),
 'missingCostSkus',coalesce((SELECT jsonb_agg(sku ORDER BY sku) FROM (SELECT DISTINCT sku FROM filtered WHERE allocation_state='missing_cost' AND reference_cost_cents IS NULL) x),'[]'::jsonb),

 'ignoredComponentSkus',coalesce(p_rules->'ignoredComponentSkus','[]'::jsonb),
 'periodCostCents',(SELECT CASE WHEN count(*) FILTER(WHERE reference_cost_cents IS NULL)=0 THEN coalesce(sum(quantity*reference_cost_cents),0)::text END FROM filtered),
 'knownCostCents',(SELECT coalesce(sum(quantity*reference_cost_cents) FILTER(WHERE reference_cost_cents IS NOT NULL),0)::text FROM filtered),
 'costMissingLines',(SELECT count(DISTINCT source_line) FROM filtered WHERE reference_cost_cents IS NULL),
 'zeroCostLines',(SELECT count(DISTINCT source_line) FROM filtered WHERE reference_cost_cents=0),
 'negativeCostLines',(SELECT count(DISTINCT source_line) FROM filtered WHERE reference_cost_cents<0),
 'quantityAllocationLines',(SELECT count(DISTINCT source_line) FROM filtered WHERE allocation_state='quantity'),
 'mappedEntities',(SELECT count(DISTINCT entity_id) FROM filtered WHERE composition_state IN ('mapped','base')),
 'pendingTotal',(SELECT count(DISTINCT source_sku) FROM filtered WHERE composition_state='pending'),
 'pending',coalesce((SELECT jsonb_agg(row) FROM (
   SELECT jsonb_build_object('sku',source_sku,'name',min(source_name),'reason',min(composition_reason),'orders',count(DISTINCT order_id)) row
   FROM filtered WHERE composition_state='pending' GROUP BY source_sku ORDER BY source_sku LIMIT 50
 ) pending),'[]'::jsonb))));

 IF p_filters->>'metric'='revenue' AND (result->'composition'->>'unallocatedLines')::integer>0 THEN
  RAISE EXCEPTION 'CMV_REQUIRED:%', (SELECT string_agg(value, ', ') FROM jsonb_array_elements_text(result->'composition'->'missingCostSkus'));
 END IF;
 RETURN result;
END $$;

-- CREATE OR REPLACE retains existing service-role-only grants and signatures.
NOTIFY pgrst, 'reload schema';
COMMIT;
