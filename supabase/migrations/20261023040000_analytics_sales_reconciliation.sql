-- Apply after analytics v24. Uses existing range jobs without changing the sweep or webhook queue.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.analytics_sales_reconciliation (
  workspace_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  sale_day date NOT NULL,
  run_day date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','matched','diverged','failed')),
  api_calls integer NOT NULL DEFAULT 0 CHECK(api_calls BETWEEN 0 AND 2),
  connection_version integer NOT NULL DEFAULT 0,
  olist_count bigint CHECK(olist_count>=0),
  abc_count bigint CHECK(abc_count>=0),
  olist_total_cents numeric(24,0),
  abc_total_cents numeric(24,0),
  checked_at timestamptz,
  next_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  requeued_job_id uuid REFERENCES public.analytics_sync_jobs(id) ON DELETE SET NULL,
  PRIMARY KEY(workspace_id,connection_id,sale_day),
  FOREIGN KEY(workspace_id,connection_id) REFERENCES public.analytics_connections(workspace_id,id) ON DELETE CASCADE
);
ALTER TABLE public.analytics_sales_reconciliation ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS analytics_sales_reconciliation_due
  ON public.analytics_sales_reconciliation(run_day,sale_day DESC,next_at) WHERE status='pending';
REVOKE ALL ON public.analytics_sales_reconciliation FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.analytics_sales_reconciliation TO service_role;

-- The minute cron calls this only at 02:00-05:00 America/Sao_Paulo.
-- Today and yesterday precede older days; each date is attempted once per daily run.
CREATE OR REPLACE FUNCTION public.analytics_claim_reconciliation(p_run date)
RETURNS SETOF public.analytics_sales_reconciliation LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item analytics_sales_reconciliation; conn analytics_connections; token uuid:=gen_random_uuid(); account_key text;
BEGIN
  IF p_run IS NULL OR p_run<>(now() AT TIME ZONE 'America/Sao_Paulo')::date THEN RAISE EXCEPTION 'INVALID_RUN_DAY'; END IF;
  INSERT INTO analytics_sales_reconciliation(workspace_id,connection_id,sale_day,run_day)
    SELECT c.workspace_id,c.id,p_run-offset_day,p_run FROM analytics_connections c
      JOIN analytics_companies co ON co.workspace_id=c.workspace_id AND co.id=c.company_id
      CROSS JOIN generate_series(0,6) offset_day
    WHERE c.enabled AND c.error_code IS NULL AND c.last_synced_at IS NOT NULL AND c.verified_tax_id=co.tax_id
    ON CONFLICT(workspace_id,connection_id,sale_day) DO UPDATE SET
      run_day=excluded.run_day,status='pending',api_calls=0,olist_count=null,abc_count=null,
      olist_total_cents=null,abc_total_cents=null,checked_at=null,next_at=now(),
      lease_token=null,lease_until=null,requeued_job_id=null
    WHERE analytics_sales_reconciliation.run_day<excluded.run_day
      AND (analytics_sales_reconciliation.lease_until IS NULL OR analytics_sales_reconciliation.lease_until<now());
  SELECT q.* INTO item FROM analytics_sales_reconciliation q
    JOIN analytics_connections c ON c.workspace_id=q.workspace_id AND c.id=q.connection_id
    JOIN analytics_companies co ON co.workspace_id=c.workspace_id AND co.id=c.company_id
    WHERE q.run_day=p_run AND q.status='pending' AND q.api_calls=0 AND q.next_at<=now()
      AND c.enabled AND c.error_code IS NULL AND c.verified_tax_id=co.tax_id
      AND (c.sync_locked_until IS NULL OR c.sync_locked_until<now())
      AND NOT EXISTS(SELECT 1 FROM analytics_connections other WHERE other.id<>c.id AND other.sync_locked_until>now()
        AND ((c.verified_tax_id IS NOT NULL AND other.verified_tax_id=c.verified_tax_id)
          OR (other.workspace_id=c.workspace_id AND other.company_id=c.company_id)))
    ORDER BY q.sale_day DESC,c.last_processed_at NULLS FIRST,c.id FOR UPDATE OF c,q SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO conn FROM analytics_connections WHERE workspace_id=item.workspace_id AND id=item.connection_id;
  account_key:=coalesce(conn.verified_tax_id,conn.workspace_id::text||':'||conn.company_id::text);
  IF NOT pg_try_advisory_xact_lock(hashtextextended('analytics-account:'||account_key,0)) THEN RETURN; END IF;
  IF EXISTS(SELECT 1 FROM analytics_connections other WHERE other.id<>conn.id AND other.sync_locked_until>now()
    AND ((conn.verified_tax_id IS NOT NULL AND other.verified_tax_id=conn.verified_tax_id)
      OR (other.workspace_id=conn.workspace_id AND other.company_id=conn.company_id))) THEN RETURN; END IF;
  UPDATE analytics_connections SET sync_lock=token,sync_locked_until=now()+interval '90 seconds',last_processed_at=now()
    WHERE workspace_id=conn.workspace_id AND id=conn.id;
  RETURN QUERY UPDATE analytics_sales_reconciliation SET status='running',lease_token=token,
      lease_until=now()+interval '90 seconds',connection_version=conn.version
    WHERE workspace_id=item.workspace_id AND connection_id=item.connection_id AND sale_day=item.sale_day RETURNING *;
