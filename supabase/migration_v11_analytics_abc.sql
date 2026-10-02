-- Curva ABC: additive, isolated from operational tables. Apply after v10.
BEGIN;
CREATE TABLE IF NOT EXISTS public.analytics_companies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120), tax_id text CHECK (tax_id ~ '^\d{14}$'),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id), UNIQUE(workspace_id,tax_id)
);
CREATE TABLE IF NOT EXISTS public.analytics_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id), company_id uuid NOT NULL,
 name text NOT NULL, provider text NOT NULL DEFAULT 'olist' CHECK(provider='olist'), enabled boolean NOT NULL DEFAULT true,
 legacy_integration_id uuid UNIQUE REFERENCES public.tiny_integrations(id) ON DELETE SET NULL,
 credential_kind text NOT NULL DEFAULT 'oauth' CHECK(credential_kind IN ('legacy','oauth')),
 client_id text, client_secret text, access_token text, refresh_token text, expires_at timestamptz, refresh_expires_at timestamptz,
 verified_tax_id text, verified_at timestamptz, verified_token_fingerprint text, version integer NOT NULL DEFAULT 1,
 refresh_lock uuid, refresh_locked_until timestamptz, sync_lock uuid, sync_locked_until timestamptz,
 oauth_flow uuid, oauth_expires_at timestamptz, last_synced_at timestamptz, incremental_through date, last_processed_at timestamptz, last_error text,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,company_id) REFERENCES public.analytics_companies(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS public.analytics_sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, connection_id uuid NOT NULL,
 external_id text NOT NULL, name text NOT NULL, channel text, kind text NOT NULL DEFAULT 'unknown' CHECK(kind IN ('unknown','marketplace','site','direct','other')),
 marketplace text, store text, external_account text,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,connection_id,external_id),
 FOREIGN KEY(workspace_id,connection_id) REFERENCES public.analytics_connections(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS public.analytics_products (
 workspace_id uuid NOT NULL, connection_id uuid NOT NULL, external_id text NOT NULL,
 sku text, name text NOT NULL, parent_id text, parent_name text, gtin text, category text, brand text,
 enriched_at timestamptz, enrichment_checked_at timestamptz, enrichment_error text, PRIMARY KEY(workspace_id,connection_id,external_id),
 FOREIGN KEY(workspace_id,connection_id) REFERENCES public.analytics_connections(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS public.analytics_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, company_id uuid NOT NULL, connection_id uuid NOT NULL, source_id uuid NOT NULL,
 canonical_key text NOT NULL, external_id text NOT NULL, external_reference text, number text,
 customer_key text NOT NULL, customer_name text NOT NULL, state text, seller text, nature text, tags text[] NOT NULL DEFAULT '{}',
 sale_date date NOT NULL, invoice_date date, invoice_id text, invoice_status integer, invoice_eligible boolean NOT NULL DEFAULT false,
 status integer NOT NULL, total_cents numeric(24,0) NOT NULL CHECK(total_cents>=0), discount_cents numeric(24,0) NOT NULL DEFAULT 0,
 fetched_at timestamptz NOT NULL, quality_flags text[] NOT NULL DEFAULT '{}',
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,canonical_key),
 FOREIGN KEY(workspace_id,company_id) REFERENCES public.analytics_companies(workspace_id,id),
 FOREIGN KEY(workspace_id,connection_id) REFERENCES public.analytics_connections(workspace_id,id),
 FOREIGN KEY(workspace_id,source_id) REFERENCES public.analytics_sources(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS public.analytics_order_aliases (
 workspace_id uuid NOT NULL, connection_id uuid NOT NULL, external_id text NOT NULL, order_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,connection_id,external_id),
 FOREIGN KEY(workspace_id,connection_id) REFERENCES public.analytics_connections(workspace_id,id),
 FOREIGN KEY(workspace_id,order_id) REFERENCES public.analytics_orders(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.analytics_items (
 workspace_id uuid NOT NULL, order_id uuid NOT NULL, position integer NOT NULL, connection_id uuid NOT NULL, product_id text NOT NULL,
 quantity numeric(24,6) NOT NULL CHECK(quantity>0), unit_price numeric(24,6) NOT NULL CHECK(unit_price>=0), gross_cents numeric(24,0) NOT NULL CHECK(gross_cents>=0),
 PRIMARY KEY(workspace_id,order_id,position),
 FOREIGN KEY(workspace_id,order_id) REFERENCES public.analytics_orders(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,connection_id,product_id) REFERENCES public.analytics_products(workspace_id,connection_id,external_id)
);
CREATE TABLE IF NOT EXISTS public.analytics_sync_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, connection_id uuid NOT NULL,
 mode text NOT NULL CHECK(mode IN ('backfill','incremental')), from_date date NOT NULL, to_date date NOT NULL, cursor_date date NOT NULL,
 page_offset integer NOT NULL DEFAULT 0, pending_ids jsonb NOT NULL DEFAULT '[]', pending_index integer NOT NULL DEFAULT 0,
 page_done boolean NOT NULL DEFAULT false, processed integer NOT NULL DEFAULT 0, pages integer NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','retry','completed','failed')),
 attempts integer NOT NULL DEFAULT 0, next_at timestamptz NOT NULL DEFAULT now(), lease_token uuid, lease_until timestamptz,
 last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(from_date<=to_date), FOREIGN KEY(workspace_id,connection_id) REFERENCES public.analytics_connections(workspace_id,id)
);
CREATE INDEX IF NOT EXISTS analytics_orders_scope ON public.analytics_orders(workspace_id,sale_date,status,company_id,source_id);
CREATE INDEX IF NOT EXISTS analytics_orders_invoice_scope ON public.analytics_orders(workspace_id,invoice_date) WHERE invoice_eligible;
CREATE INDEX IF NOT EXISTS analytics_items_product ON public.analytics_items(workspace_id,connection_id,product_id);
CREATE INDEX IF NOT EXISTS analytics_jobs_due ON public.analytics_sync_jobs(next_at,created_at) WHERE status IN ('queued','retry','running');
CREATE UNIQUE INDEX IF NOT EXISTS analytics_jobs_one_range ON public.analytics_sync_jobs(workspace_id,connection_id,mode,from_date,to_date) WHERE status IN ('queued','retry','running');
CREATE INDEX IF NOT EXISTS analytics_jobs_coverage ON public.analytics_sync_jobs(workspace_id,connection_id,from_date,to_date) WHERE status='completed' AND mode='backfill';

-- Link the current integration without copying or rotating its credentials.
INSERT INTO public.analytics_companies(id,workspace_id,name)
 SELECT t.id,t.workspace_id,'Empresa da conexão atual' FROM public.tiny_integrations t ON CONFLICT(id) DO NOTHING;
INSERT INTO public.analytics_connections(id,workspace_id,company_id,name,legacy_integration_id,credential_kind)
 SELECT t.id,t.workspace_id,t.id,'Olist atual',t.id,'legacy' FROM public.tiny_integrations t
 WHERE EXISTS(SELECT 1 FROM public.analytics_companies c WHERE c.id=t.id AND c.workspace_id=t.workspace_id) ON CONFLICT(id) DO NOTHING;

-- Browser access is read-only, workspace scoped. Credential table is never exposed.
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['analytics_companies','analytics_connections','analytics_sources','analytics_products','analytics_orders','analytics_order_aliases','analytics_items','analytics_sync_jobs'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',tab);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',tab);
  EXECUTE format('DROP POLICY IF EXISTS analytics_member_read ON public.%I',tab);
  IF tab<>'analytics_connections' THEN
   EXECUTE format('GRANT SELECT ON public.%I TO authenticated',tab);
   EXECUTE format('CREATE POLICY analytics_member_read ON public.%I FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.user_id=auth.uid() AND m.workspace_id=%I.workspace_id AND m.active))',tab,tab);
  END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.analytics_assert_member(p_workspace uuid,p_actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=p_workspace AND user_id=p_actor AND active) THEN RAISE EXCEPTION 'MEMBER_REQUIRED'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.analytics_coverage(p_workspace uuid,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN PERFORM analytics_assert_member(p_workspace,p_actor);
 RETURN(WITH previous AS(SELECT connection_id,from_date,to_date,max(to_date) OVER(PARTITION BY connection_id ORDER BY from_date,to_date ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) prior_end FROM analytics_sync_jobs WHERE workspace_id=p_workspace AND mode='backfill' AND status='completed'),
 islands AS(SELECT *,sum(CASE WHEN prior_end IS NULL OR from_date>prior_end+1 THEN 1 ELSE 0 END) OVER(PARTITION BY connection_id ORDER BY from_date,to_date) section FROM previous),
 ranges AS(SELECT connection_id,min(from_date) from_date,max(to_date) to_date FROM islands GROUP BY connection_id,section)
 SELECT coalesce(jsonb_agg(jsonb_build_object('connection_id',connection_id,'mode','backfill','status','completed','from_date',from_date,'to_date',to_date)),'[]') FROM ranges);
END $$;

-- Distributed, per-connection lease: concurrent imports and refreshes cannot race the checkpoint.
CREATE OR REPLACE FUNCTION public.analytics_claim_job(p_workspace uuid DEFAULT NULL) RETURNS SETOF public.analytics_sync_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE conn analytics_connections; job analytics_sync_jobs; token uuid:=gen_random_uuid(); BEGIN
 SELECT c.* INTO conn FROM analytics_connections c WHERE c.enabled AND (p_workspace IS NULL OR c.workspace_id=p_workspace)
 AND (c.sync_locked_until IS NULL OR c.sync_locked_until<now())
 AND EXISTS(SELECT 1 FROM analytics_sync_jobs j WHERE j.connection_id=c.id AND j.status IN ('queued','retry','running') AND j.next_at<=now() AND (j.lease_until IS NULL OR j.lease_until<now()))
 ORDER BY c.last_processed_at NULLS FIRST,c.id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT * INTO job FROM analytics_sync_jobs WHERE connection_id=conn.id AND status IN ('queued','retry','running') AND next_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at,id FOR UPDATE LIMIT 1;
 UPDATE analytics_connections SET sync_lock=token,sync_locked_until=now()+interval '90 seconds',last_processed_at=now() WHERE id=conn.id;
 RETURN QUERY UPDATE analytics_sync_jobs SET lease_token=token,lease_until=now()+interval '90 seconds',status='running',updated_at=now() WHERE id=job.id RETURNING *;
END $$;

-- All order + product + item mutations commit atomically. Retry replaces items instead of summing.
CREATE OR REPLACE FUNCTION public.analytics_ingest(p_job uuid,p_lease uuid,p_order jsonb,p_items jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job analytics_sync_jobs; conn analytics_connections; source analytics_sources; target analytics_orders; item jsonb; key text; oid uuid; BEGIN
 SELECT * INTO job FROM analytics_sync_jobs WHERE id=p_job AND lease_token=p_lease AND lease_until>now() AND status='running' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_LOST'; END IF;
 SELECT * INTO conn FROM analytics_connections WHERE id=job.connection_id AND workspace_id=job.workspace_id AND enabled AND sync_lock=p_lease;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONNECTION_NOT_FOUND'; END IF;
 SELECT * INTO source FROM analytics_sources WHERE id=(p_order->>'source_id')::uuid AND workspace_id=job.workspace_id AND connection_id=conn.id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SOURCE_NOT_FOUND'; END IF;
 key:=CASE WHEN source.external_account IS NOT NULL AND nullif(p_order->>'external_reference','') IS NOT NULL THEN 'account:'||jsonb_build_array(source.external_account,p_order->>'external_reference')::text ELSE 'olist:'||conn.id::text||':'||(p_order->>'external_id') END;
 -- Serialize the canonical key across ERP accounts too.
 PERFORM pg_advisory_xact_lock(hashtextextended(job.workspace_id::text||key,0));
 SELECT o.* INTO target FROM analytics_order_aliases a JOIN analytics_orders o ON o.id=a.order_id AND o.workspace_id=a.workspace_id WHERE a.workspace_id=job.workspace_id AND a.connection_id=conn.id AND a.external_id=p_order->>'external_id' FOR UPDATE OF o;
 IF FOUND AND target.canonical_key<>key THEN RAISE EXCEPTION 'IDENTITY_CHANGED_REQUIRES_RECONCILIATION'; END IF;
 IF NOT FOUND THEN SELECT * INTO target FROM analytics_orders WHERE workspace_id=job.workspace_id AND canonical_key=key FOR UPDATE; END IF;
 oid:=coalesce(target.id,gen_random_uuid());
 INSERT INTO analytics_order_aliases(workspace_id,connection_id,external_id,order_id)
 SELECT job.workspace_id,conn.id,p_order->>'external_id',oid WHERE target.id IS NOT NULL ON CONFLICT DO NOTHING;
 -- Explicitly shared external account: deterministic origin (connection UUID) wins.
 IF target.id IS NOT NULL AND (target.connection_id<conn.id OR (target.connection_id=conn.id AND target.fetched_at>(p_order->>'fetched_at')::timestamptz)) THEN RETURN oid; END IF;
 INSERT INTO analytics_orders(id,workspace_id,company_id,connection_id,source_id,canonical_key,external_id,external_reference,number,customer_key,customer_name,state,seller,nature,tags,sale_date,invoice_date,invoice_id,invoice_status,invoice_eligible,status,total_cents,discount_cents,fetched_at,quality_flags)
 VALUES(oid,job.workspace_id,conn.company_id,conn.id,source.id,key,p_order->>'external_id',p_order->>'external_reference',p_order->>'number',p_order->>'customer_key',p_order->>'customer_name',p_order->>'state',p_order->>'seller',p_order->>'nature',ARRAY(SELECT jsonb_array_elements_text(coalesce(p_order->'tags','[]'))),(p_order->>'sale_date')::date,(p_order->>'invoice_date')::date,p_order->>'invoice_id',(p_order->>'invoice_status')::integer,coalesce((p_order->>'invoice_eligible')::boolean,false),(p_order->>'status')::integer,(p_order->>'total_cents')::numeric,coalesce((p_order->>'discount_cents')::numeric,0),(p_order->>'fetched_at')::timestamptz,ARRAY(SELECT jsonb_array_elements_text(coalesce(p_order->'quality_flags','[]'))))
 ON CONFLICT(workspace_id,canonical_key) DO UPDATE SET company_id=excluded.company_id,connection_id=excluded.connection_id,source_id=excluded.source_id,external_id=excluded.external_id,external_reference=excluded.external_reference,number=excluded.number,customer_key=excluded.customer_key,customer_name=excluded.customer_name,state=excluded.state,seller=excluded.seller,nature=excluded.nature,tags=excluded.tags,sale_date=excluded.sale_date,invoice_date=excluded.invoice_date,invoice_id=excluded.invoice_id,invoice_status=excluded.invoice_status,invoice_eligible=excluded.invoice_eligible,status=excluded.status,total_cents=excluded.total_cents,discount_cents=excluded.discount_cents,fetched_at=excluded.fetched_at,quality_flags=excluded.quality_flags;
 INSERT INTO analytics_order_aliases VALUES(job.workspace_id,conn.id,p_order->>'external_id',oid) ON CONFLICT DO NOTHING;
 DELETE FROM analytics_items WHERE workspace_id=job.workspace_id AND order_id=oid;
 FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
  INSERT INTO analytics_products(workspace_id,connection_id,external_id,sku,name,parent_id,parent_name,gtin,category,brand,enriched_at,enrichment_error)
  VALUES(job.workspace_id,conn.id,item->>'product_id',item->>'sku',item->>'name',item->>'parent_id',item->>'parent_name',item->>'gtin',item->>'category',item->>'brand',(item->>'enriched_at')::timestamptz,item->>'enrichment_error')
  ON CONFLICT(workspace_id,connection_id,external_id) DO UPDATE SET sku=excluded.sku,name=excluded.name,parent_id=coalesce(excluded.parent_id,analytics_products.parent_id),parent_name=coalesce(excluded.parent_name,analytics_products.parent_name),gtin=coalesce(excluded.gtin,analytics_products.gtin),category=coalesce(excluded.category,analytics_products.category),brand=coalesce(excluded.brand,analytics_products.brand),enriched_at=coalesce(excluded.enriched_at,analytics_products.enriched_at),enrichment_error=excluded.enrichment_error;
  INSERT INTO analytics_items VALUES(job.workspace_id,oid,(item->>'position')::integer,conn.id,item->>'product_id',(item->>'quantity')::numeric,(item->>'unit_price')::numeric,(item->>'gross_cents')::numeric);
 END LOOP;
 RETURN oid;
END $$;

-- Admin-confirmed account mapping; aliases survive reconciliation and losing copies are removed atomically.
CREATE OR REPLACE FUNCTION public.analytics_reconcile_source(p_workspace uuid,p_actor uuid,p_source uuid,p_kind text,p_marketplace text,p_store text,p_account text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE source analytics_sources; sale analytics_orders; other analytics_orders; key text; merged integer:=0; BEGIN
 IF NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=p_workspace AND user_id=p_actor AND active AND role='admin') THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
 IF p_kind<>ALL(ARRAY['unknown','marketplace','site','direct','other']) OR length(p_account)>160 THEN RAISE EXCEPTION 'INVALID_SOURCE'; END IF;
 UPDATE analytics_sources SET kind=p_kind,marketplace=nullif(p_marketplace,''),store=nullif(p_store,''),external_account=nullif(p_account,'') WHERE id=p_source AND workspace_id=p_workspace RETURNING * INTO source;
 IF NOT FOUND THEN RAISE EXCEPTION 'SOURCE_NOT_FOUND'; END IF;
 FOR sale IN SELECT * FROM analytics_orders WHERE workspace_id=p_workspace AND source_id=p_source ORDER BY id LOOP
  key:=CASE WHEN source.external_account IS NOT NULL AND nullif(sale.external_reference,'') IS NOT NULL THEN 'account:'||jsonb_build_array(source.external_account,sale.external_reference)::text ELSE 'olist:'||sale.connection_id::text||':'||sale.external_id END;
  IF key=sale.canonical_key THEN CONTINUE; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace::text||key,0));
  SELECT * INTO other FROM analytics_orders WHERE workspace_id=p_workspace AND canonical_key=key AND id<>sale.id FOR UPDATE;
  IF FOUND THEN
   IF other.connection_id<sale.connection_id THEN
    UPDATE analytics_order_aliases SET order_id=other.id WHERE workspace_id=p_workspace AND order_id=sale.id;
    DELETE FROM analytics_orders WHERE workspace_id=p_workspace AND id=sale.id;
   ELSE
    UPDATE analytics_order_aliases SET order_id=sale.id WHERE workspace_id=p_workspace AND order_id=other.id;
    DELETE FROM analytics_orders WHERE workspace_id=p_workspace AND id=other.id;
    UPDATE analytics_orders SET canonical_key=key WHERE workspace_id=p_workspace AND id=sale.id;
   END IF;
   merged:=merged+1;
  ELSE UPDATE analytics_orders SET canonical_key=key WHERE workspace_id=p_workspace AND id=sale.id; END IF;
 END LOOP;
 RETURN merged;
END $$;

CREATE OR REPLACE FUNCTION public.analytics_match(p_filters jsonb,p_key text,p_value text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(jsonb_array_length(p_filters->'selections'->p_key),0)=0 OR coalesce(p_filters->'selections'->p_key,'[]') ? coalesce(p_value,'');
$$;

-- Cancel known canonical sales even if the provider no longer returns their items.
CREATE OR REPLACE FUNCTION public.analytics_cancel_order(p_job uuid,p_lease uuid,p_external text,p_fetched timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job analytics_sync_jobs; BEGIN
 SELECT * INTO job FROM analytics_sync_jobs WHERE id=p_job AND lease_token=p_lease AND lease_until>now() AND status='running' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_LOST'; END IF;
 IF NOT EXISTS(SELECT 1 FROM analytics_connections WHERE id=job.connection_id AND workspace_id=job.workspace_id AND enabled AND sync_lock=p_lease) THEN RAISE EXCEPTION 'CONNECTION_NOT_FOUND'; END IF;
 UPDATE analytics_orders o SET status=2,fetched_at=p_fetched WHERE o.workspace_id=job.workspace_id AND o.connection_id=job.connection_id AND o.fetched_at<=p_fetched
 AND EXISTS(SELECT 1 FROM analytics_order_aliases a WHERE a.workspace_id=job.workspace_id AND a.connection_id=job.connection_id AND a.external_id=p_external AND a.order_id=o.id);
END $$;

-- Reused by ranking and drilldown: filters are applied BEFORE aggregation.
CREATE OR REPLACE FUNCTION public.analytics_filtered_items(p_workspace uuid,p_filters jsonb)
RETURNS TABLE(entity_id text,entity_name text,sku text,quantity numeric,gross_cents numeric,order_id uuid,company_id uuid,source_id uuid,connection_id uuid) LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT CASE p_filters->>'grouping' WHEN 'customer' THEN o.customer_key WHEN 'parent' THEN i.connection_id::text||':'||coalesce(p.parent_id,p.external_id) ELSE i.connection_id::text||':'||p.external_id END,
 CASE p_filters->>'grouping' WHEN 'customer' THEN o.customer_name WHEN 'parent' THEN coalesce(p.parent_name,p.name) ELSE p.name END,
 CASE WHEN p_filters->>'grouping'='customer' THEN '' WHEN p_filters->>'grouping'='parent' THEN coalesce(p.parent_id,p.sku,'') ELSE coalesce(p.sku,'') END,
 i.quantity,i.gross_cents,o.id,o.company_id,o.source_id,o.connection_id
 FROM analytics_orders o JOIN analytics_items i ON i.workspace_id=o.workspace_id AND i.order_id=o.id
 JOIN analytics_products p ON p.workspace_id=i.workspace_id AND p.connection_id=i.connection_id AND p.external_id=i.product_id
 JOIN analytics_sources s ON s.workspace_id=o.workspace_id AND s.id=o.source_id
 WHERE o.workspace_id=p_workspace AND o.status<>2
 AND CASE WHEN p_filters->>'basis'='invoiced' THEN o.invoice_date ELSE o.sale_date END BETWEEN (p_filters->>'from')::date AND (p_filters->>'to')::date
 AND (p_filters->>'basis'<>'invoiced' OR o.invoice_eligible)
 AND analytics_match(p_filters,'companies',o.company_id::text) AND analytics_match(p_filters,'connections',o.connection_id::text)
 AND analytics_match(p_filters,'sources',o.source_id::text) AND analytics_match(p_filters,'channels',s.channel)
 AND analytics_match(p_filters,'sourceKinds',s.kind)
 AND analytics_match(p_filters,'marketplaces',s.marketplace) AND analytics_match(p_filters,'stores',s.store) AND analytics_match(p_filters,'accounts',s.external_account)
 AND analytics_match(p_filters,'statuses',o.status::text) AND analytics_match(p_filters,'products',p.connection_id::text||':'||p.external_id) AND analytics_match(p_filters,'skus',p.sku)
 AND analytics_match(p_filters,'parents',CASE WHEN p.parent_id IS NOT NULL THEN p.connection_id::text||':'||p.parent_id END) AND analytics_match(p_filters,'categories',p.category) AND analytics_match(p_filters,'brands',p.brand)
 AND analytics_match(p_filters,'customers',o.customer_key) AND analytics_match(p_filters,'natures',o.nature) AND analytics_match(p_filters,'sellers',o.seller) AND analytics_match(p_filters,'states',o.state)
 AND (coalesce(jsonb_array_length(p_filters->'selections'->'tags'),0)=0 OR o.tags && ARRAY(SELECT jsonb_array_elements_text(p_filters->'selections'->'tags')));
$$;

CREATE OR REPLACE FUNCTION public.analytics_abc(p_workspace uuid,p_actor uuid,p_filters jsonb,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50,p_sort text DEFAULT 'rank',p_direction text DEFAULT 'asc') RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; BEGIN
 PERFORM analytics_assert_member(p_workspace,p_actor);
 IF NOT (p_filters->>'mode'=ANY(ARRAY['TINY_LEGACY','STRICT_CUMULATIVE'])) OR NOT (p_filters->>'metric'=ANY(ARRAY['revenue','quantity'])) OR NOT (0<(p_filters->>'thresholdA')::numeric AND (p_filters->>'thresholdA')::numeric<(p_filters->>'thresholdB')::numeric AND (p_filters->>'thresholdB')::numeric<100) THEN RAISE EXCEPTION 'INVALID_FILTERS'; END IF;
 RETURN (WITH filtered AS MATERIALIZED (SELECT * FROM analytics_filtered_items(p_workspace,p_filters)),
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
 'pareto',coalesce((SELECT jsonb_agg(row ORDER BY rank) FROM payload WHERE rank<=60),'[]'),'generatedAt',now()));
END $$;

CREATE OR REPLACE FUNCTION public.analytics_drilldown(p_workspace uuid,p_actor uuid,p_filters jsonb,p_entity text,p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN PERFORM analytics_assert_member(p_workspace,p_actor);
 RETURN(WITH matches AS MATERIALIZED(SELECT * FROM analytics_filtered_items(p_workspace,p_filters) WHERE entity_id=p_entity),
 sales AS(SELECT order_id,company_id,source_id,sum(gross_cents) revenue,sum(quantity) quantity FROM matches GROUP BY order_id,company_id,source_id)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM sales),'companies',coalesce((SELECT jsonb_agg(row) FROM(SELECT jsonb_build_object('name',c.name,'revenue',sum(s.revenue)::text,'quantity',sum(s.quantity)::text,'orders',count(*)) row FROM sales s JOIN analytics_companies c ON c.id=s.company_id GROUP BY c.id,c.name) x),'[]'),
 'channels',coalesce((SELECT jsonb_agg(row) FROM(SELECT jsonb_build_object('name',src.name,'revenue',sum(s.revenue)::text,'quantity',sum(s.quantity)::text,'orders',count(*)) row FROM sales s JOIN analytics_sources src ON src.id=s.source_id GROUP BY src.id,src.name) x),'[]'),
 'orders',coalesce((SELECT jsonb_agg(row) FROM(SELECT jsonb_build_object('id',o.external_id,'number',o.number,'date',o.sale_date,'status',o.status,'company',c.name,'source',src.name,'connection',cn.name,'revenue',s.revenue::text,'quantity',s.quantity::text) row FROM sales s JOIN analytics_orders o ON o.id=s.order_id JOIN analytics_companies c ON c.id=s.company_id JOIN analytics_sources src ON src.id=s.source_id JOIN analytics_connections cn ON cn.id=o.connection_id ORDER BY o.sale_date DESC,o.id OFFSET greatest(p_offset,0) LIMIT 50) x),'[]')));
END $$;

CREATE OR REPLACE FUNCTION public.analytics_options(p_workspace uuid,p_actor uuid,p_dimension text DEFAULT NULL,p_search text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN PERFORM analytics_assert_member(p_workspace,p_actor);
 RETURN(WITH dimension_values AS (
 SELECT 'companies' dim,id::text value,name label FROM analytics_companies WHERE workspace_id=p_workspace
 UNION ALL SELECT 'connections',id::text,name FROM analytics_connections WHERE workspace_id=p_workspace
 UNION ALL SELECT 'sources',id::text,name FROM analytics_sources WHERE workspace_id=p_workspace
 UNION ALL SELECT DISTINCT 'sourceKinds',kind,CASE kind WHEN 'marketplace' THEN 'Marketplace' WHEN 'site' THEN 'Site' WHEN 'direct' THEN 'Venda direta' WHEN 'unknown' THEN 'Não classificado' ELSE 'Outro' END FROM analytics_sources WHERE workspace_id=p_workspace
 UNION ALL SELECT v.dim,v.value,v.value FROM analytics_sources s CROSS JOIN LATERAL(VALUES('channels',s.channel),('marketplaces',s.marketplace),('stores',s.store),('accounts',s.external_account)) v(dim,value) WHERE s.workspace_id=p_workspace AND nullif(v.value,'') IS NOT NULL
 UNION ALL SELECT DISTINCT v.dim,v.value,v.value FROM analytics_products p CROSS JOIN LATERAL(VALUES('skus',p.sku),('categories',p.category),('brands',p.brand)) v(dim,value) WHERE p.workspace_id=p_workspace AND nullif(v.value,'') IS NOT NULL
 UNION ALL SELECT DISTINCT 'parents',p.connection_id::text||':'||p.parent_id,coalesce(p.parent_name,p.parent_id)||' · '||c.name FROM analytics_products p JOIN analytics_connections c ON c.id=p.connection_id WHERE p.workspace_id=p_workspace AND p.parent_id IS NOT NULL
 UNION ALL SELECT DISTINCT 'products',p.connection_id::text||':'||p.external_id,p.name||coalesce(' · '||p.sku,'')||' · '||c.name FROM analytics_products p JOIN analytics_connections c ON c.id=p.connection_id WHERE p.workspace_id=p_workspace
 UNION ALL SELECT DISTINCT 'customers',customer_key,customer_name FROM analytics_orders WHERE workspace_id=p_workspace
 UNION ALL SELECT DISTINCT v.dim,v.value,v.value FROM analytics_orders o CROSS JOIN LATERAL(VALUES('statuses',o.status::text),('natures',o.nature),('sellers',o.seller),('states',o.state)) v(dim,value) WHERE o.workspace_id=p_workspace AND nullif(v.value,'') IS NOT NULL
 UNION ALL SELECT DISTINCT 'tags',unnest(tags),unnest(tags) FROM analytics_orders WHERE workspace_id=p_workspace
 ),dedup AS(SELECT dim,value,min(label) label FROM dimension_values WHERE (p_dimension IS NULL OR dim=p_dimension) AND (p_search='' OR strpos(lower(label),lower(p_search))>0) GROUP BY dim,value), bounded AS(SELECT *,row_number() OVER(PARTITION BY dim ORDER BY label,value) n FROM dedup),grouped AS(SELECT dim,jsonb_agg(jsonb_build_object('value',value,'label',label) ORDER BY label) options FROM bounded WHERE n<=200 GROUP BY dim)
 SELECT coalesce(jsonb_object_agg(dim,options),'{}') FROM grouped);
END $$;

REVOKE ALL ON FUNCTION public.analytics_assert_member(uuid,uuid),public.analytics_coverage(uuid,uuid),public.analytics_claim_job(uuid),public.analytics_ingest(uuid,uuid,jsonb,jsonb),public.analytics_cancel_order(uuid,uuid,text,timestamptz),public.analytics_reconcile_source(uuid,uuid,uuid,text,text,text,text),public.analytics_match(jsonb,text,text),public.analytics_filtered_items(uuid,jsonb),public.analytics_abc(uuid,uuid,jsonb,integer,integer,text,text),public.analytics_drilldown(uuid,uuid,jsonb,text,integer),public.analytics_options(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_assert_member(uuid,uuid),public.analytics_coverage(uuid,uuid),public.analytics_claim_job(uuid),public.analytics_ingest(uuid,uuid,jsonb,jsonb),public.analytics_cancel_order(uuid,uuid,text,timestamptz),public.analytics_reconcile_source(uuid,uuid,uuid,text,text,text,text),public.analytics_match(jsonb,text,text),public.analytics_filtered_items(uuid,jsonb),public.analytics_abc(uuid,uuid,jsonb,integer,integer,text,text),public.analytics_drilldown(uuid,uuid,jsonb,text,integer),public.analytics_options(uuid,uuid,text,text) TO service_role;
COMMIT;
