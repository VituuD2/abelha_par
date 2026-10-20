-- Apply after v18. ERP effective dates are distinct from ingestion timestamps.
BEGIN;
ALTER TABLE public.analytics_product_costs ADD COLUMN IF NOT EXISTS provider_revision text;
CREATE TABLE IF NOT EXISTS public.analytics_cost_history_sync (
 workspace_id uuid NOT NULL, connection_id uuid NOT NULL, external_id text NOT NULL, sku text NOT NULL,
 provider_revision text, page_offset integer NOT NULL DEFAULT 0, scan_id uuid NOT NULL DEFAULT gen_random_uuid(),
 next_at timestamptz NOT NULL DEFAULT now(), last_synced_at timestamptz, last_error text, attempts integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,connection_id,external_id),
 FOREIGN KEY(workspace_id,connection_id,external_id) REFERENCES public.analytics_product_costs(workspace_id,connection_id,external_id)
);
CREATE INDEX IF NOT EXISTS analytics_cost_history_due ON public.analytics_cost_history_sync(next_at);
CREATE TABLE IF NOT EXISTS public.analytics_cost_events (
 workspace_id uuid NOT NULL, connection_id uuid NOT NULL, external_id text NOT NULL, event_key text NOT NULL,
 sku text NOT NULL, effective_at timestamptz NOT NULL, effective_day date NOT NULL,
 purchase_cents numeric(24,4), average_cents numeric(24,4), raw jsonb NOT NULL,
 current boolean NOT NULL DEFAULT true, observed_at timestamptz NOT NULL DEFAULT now(), retired_at timestamptz,
 PRIMARY KEY(workspace_id,connection_id,external_id,event_key),
 FOREIGN KEY(workspace_id,connection_id,external_id) REFERENCES public.analytics_product_costs(workspace_id,connection_id,external_id)
);
CREATE INDEX IF NOT EXISTS analytics_cost_events_asof ON public.analytics_cost_events(workspace_id,connection_id,sku,effective_day DESC,effective_at DESC) WHERE current;
CREATE TABLE IF NOT EXISTS public.analytics_cost_event_staging (
 workspace_id uuid NOT NULL, connection_id uuid NOT NULL, external_id text NOT NULL, scan_id uuid NOT NULL,
 event_key text NOT NULL, effective_at timestamptz NOT NULL, effective_day date NOT NULL,
 purchase_cents numeric(24,4), average_cents numeric(24,4), raw jsonb NOT NULL,
 PRIMARY KEY(workspace_id,connection_id,external_id,scan_id,event_key),
 FOREIGN KEY(workspace_id,connection_id,external_id) REFERENCES public.analytics_product_costs(workspace_id,connection_id,external_id)
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['analytics_cost_history_sync','analytics_cost_events','analytics_cost_event_staging'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',tab);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',tab);
 END LOOP;
END $$;

-- Only reviewed base SKUs are enriched. No product detail fan-out for the entire catalog.
CREATE OR REPLACE FUNCTION public.analytics_finish_cost_page(p_workspace uuid,p_connection uuid,p_lease uuid,p_version integer,
 p_offset integer,p_products jsonb DEFAULT '[]',p_done boolean DEFAULT false,p_error text DEFAULT NULL,p_retry integer DEFAULT 60,p_cooldown integer DEFAULT 3)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s analytics_cost_sync; BEGIN
 PERFORM 1 FROM analytics_connections WHERE workspace_id=p_workspace AND id=p_connection
  AND sync_lock=p_lease AND sync_locked_until>now() AND version=p_version AND enabled
  AND EXISTS(SELECT 1 FROM analytics_companies co WHERE co.workspace_id=p_workspace AND co.id=analytics_connections.company_id AND co.tax_id='13397731000164') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COST_LEASE_CHANGED'; END IF;
 SELECT * INTO s FROM analytics_cost_sync WHERE workspace_id=p_workspace AND connection_id=p_connection AND page_offset=p_offset FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COST_CHECKPOINT_CHANGED'; END IF;
 IF p_error IS NULL THEN
  IF jsonb_typeof(p_products)<>'array' OR jsonb_array_length(p_products)>100
   OR (NOT p_done AND jsonb_array_length(p_products)=0) THEN RAISE EXCEPTION 'INVALID_COST_PAGE'; END IF;
  INSERT INTO analytics_product_costs(workspace_id,connection_id,external_id,sku,cost_cents,active,scan_id,provider_revision)
   SELECT p_workspace,p_connection,x->>'external_id',x->>'sku',(x->>'cost_cents')::numeric,(x->>'active')::boolean,s.scan_id,x->>'provider_revision'
   FROM jsonb_array_elements(p_products) x
   ON CONFLICT(workspace_id,connection_id,external_id) DO UPDATE SET sku=EXCLUDED.sku,cost_cents=EXCLUDED.cost_cents,
    active=EXCLUDED.active,scan_id=EXCLUDED.scan_id,checked_at=now(),provider_revision=EXCLUDED.provider_revision;
  IF p_done THEN
   UPDATE analytics_product_costs SET active=false,checked_at=now()
    WHERE workspace_id=p_workspace AND connection_id=p_connection AND scan_id<>s.scan_id AND active;
  END IF;
  UPDATE analytics_cost_sync SET page_offset=CASE WHEN p_done THEN 0 ELSE p_offset+jsonb_array_length(p_products) END,
   scan_id=CASE WHEN p_done THEN gen_random_uuid() ELSE scan_id END,
   next_at=CASE WHEN p_done THEN now()+interval '30 minutes' ELSE now() END,
   last_synced_at=CASE WHEN p_done THEN now() ELSE last_synced_at END,last_error=null,attempts=0,updated_at=now()
   WHERE workspace_id=p_workspace;
 ELSE
  UPDATE analytics_cost_sync SET last_error=left(p_error,500),attempts=attempts+1,
   next_at=now()+make_interval(secs=>greatest(3,least(p_retry,3600))),updated_at=now() WHERE workspace_id=p_workspace;
 END IF;
 -- Keep a short account-wide cooldown across serverless invocations.
 UPDATE analytics_connections SET sync_lock=null,sync_locked_until=now()+make_interval(secs=>greatest(3,least(p_cooldown,3600)))
  WHERE workspace_id=p_workspace AND id=p_connection AND sync_lock=p_lease;
END $$;

CREATE OR REPLACE FUNCTION public.analytics_queue_cost_history(p_workspace uuid,p_skus text[],p_force boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN
 INSERT INTO analytics_cost_history_sync(workspace_id,connection_id,external_id,sku,provider_revision)
 SELECT p.workspace_id,p.connection_id,p.external_id,p.sku,p.provider_revision FROM analytics_product_costs p
 JOIN analytics_cost_sync s ON s.workspace_id=p.workspace_id AND s.connection_id=p.connection_id
 WHERE p.workspace_id=p_workspace AND p.sku=ANY(p_skus) AND p.active
 ON CONFLICT(workspace_id,connection_id,external_id) DO UPDATE SET sku=EXCLUDED.sku,
  next_at=CASE WHEN p_force OR analytics_cost_history_sync.sku<>EXCLUDED.sku OR analytics_cost_history_sync.provider_revision IS DISTINCT FROM EXCLUDED.provider_revision THEN now() ELSE analytics_cost_history_sync.next_at END,
  provider_revision=EXCLUDED.provider_revision;
END $$;

CREATE OR REPLACE FUNCTION public.analytics_claim_cost_history() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c analytics_connections; token uuid:=gen_random_uuid(); jobs jsonb; BEGIN
 SELECT cn.* INTO c FROM analytics_connections cn JOIN analytics_cost_sync st ON st.workspace_id=cn.workspace_id AND st.connection_id=cn.id
 WHERE cn.enabled AND (cn.sync_locked_until IS NULL OR cn.sync_locked_until<now())
 AND EXISTS(SELECT 1 FROM analytics_companies co WHERE co.workspace_id=cn.workspace_id AND co.id=cn.company_id AND co.tax_id='13397731000164')
 AND EXISTS(SELECT 1 FROM analytics_cost_history_sync j WHERE j.workspace_id=cn.workspace_id AND j.connection_id=cn.id AND j.next_at<=now())
 -- Let catalog discovery advance even during the initial historical backfill.
 AND st.next_at>now()-interval '5 minutes'
 ORDER BY cn.last_processed_at NULLS FIRST,cn.id FOR UPDATE OF cn SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('analytics-account:'||coalesce(c.verified_tax_id,c.workspace_id::text||':'||c.company_id::text),0)) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM analytics_connections other WHERE other.id<>c.id AND other.sync_locked_until>now()
  AND ((c.verified_tax_id IS NOT NULL AND other.verified_tax_id=c.verified_tax_id) OR (other.workspace_id=c.workspace_id AND other.company_id=c.company_id))) THEN RETURN NULL; END IF;
 SELECT jsonb_agg(to_jsonb(j)) INTO jobs FROM (SELECT * FROM analytics_cost_history_sync
  WHERE workspace_id=c.workspace_id AND connection_id=c.id AND next_at<=now()
  ORDER BY last_synced_at NULLS FIRST,next_at,external_id LIMIT 3 FOR UPDATE) j;
 UPDATE analytics_connections SET sync_lock=token,sync_locked_until=now()+interval '90 seconds',last_processed_at=now()
  WHERE workspace_id=c.workspace_id AND id=c.id;
 RETURN jsonb_build_object('workspace_id',c.workspace_id,'connection_id',c.id,'connection_version',c.version,'lease',token,'jobs',jobs);
