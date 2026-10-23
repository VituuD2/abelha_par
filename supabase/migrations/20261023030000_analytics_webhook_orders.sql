-- Apply after analytics v24 and the per-connection webhook migration.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- The operational queue is workspace scoped and cannot distinguish Olist accounts.
CREATE TABLE IF NOT EXISTS public.analytics_webhook_orders (
  workspace_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  external_id text NOT NULL CHECK (external_id ~ '^[1-9][0-9]*$'),
  request_version bigint NOT NULL DEFAULT 1,
  requested_at timestamptz NOT NULL DEFAULT now(),
  next_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, connection_id, external_id),
  FOREIGN KEY (workspace_id, connection_id)
    REFERENCES public.analytics_connections(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS analytics_webhook_orders_due ON public.analytics_webhook_orders(next_at, requested_at);
ALTER TABLE public.analytics_webhook_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_webhook_orders FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.analytics_webhook_orders TO service_role;

CREATE OR REPLACE FUNCTION public.analytics_enqueue_webhook_order(p_workspace uuid, p_connection uuid, p_external text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM 1 FROM analytics_connections WHERE workspace_id=p_workspace AND id=p_connection AND enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONNECTION_REQUIRED'; END IF;
  INSERT INTO analytics_webhook_orders(workspace_id, connection_id, external_id)
    VALUES(p_workspace, p_connection, p_external)
  ON CONFLICT (workspace_id, connection_id, external_id) DO UPDATE
    SET request_version=analytics_webhook_orders.request_version+1;
  -- Preserve requested_at for fairness and next_at for Retry-After on duplicates.
END $$;

-- Borrow a real range job solely for the existing atomic ingest's lease checks.
-- The worker releases it without changing its cursor, stages, counters or coverage.
CREATE OR REPLACE FUNCTION public.analytics_claim_webhook_jobs(p_workspace uuid DEFAULT NULL, p_limit integer DEFAULT 3)
RETURNS SETOF public.analytics_sync_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE conn analytics_connections; job analytics_sync_jobs; token uuid; account_key text;
  today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  FOR conn IN SELECT c.* FROM analytics_connections c
    WHERE c.enabled AND c.error_code IS NULL AND (p_workspace IS NULL OR c.workspace_id=p_workspace)
      AND (c.sync_locked_until IS NULL OR c.sync_locked_until<now())
      AND EXISTS(SELECT 1 FROM analytics_webhook_orders q WHERE q.workspace_id=c.workspace_id
        AND q.connection_id=c.id AND q.next_at<=now())
      AND NOT EXISTS(SELECT 1 FROM analytics_connections other WHERE other.id<>c.id AND other.sync_locked_until>now()
        AND ((c.verified_tax_id IS NOT NULL AND other.verified_tax_id=c.verified_tax_id)
          OR (other.workspace_id=c.workspace_id AND other.company_id=c.company_id)))
    ORDER BY c.last_processed_at NULLS FIRST,c.id FOR UPDATE SKIP LOCKED LIMIT greatest(1,least(p_limit,3))
  LOOP
    account_key:=coalesce(conn.verified_tax_id,conn.workspace_id::text||':'||conn.company_id::text);
    IF NOT pg_try_advisory_xact_lock(hashtextextended('analytics-account:'||account_key,0)) THEN CONTINUE; END IF;
    IF EXISTS(SELECT 1 FROM analytics_connections other WHERE other.id<>conn.id AND other.sync_locked_until>now()
      AND ((conn.verified_tax_id IS NOT NULL AND other.verified_tax_id=conn.verified_tax_id)
        OR (other.workspace_id=conn.workspace_id AND other.company_id=conn.company_id))) THEN CONTINUE; END IF;
    SELECT * INTO job FROM analytics_sync_jobs j WHERE j.workspace_id=conn.workspace_id AND j.connection_id=conn.id
      AND j.status IN ('queued','retry','running') AND (j.lease_until IS NULL OR j.lease_until<now())
      ORDER BY j.created_at,j.id FOR UPDATE LIMIT 1;
    IF NOT FOUND THEN
      -- An account that has never imported still needs an ingest lease and a fallback scan.
      INSERT INTO analytics_sync_jobs(workspace_id,connection_id,mode,from_date,to_date,cursor_date,query_phase,covers_sales)
        VALUES(conn.workspace_id,conn.id,'backfill',today,today,today,'sales',true)
        ON CONFLICT DO NOTHING RETURNING * INTO job;
      IF NOT FOUND THEN CONTINUE; END IF;
    END IF;
    token:=gen_random_uuid();
    UPDATE analytics_connections SET sync_lock=token,sync_locked_until=now()+interval '90 seconds',last_processed_at=now()
      WHERE workspace_id=conn.workspace_id AND id=conn.id;
    RETURN QUERY UPDATE analytics_sync_jobs SET lease_token=token,lease_until=now()+interval '90 seconds',status='running'
      WHERE workspace_id=job.workspace_id AND id=job.id RETURNING *;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.analytics_enqueue_webhook_order(uuid,uuid,text),
  public.analytics_claim_webhook_jobs(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_enqueue_webhook_order(uuid,uuid,text),
  public.analytics_claim_webhook_jobs(uuid,integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
