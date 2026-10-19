-- Apply after v13. Read-only reporting functions; imported sales and workers are unchanged.
-- Rules come only from the server's versioned, workspace-scoped composition catalog.
BEGIN;

CREATE OR REPLACE FUNCTION public.analytics_composition_items(p_workspace uuid,p_filters jsonb,p_rules jsonb)
RETURNS TABLE(entity_id text,entity_name text,sku text,quantity numeric,gross_cents numeric,
 order_id uuid,company_id uuid,source_id uuid,connection_id uuid,source_sku text,source_name text,
 source_quantity numeric,composition_factor numeric,composition_state text,composition_reason text)
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 WITH original AS (
  -- Reuse every existing date, company, connection, product and channel filter.
  -- Original product identities remain available for reconciliation and drilldown.
  SELECT *,upper(btrim(coalesce(f.sku,''))) normalized_sku,
   strpos(f.entity_id,':order:')>0 unlinked
  FROM analytics_filtered_items(p_workspace,p_filters||jsonb_build_object('grouping','product')) f
 ), matched AS (
  SELECT original.*,CASE WHEN NOT unlinked THEN p_rules->'rules'->normalized_sku END rule
  FROM original
 )
 SELECT CASE WHEN rule IS NOT NULL THEN 'composition:'||(rule->>'target') ELSE m.entity_id END,
  coalesce(rule->>'name',m.entity_name),coalesce(rule->>'target',m.sku),
  m.quantity*coalesce((rule->>'factor')::numeric,1),m.gross_cents,
  m.order_id,m.company_id,m.source_id,m.connection_id,m.sku,m.entity_name,
  m.quantity,coalesce((rule->>'factor')::numeric,1),
  CASE WHEN unlinked THEN 'unlinked'
   WHEN rule IS NOT NULL THEN CASE WHEN rule->>'target'=normalized_sku THEN 'base' ELSE 'mapped' END
   WHEN (p_rules->'pending') ? normalized_sku OR normalized_sku ~ '-K[0-9]{3}[A-Z]*$' THEN 'pending'
   ELSE 'individual' END,
  CASE WHEN unlinked THEN 'Item sem vínculo de catálogo: identidade preservada por pedido'
   WHEN rule IS NOT NULL THEN NULL
   ELSE coalesce(p_rules->'pending'->>normalized_sku,'Sem composição confirmada') END
 FROM matched m;
$$;

CREATE OR REPLACE FUNCTION public.analytics_abc_composition(p_workspace uuid,p_actor uuid,p_filters jsonb,p_rules jsonb,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50,p_sort text DEFAULT 'rank',p_direction text DEFAULT 'asc') RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; BEGIN
 PERFORM analytics_assert_member(p_workspace,p_actor);
 IF p_filters->>'grouping' IS DISTINCT FROM 'composition' THEN RAISE EXCEPTION 'INVALID_GROUPING'; END IF;
 IF NOT (p_filters->>'mode'=ANY(ARRAY['TINY_LEGACY','STRICT_CUMULATIVE'])) OR NOT (p_filters->>'metric'=ANY(ARRAY['revenue','quantity'])) OR NOT (0<(p_filters->>'thresholdA')::numeric AND (p_filters->>'thresholdA')::numeric<(p_filters->>'thresholdB')::numeric AND (p_filters->>'thresholdB')::numeric<100) THEN RAISE EXCEPTION 'INVALID_FILTERS'; END IF;
 RETURN (WITH filtered AS MATERIALIZED (SELECT * FROM analytics_composition_items(p_workspace,p_filters,p_rules)),
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
 'ignoredComponentSkus',coalesce(p_rules->'ignoredComponentSkus','[]'::jsonb),
 'mappedEntities',(SELECT count(DISTINCT entity_id) FROM filtered WHERE composition_state IN ('mapped','base')),
 'pendingTotal',(SELECT count(DISTINCT source_sku) FROM filtered WHERE composition_state='pending'),
 'pending',coalesce((SELECT jsonb_agg(row) FROM (
   SELECT jsonb_build_object('sku',source_sku,'name',min(source_name),'reason',min(composition_reason),'orders',count(DISTINCT order_id)) row
   FROM filtered WHERE composition_state='pending' GROUP BY source_sku ORDER BY source_sku LIMIT 50
 ) pending),'[]'::jsonb))));