END $$;

CREATE OR REPLACE FUNCTION public.analytics_finish_cost_history_page(p_workspace uuid,p_connection uuid,p_lease uuid,p_version integer,
 p_external text,p_scan uuid,p_offset integer,p_count integer DEFAULT 0,p_events jsonb DEFAULT '[]',p_done boolean DEFAULT false,
 p_error text DEFAULT NULL,p_retry integer DEFAULT 60)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job analytics_cost_history_sync; BEGIN
 PERFORM 1 FROM analytics_connections c WHERE c.workspace_id=p_workspace AND c.id=p_connection AND c.enabled
  AND c.sync_lock=p_lease AND c.sync_locked_until>now() AND c.version=p_version
  AND EXISTS(SELECT 1 FROM analytics_companies co WHERE co.workspace_id=p_workspace AND co.id=c.company_id AND co.tax_id='13397731000164') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COST_LEASE_CHANGED'; END IF;
 SELECT * INTO job FROM analytics_cost_history_sync WHERE workspace_id=p_workspace AND connection_id=p_connection AND external_id=p_external
  AND scan_id=p_scan AND page_offset=p_offset FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COST_CHECKPOINT_CHANGED'; END IF;
 IF p_error IS NOT NULL THEN
  UPDATE analytics_cost_history_sync SET last_error=left(p_error,500),attempts=attempts+1,
   next_at=now()+make_interval(secs=>greatest(3,least(p_retry,3600))),updated_at=now()
   WHERE workspace_id=p_workspace AND connection_id=p_connection AND external_id=p_external;
  RETURN;
 END IF;
 IF p_count<0 OR p_count>100 OR jsonb_typeof(p_events)<>'array' OR jsonb_array_length(p_events)>p_count
  OR (NOT p_done AND p_count=0) THEN RAISE EXCEPTION 'INVALID_COST_PAGE'; END IF;
 INSERT INTO analytics_cost_event_staging(workspace_id,connection_id,external_id,scan_id,event_key,effective_at,effective_day,purchase_cents,average_cents,raw)
 SELECT p_workspace,p_connection,p_external,p_scan,x->>'event_key',at,(at AT TIME ZONE 'America/Sao_Paulo')::date,
  (x->>'purchase_cents')::numeric,(x->>'average_cents')::numeric,x->'raw'
 FROM jsonb_array_elements(p_events) x CROSS JOIN LATERAL (SELECT CASE WHEN x->>'effective_at' ~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
  THEN (x->>'effective_at')::timestamptz ELSE (x->>'effective_at')::timestamp AT TIME ZONE 'America/Sao_Paulo' END at) parsed
 ON CONFLICT DO NOTHING;
 IF p_done THEN
  -- Publish only complete histories. Old versions remain auditable, not silently overwritten.
  UPDATE analytics_cost_events e SET current=false,retired_at=now()
   WHERE e.workspace_id=p_workspace AND e.connection_id=p_connection AND e.external_id=p_external AND e.current
   AND NOT EXISTS(SELECT 1 FROM analytics_cost_event_staging st WHERE st.workspace_id=p_workspace AND st.connection_id=p_connection
    AND st.external_id=p_external AND st.scan_id=p_scan AND st.event_key=e.event_key);
  INSERT INTO analytics_cost_events(workspace_id,connection_id,external_id,event_key,sku,effective_at,effective_day,purchase_cents,average_cents,raw)
  SELECT workspace_id,connection_id,external_id,event_key,job.sku,effective_at,effective_day,purchase_cents,average_cents,raw
   FROM analytics_cost_event_staging WHERE workspace_id=p_workspace AND connection_id=p_connection AND external_id=p_external AND scan_id=p_scan
  ON CONFLICT(workspace_id,connection_id,external_id,event_key) DO UPDATE SET current=true,retired_at=null,sku=EXCLUDED.sku;
  DELETE FROM analytics_cost_event_staging WHERE workspace_id=p_workspace AND connection_id=p_connection AND external_id=p_external;
 END IF;
 UPDATE analytics_cost_history_sync SET page_offset=CASE WHEN p_done THEN 0 ELSE p_offset+p_count END,
  scan_id=CASE WHEN p_done THEN gen_random_uuid() ELSE scan_id END,
  next_at=CASE WHEN p_done THEN now()+interval '24 hours' ELSE now() END,
  last_synced_at=CASE WHEN p_done THEN now() ELSE last_synced_at END,last_error=null,attempts=0,updated_at=now()
  WHERE workspace_id=p_workspace AND connection_id=p_connection AND external_id=p_external;