END $$;

-- Reserve before HTTP, so a crash or retry can never exceed two calls/date/run.
CREATE OR REPLACE FUNCTION public.analytics_reconciliation_call(p_connection uuid,p_day date,p_lease uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  UPDATE analytics_sales_reconciliation q SET api_calls=q.api_calls+1
    WHERE q.connection_id=p_connection AND q.sale_day=p_day AND q.lease_token=p_lease
      AND q.lease_until>now() AND q.status='running' AND q.api_calls<2
      AND EXISTS(SELECT 1 FROM analytics_connections c WHERE c.workspace_id=q.workspace_id AND c.id=q.connection_id
        AND c.enabled AND c.version=q.connection_version AND c.sync_lock=p_lease AND c.sync_locked_until>now());
  IF NOT FOUND THEN RAISE EXCEPTION 'RECONCILIATION_LEASE_OR_CALL_LIMIT'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.analytics_finish_reconciliation(p_connection uuid,p_day date,p_lease uuid,
  p_count bigint DEFAULT NULL,p_cents numeric DEFAULT NULL,p_retry integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item analytics_sales_reconciliation; local_count bigint; local_cents numeric; diverged boolean; target uuid;
BEGIN
  SELECT * INTO item FROM analytics_sales_reconciliation WHERE connection_id=p_connection AND sale_day=p_day
    AND lease_token=p_lease AND lease_until>now() AND status='running' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECONCILIATION_LEASE_CHANGED'; END IF;
  PERFORM 1 FROM analytics_connections WHERE workspace_id=item.workspace_id AND id=p_connection AND enabled
    AND version=item.connection_version AND sync_lock=p_lease AND sync_locked_until>now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONNECTION_CHANGED'; END IF;
  IF p_count<0 OR p_cents<>trunc(p_cents) THEN RAISE EXCEPTION 'INVALID_RECONCILIATION_TOTAL'; END IF;
  -- Aliases retain per-ERP identity even when two connections share one canonical sale.
  -- Unknown cancellations are not ingested as sales; exclude cancellations on both sides.
  SELECT count(*),coalesce(sum(o.total_cents),0) INTO local_count,local_cents
    FROM analytics_order_aliases a JOIN analytics_orders o ON o.workspace_id=a.workspace_id AND o.id=a.order_id
    WHERE a.workspace_id=item.workspace_id AND a.connection_id=p_connection AND o.sale_date=p_day AND o.status<>2;
  diverged:=p_count IS NOT NULL AND (local_count<>p_count OR (p_cents IS NOT NULL AND local_cents<>p_cents));
  IF diverged THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('analytics-schedule:'||item.workspace_id::text||':'||p_connection::text,0));
    SELECT id INTO target FROM analytics_sync_jobs WHERE workspace_id=item.workspace_id AND connection_id=p_connection
      AND mode='backfill' AND from_date=p_day AND to_date=p_day AND status IN ('queued','running','retry','failed')
      ORDER BY created_at,id LIMIT 1;
    IF NOT FOUND THEN
      -- Force a fresh day even when old coverage says completed. Use the existing importer unchanged.
      INSERT INTO analytics_sync_jobs(workspace_id,connection_id,mode,from_date,to_date,cursor_date,query_phase,covers_sales)
        VALUES(item.workspace_id,p_connection,'backfill',p_day,p_day,p_day,'sales',true) RETURNING id INTO target;
    ELSE
      UPDATE analytics_sync_jobs SET status='queued',next_at=now(),last_error=null,error_code=null
        WHERE id=target AND status='failed';
    END IF;
  END IF;
  UPDATE analytics_sales_reconciliation SET olist_count=p_count,abc_count=local_count,
    olist_total_cents=p_cents,abc_total_cents=local_cents,checked_at=now(),
    status=CASE WHEN p_count IS NULL THEN 'failed' WHEN diverged THEN 'diverged' ELSE 'matched' END,
    requeued_job_id=target,lease_token=null,lease_until=null
    WHERE workspace_id=item.workspace_id AND connection_id=p_connection AND sale_day=p_day;
  IF p_retry IS NOT NULL THEN
    UPDATE analytics_sales_reconciliation SET next_at=greatest(next_at,now()+make_interval(secs=>greatest(1,least(p_retry,3600))))
      WHERE workspace_id=item.workspace_id AND connection_id=p_connection AND run_day=item.run_day AND status='pending';
  END IF;
  UPDATE analytics_connections SET sync_lock=null,sync_locked_until=null
    WHERE workspace_id=item.workspace_id AND id=p_connection AND sync_lock=p_lease;
  RETURN jsonb_build_object('checked',CASE WHEN p_count IS NULL THEN 0 ELSE 1 END,'requeued',CASE WHEN target IS NULL THEN 0 ELSE 1 END);
END $$;

REVOKE ALL ON FUNCTION public.analytics_claim_reconciliation(date),public.analytics_reconciliation_call(uuid,date,uuid),
  public.analytics_finish_reconciliation(uuid,date,uuid,bigint,numeric,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_claim_reconciliation(date),public.analytics_reconciliation_call(uuid,date,uuid),
  public.analytics_finish_reconciliation(uuid,date,uuid,bigint,numeric,integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