END $$;

CREATE OR REPLACE FUNCTION public.analytics_drilldown_composition(p_workspace uuid,p_actor uuid,p_filters jsonb,p_rules jsonb,p_entity text,p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN PERFORM analytics_assert_member(p_workspace,p_actor);
 IF p_filters->>'grouping' IS DISTINCT FROM 'composition' THEN RAISE EXCEPTION 'INVALID_GROUPING'; END IF;
 RETURN(WITH matches AS MATERIALIZED(SELECT * FROM analytics_composition_items(p_workspace,p_filters,p_rules) WHERE entity_id=p_entity),
 sales AS(SELECT order_id,company_id,source_id,sum(gross_cents) revenue,sum(quantity) quantity FROM matches GROUP BY order_id,company_id,source_id)
 SELECT jsonb_build_object('sources',coalesce((SELECT jsonb_agg(row) FROM (
 SELECT jsonb_build_object('sku',source_sku,'name',min(source_name),'factor',composition_factor::text,
 'ignoredComponents',coalesce(p_rules->'rules'->upper(btrim(source_sku))->'ignoredComponents','[]'::jsonb),
 'quantity',sum(source_quantity)::text,'baseQuantity',sum(quantity)::text,'revenue',sum(gross_cents)::text) row
 FROM matches GROUP BY source_sku,composition_factor ORDER BY source_sku LIMIT 200
 ) original_skus),'[]'::jsonb),'total',(SELECT count(*) FROM sales),'companies',coalesce((SELECT jsonb_agg(row) FROM(SELECT jsonb_build_object('name',c.name,'revenue',sum(s.revenue)::text,'quantity',sum(s.quantity)::text,'orders',count(*)) row FROM sales s JOIN analytics_companies c ON c.id=s.company_id GROUP BY c.id,c.name) x),'[]'),
 'channels',coalesce((SELECT jsonb_agg(row) FROM(SELECT jsonb_build_object('name',src.name,'revenue',sum(s.revenue)::text,'quantity',sum(s.quantity)::text,'orders',count(*)) row FROM sales s JOIN analytics_sources src ON src.id=s.source_id GROUP BY src.id,src.name) x),'[]'),
 'orders',coalesce((SELECT jsonb_agg(row) FROM(SELECT jsonb_build_object('id',o.external_id,'number',o.number,'date',o.sale_date,'status',o.status,'company',c.name,'source',src.name,'connection',cn.name,'revenue',s.revenue::text,'quantity',s.quantity::text) row FROM sales s JOIN analytics_orders o ON o.id=s.order_id JOIN analytics_companies c ON c.id=s.company_id JOIN analytics_sources src ON src.id=s.source_id JOIN analytics_connections cn ON cn.id=o.connection_id ORDER BY o.sale_date DESC,o.id OFFSET greatest(p_offset,0) LIMIT 50) x),'[]')));
END $$;

REVOKE ALL ON FUNCTION public.analytics_composition_items(uuid,jsonb,jsonb),public.analytics_abc_composition(uuid,uuid,jsonb,jsonb,integer,integer,text,text),public.analytics_drilldown_composition(uuid,uuid,jsonb,jsonb,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_composition_items(uuid,jsonb,jsonb),public.analytics_abc_composition(uuid,uuid,jsonb,jsonb,integer,integer,text,text),public.analytics_drilldown_composition(uuid,uuid,jsonb,jsonb,text,integer) TO service_role;
COMMIT;
