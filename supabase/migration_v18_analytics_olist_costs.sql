-- Apply after v16/v17. Olist 1 is the shared reference for component allocation.
-- No provider requests in reporting; no spreadsheet fallback or inferred historical costs.
BEGIN;
CREATE TABLE IF NOT EXISTS public.analytics_cost_sync (
 workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id), connection_id uuid NOT NULL,
 page_offset integer NOT NULL DEFAULT 0 CHECK(page_offset>=0), scan_id uuid NOT NULL DEFAULT gen_random_uuid(),
 next_at timestamptz NOT NULL DEFAULT now(), last_synced_at timestamptz, last_error text,
 attempts integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,connection_id) REFERENCES public.analytics_connections(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS public.analytics_product_costs (
 workspace_id uuid NOT NULL, connection_id uuid NOT NULL, external_id text NOT NULL,
 sku text CHECK(sku=upper(btrim(sku)) AND length(sku) BETWEEN 1 AND 200),
 cost_cents numeric(24,4) CHECK(cost_cents>=0), active boolean NOT NULL,
 scan_id uuid NOT NULL, checked_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,connection_id,external_id),
 FOREIGN KEY(workspace_id,connection_id) REFERENCES public.analytics_connections(workspace_id,id)
);
CREATE INDEX IF NOT EXISTS analytics_costs_sku ON public.analytics_product_costs(workspace_id,connection_id,sku) WHERE active;
CREATE TABLE IF NOT EXISTS public.analytics_product_cost_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, connection_id uuid NOT NULL,
 external_id text NOT NULL, sku text, cost_cents numeric(24,4), active boolean NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,connection_id) REFERENCES public.analytics_connections(workspace_id,id)
);
CREATE INDEX IF NOT EXISTS analytics_cost_history_sku ON public.analytics_product_cost_history(workspace_id,sku,observed_at DESC);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['analytics_cost_sync','analytics_product_costs','analytics_product_cost_history'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',tab);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',tab);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.analytics_record_cost_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN
 IF TG_OP='INSERT' OR ROW(NEW.sku,NEW.cost_cents,NEW.active) IS DISTINCT FROM ROW(OLD.sku,OLD.cost_cents,OLD.active) THEN
  INSERT INTO analytics_product_cost_history(workspace_id,connection_id,external_id,sku,cost_cents,active)
   VALUES(NEW.workspace_id,NEW.connection_id,NEW.external_id,NEW.sku,NEW.cost_cents,NEW.active);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS analytics_cost_change ON public.analytics_product_costs;
CREATE TRIGGER analytics_cost_change AFTER INSERT OR UPDATE ON public.analytics_product_costs
 FOR EACH ROW EXECUTE FUNCTION public.analytics_record_cost_change();

-- Select by reviewed company identity, never by name/order or by the operational account (Olist 2).
CREATE OR REPLACE FUNCTION public.analytics_seed_cost_sources() RETURNS void
LANGUAGE sql SET search_path=public,pg_temp AS $$
 INSERT INTO analytics_cost_sync(workspace_id,connection_id)
 SELECT c.workspace_id,min(c.id::text)::uuid FROM analytics_connections c
 JOIN analytics_companies co ON co.workspace_id=c.workspace_id AND co.id=c.company_id
 WHERE co.tax_id='13397731000164'
 GROUP BY c.workspace_id HAVING count(*)=1 ON CONFLICT(workspace_id) DO NOTHING;
$$;
SELECT public.analytics_seed_cost_sources();

CREATE OR REPLACE FUNCTION public.analytics_claim_cost_sync() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c analytics_connections; s analytics_cost_sync; token uuid:=gen_random_uuid(); BEGIN
 PERFORM analytics_seed_cost_sources();
 SELECT cn.* INTO c FROM analytics_connections cn JOIN analytics_cost_sync st ON st.workspace_id=cn.workspace_id AND st.connection_id=cn.id
 WHERE cn.enabled AND EXISTS(SELECT 1 FROM analytics_companies co WHERE co.workspace_id=cn.workspace_id AND co.id=cn.company_id AND co.tax_id='13397731000164') AND st.next_at<=now() AND (cn.sync_locked_until IS NULL OR cn.sync_locked_until<now())
 ORDER BY st.next_at,cn.id FOR UPDATE OF cn SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('analytics-account:'||coalesce(c.verified_tax_id,c.workspace_id::text||':'||c.company_id::text),0)) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM analytics_connections other WHERE other.id<>c.id AND other.sync_locked_until>now()
  AND ((c.verified_tax_id IS NOT NULL AND other.verified_tax_id=c.verified_tax_id)
   OR (other.workspace_id=c.workspace_id AND other.company_id=c.company_id))) THEN RETURN NULL; END IF;
 SELECT * INTO s FROM analytics_cost_sync WHERE workspace_id=c.workspace_id FOR UPDATE;
 UPDATE analytics_connections SET sync_lock=token,sync_locked_until=now()+interval '90 seconds'
  WHERE workspace_id=c.workspace_id AND id=c.id;
 RETURN to_jsonb(s)||jsonb_build_object('lease',token,'connection_version',c.version);