END $$;

CREATE OR REPLACE FUNCTION public.analytics_release_cost_history(p_workspace uuid,p_connection uuid,p_lease uuid,p_cooldown integer DEFAULT 3)
RETURNS void LANGUAGE sql SET search_path=public,pg_temp AS $$
 UPDATE analytics_connections SET sync_lock=null,sync_locked_until=now()+make_interval(secs=>greatest(3,least(p_cooldown,3600)))
  WHERE workspace_id=p_workspace AND id=p_connection AND sync_lock=p_lease;
$$;

-- Resolve each SKU + sale day once per report, then join back to the sold lines.
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
 ) SELECT CASE WHEN count(*)=1 AND min(cost)>0 THEN min(cost) END FROM products;
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
   CASE WHEN p_rules->'referenceCosts'->>(leaves.component->>'target') ~ '^[0-9]+([.][0-9]{1,4})?$'
    THEN (p_rules->'referenceCosts'->>(leaves.component->>'target'))::numeric END END unit_cost
  FROM leaves LEFT JOIN resolved_costs rc ON rc.target=leaves.component->>'target' AND rc.cost_day=leaves.cost_day
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


CREATE OR REPLACE FUNCTION public.analytics_historical_cost_rules(p_workspace uuid,p_filters jsonb,p_rules jsonb) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT p_rules||jsonb_build_object('referenceCosts','{}'::jsonb,'costSource',jsonb_build_object('kind','olist','policy','effective_date',
  'field',CASE WHEN p_filters->>'costBasis'='purchase' THEN 'precoCusto' ELSE 'custoMedio' END,
  'basis',coalesce(p_filters->>'costBasis','average'),'granularity','day','dateBasis',p_filters->>'basis',
  'connectionId',(SELECT connection_id FROM analytics_cost_sync WHERE workspace_id=p_workspace),
  'name','Olist 1','lastSyncedAt',(SELECT CASE WHEN bool_and(last_synced_at IS NOT NULL) THEN min(last_synced_at) END FROM analytics_cost_history_sync WHERE workspace_id=p_workspace),
  'lastError',(SELECT last_error FROM analytics_cost_history_sync WHERE workspace_id=p_workspace AND last_error IS NOT NULL ORDER BY updated_at DESC LIMIT 1)));