END $$;

-- Cache + audit + pagination are one transaction; replay and stale workers cannot advance it.
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
  INSERT INTO analytics_product_costs(workspace_id,connection_id,external_id,sku,cost_cents,active,scan_id)
   SELECT p_workspace,p_connection,x->>'external_id',x->>'sku',(x->>'cost_cents')::numeric,(x->>'active')::boolean,s.scan_id
   FROM jsonb_array_elements(p_products) x
   ON CONFLICT(workspace_id,connection_id,external_id) DO UPDATE SET sku=EXCLUDED.sku,cost_cents=EXCLUDED.cost_cents,
    active=EXCLUDED.active,scan_id=EXCLUDED.scan_id,checked_at=now();
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
   CASE WHEN p_rules->'referenceCosts'->>(c.component->>'target') ~ '^[0-9]+([.][0-9]{1,4})?$'
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


CREATE OR REPLACE FUNCTION public.analytics_olist_cost_rules(p_workspace uuid,p_rules jsonb) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 WITH costs AS (
  SELECT p.sku,min(p.cost_cents)::text cost FROM analytics_product_costs p
  JOIN analytics_cost_sync s ON s.workspace_id=p.workspace_id AND s.connection_id=p.connection_id
  WHERE p.workspace_id=p_workspace AND p.active GROUP BY p.sku
  HAVING count(*)=1 AND min(p.cost_cents)>0
 )
 SELECT p_rules||jsonb_build_object('referenceCosts',coalesce((SELECT jsonb_object_agg(sku,cost) FROM costs),'{}'),
  'costSource',jsonb_build_object('kind','olist','field','precos.precoCusto','policy','current_reference',
   'connectionId',(SELECT connection_id FROM analytics_cost_sync WHERE workspace_id=p_workspace),
   'name',coalesce((SELECT c.name FROM analytics_connections c JOIN analytics_cost_sync s ON s.workspace_id=c.workspace_id AND s.connection_id=c.id WHERE s.workspace_id=p_workspace),'Olist 1'),
   'lastSyncedAt',(SELECT last_synced_at FROM analytics_cost_sync WHERE workspace_id=p_workspace),
   'lastError',(SELECT last_error FROM analytics_cost_sync WHERE workspace_id=p_workspace)));
$$;

CREATE OR REPLACE FUNCTION public.analytics_abc_components_v18(p_workspace uuid,p_actor uuid,p_filters jsonb,p_rules jsonb,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50,p_sort text DEFAULT 'rank',p_direction text DEFAULT 'asc')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 PERFORM analytics_assert_member(p_workspace,p_actor);
 RETURN analytics_abc_components(p_workspace,p_actor,p_filters,analytics_olist_cost_rules(p_workspace,p_rules),p_offset,p_limit,p_sort,p_direction);
END $$;
CREATE OR REPLACE FUNCTION public.analytics_drilldown_components_v18(p_workspace uuid,p_actor uuid,p_filters jsonb,p_rules jsonb,p_entity text,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 PERFORM analytics_assert_member(p_workspace,p_actor);
 RETURN analytics_drilldown_components(p_workspace,p_actor,p_filters,analytics_olist_cost_rules(p_workspace,p_rules),p_entity,p_offset);
END $$;

REVOKE ALL ON FUNCTION public.analytics_record_cost_change(),public.analytics_seed_cost_sources(),public.analytics_claim_cost_sync(),public.analytics_finish_cost_page(uuid,uuid,uuid,integer,integer,jsonb,boolean,text,integer,integer),public.analytics_olist_cost_rules(uuid,jsonb),public.analytics_abc_components_v18(uuid,uuid,jsonb,jsonb,integer,integer,text,text),public.analytics_drilldown_components_v18(uuid,uuid,jsonb,jsonb,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_seed_cost_sources(),public.analytics_claim_cost_sync(),public.analytics_finish_cost_page(uuid,uuid,uuid,integer,integer,jsonb,boolean,text,integer,integer),public.analytics_olist_cost_rules(uuid,jsonb),public.analytics_abc_components_v18(uuid,uuid,jsonb,jsonb,integer,integer,text,text),public.analytics_drilldown_components_v18(uuid,uuid,jsonb,jsonb,text,integer) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