$$;

CREATE OR REPLACE FUNCTION public.analytics_cost_history_status(p_workspace uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('total',count(*),'completed',count(*) FILTER(WHERE last_synced_at IS NOT NULL),
  'pending',count(*) FILTER(WHERE next_at<=now()),'updated_at',max(updated_at),
  'last_synced_at',CASE WHEN bool_and(last_synced_at IS NOT NULL) THEN min(last_synced_at) END,
  'last_error',(SELECT last_error FROM analytics_cost_history_sync WHERE workspace_id=p_workspace AND last_error IS NOT NULL ORDER BY updated_at DESC LIMIT 1))
 FROM analytics_cost_history_sync WHERE workspace_id=p_workspace;
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
 'mixedLines',(SELECT count(DISTINCT source_line) FROM filtered WHERE allocation_state IN ('cost','missing_cost')),
 'missingCostSkus',coalesce((SELECT jsonb_agg(sku ORDER BY sku) FROM (SELECT DISTINCT sku FROM filtered WHERE allocation_state='missing_cost' AND coalesce(reference_cost_cents,0)<=0) x),'[]'::jsonb),

 'ignoredComponentSkus',coalesce(p_rules->'ignoredComponentSkus','[]'::jsonb),
 'periodCostCents',(SELECT CASE WHEN count(*) FILTER(WHERE coalesce(reference_cost_cents,0)<=0)=0 THEN coalesce(sum(quantity*reference_cost_cents),0)::text END FROM filtered),
 'knownCostCents',(SELECT coalesce(sum(quantity*reference_cost_cents) FILTER(WHERE reference_cost_cents>0),0)::text FROM filtered),
 'costMissingLines',(SELECT count(DISTINCT source_line) FROM filtered WHERE coalesce(reference_cost_cents,0)<=0),
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

CREATE OR REPLACE FUNCTION public.analytics_drilldown_components(p_workspace uuid,p_actor uuid,p_filters jsonb,p_rules jsonb,p_entity text,p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN PERFORM analytics_assert_member(p_workspace,p_actor);
 IF p_filters->>'grouping' IS DISTINCT FROM 'composition' THEN RAISE EXCEPTION 'INVALID_GROUPING'; END IF;
 RETURN(WITH matches AS MATERIALIZED(SELECT * FROM analytics_composition_lines(p_workspace,p_filters,p_rules) WHERE entity_id=p_entity),
 sales AS(SELECT order_id,company_id,source_id,sum(gross_cents) revenue,sum(quantity) quantity FROM matches GROUP BY order_id,company_id,source_id)
 SELECT jsonb_build_object('sources',coalesce((SELECT jsonb_agg(row) FROM (
 SELECT jsonb_build_object('sku',source_sku,'name',min(source_name),'factor',composition_factor::text,
 'ignoredComponents',coalesce(p_rules->'rules'->upper(btrim(source_sku))->'ignoredComponents',p_rules->'bundles'->upper(btrim(source_sku))->'ignoredComponents','[]'::jsonb),
 'originalRevenue',sum(source_gross_cents)::text,'referenceCostCents',CASE WHEN count(DISTINCT reference_cost_cents)=1 THEN max(reference_cost_cents)::text END,
 'minReferenceCostCents',min(reference_cost_cents)::text,'maxReferenceCostCents',max(reference_cost_cents)::text,'costVersions',count(DISTINCT reference_cost_cents),
 'unallocatedLines',count(*) FILTER(WHERE allocation_state='missing_cost'),
 'quantity',sum(source_quantity)::text,'baseQuantity',sum(quantity)::text,'revenue',sum(gross_cents)::text) row
 FROM matches GROUP BY source_sku,composition_factor ORDER BY source_sku LIMIT 200
 ) original_skus),'[]'::jsonb),'total',(SELECT count(*) FROM sales),'companies',coalesce((SELECT jsonb_agg(row) FROM(SELECT jsonb_build_object('name',c.name,'revenue',sum(s.revenue)::text,'quantity',sum(s.quantity)::text,'orders',count(*)) row FROM sales s JOIN analytics_companies c ON c.id=s.company_id GROUP BY c.id,c.name) x),'[]'),
 'channels',coalesce((SELECT jsonb_agg(row) FROM(SELECT jsonb_build_object('name',src.name,'revenue',sum(s.revenue)::text,'quantity',sum(s.quantity)::text,'orders',count(*)) row FROM sales s JOIN analytics_sources src ON src.id=s.source_id GROUP BY src.id,src.name) x),'[]'),
 'orders',coalesce((SELECT jsonb_agg(row) FROM(SELECT jsonb_build_object('id',o.external_id,'number',o.number,'date',o.sale_date,'status',o.status,'company',c.name,'source',src.name,'connection',cn.name,'revenue',s.revenue::text,'quantity',s.quantity::text) row FROM sales s JOIN analytics_orders o ON o.id=s.order_id JOIN analytics_companies c ON c.id=s.company_id JOIN analytics_sources src ON src.id=s.source_id JOIN analytics_connections cn ON cn.id=o.connection_id ORDER BY o.sale_date DESC,o.id OFFSET greatest(p_offset,0) LIMIT 50) x),'[]')));
END $$;

CREATE OR REPLACE FUNCTION public.analytics_abc_components_v19(p_workspace uuid,p_actor uuid,p_filters jsonb,p_rules jsonb,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50,p_sort text DEFAULT 'rank',p_direction text DEFAULT 'asc')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 PERFORM analytics_assert_member(p_workspace,p_actor);
 IF coalesce(p_filters->>'costBasis','average') NOT IN ('purchase','average') THEN RAISE EXCEPTION 'INVALID_COST_BASIS'; END IF;
 RETURN analytics_abc_components(p_workspace,p_actor,p_filters,analytics_historical_cost_rules(p_workspace,p_filters,p_rules),p_offset,p_limit,p_sort,p_direction);
END $$;
CREATE OR REPLACE FUNCTION public.analytics_drilldown_components_v19(p_workspace uuid,p_actor uuid,p_filters jsonb,p_rules jsonb,p_entity text,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 PERFORM analytics_assert_member(p_workspace,p_actor);
 IF coalesce(p_filters->>'costBasis','average') NOT IN ('purchase','average') THEN RAISE EXCEPTION 'INVALID_COST_BASIS'; END IF;
 RETURN analytics_drilldown_components(p_workspace,p_actor,p_filters,analytics_historical_cost_rules(p_workspace,p_filters,p_rules),p_entity,p_offset);
END $$;

REVOKE ALL ON FUNCTION public.analytics_queue_cost_history(uuid,text[],boolean),public.analytics_claim_cost_history(),public.analytics_finish_cost_history_page(uuid,uuid,uuid,integer,text,uuid,integer,integer,jsonb,boolean,text,integer),public.analytics_release_cost_history(uuid,uuid,uuid,integer),public.analytics_cost_at(uuid,text,date,text),public.analytics_historical_cost_rules(uuid,jsonb,jsonb),public.analytics_abc_components_v19(uuid,uuid,jsonb,jsonb,integer,integer,text,text),public.analytics_drilldown_components_v19(uuid,uuid,jsonb,jsonb,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_queue_cost_history(uuid,text[],boolean),public.analytics_claim_cost_history(),public.analytics_finish_cost_history_page(uuid,uuid,uuid,integer,text,uuid,integer,integer,jsonb,boolean,text,integer),public.analytics_release_cost_history(uuid,uuid,uuid,integer),public.analytics_cost_at(uuid,text,date,text),public.analytics_historical_cost_rules(uuid,jsonb,jsonb),public.analytics_abc_components_v19(uuid,uuid,jsonb,jsonb,integer,integer,text,text),public.analytics_drilldown_components_v19(uuid,uuid,jsonb,jsonb,text,integer) TO service_role;
REVOKE ALL ON FUNCTION public.analytics_cost_history_status(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_cost_history_status(uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
