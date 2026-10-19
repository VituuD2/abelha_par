-- Apply after v12. Reserve distinct accounts in one transaction, preserving
-- the per-account lease, checkpoints, CNPJ checks and operational integration.
BEGIN;
ALTER TABLE public.analytics_sync_jobs ADD COLUMN IF NOT EXISTS last_claimed_at timestamptz;

CREATE OR REPLACE FUNCTION public.analytics_claim_job(p_workspace uuid DEFAULT NULL)
RETURNS SETOF public.analytics_sync_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE conn analytics_connections; job analytics_sync_jobs; token uuid:=gen_random_uuid(); account_key text; BEGIN
 SELECT c.* INTO conn FROM analytics_connections c WHERE c.enabled AND (p_workspace IS NULL OR c.workspace_id=p_workspace)
 AND (c.sync_locked_until IS NULL OR c.sync_locked_until<now())
 AND NOT EXISTS(SELECT 1 FROM analytics_connections other WHERE other.id<>c.id AND other.sync_locked_until>now()
  AND ((c.verified_tax_id IS NOT NULL AND other.verified_tax_id=c.verified_tax_id)
   OR (other.workspace_id=c.workspace_id AND other.company_id=c.company_id)))
 AND EXISTS(SELECT 1 FROM analytics_sync_jobs j WHERE j.workspace_id=c.workspace_id AND j.connection_id=c.id
  AND j.status IN ('queued','retry','running') AND j.next_at<=now() AND (j.lease_until IS NULL OR j.lease_until<now()))
 ORDER BY c.last_processed_at NULLS FIRST,c.id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 account_key:=coalesce(conn.verified_tax_id,conn.workspace_id::text||':'||conn.company_id::text);
 IF NOT pg_try_advisory_xact_lock(hashtextextended('analytics-account:'||account_key,0)) THEN RETURN; END IF;
 -- Also protects two concurrent cron invocations selecting different links to
 -- the same ERP account. The provider limit belongs to the account, not the app.
 IF EXISTS(SELECT 1 FROM analytics_connections other WHERE other.id<>conn.id AND other.sync_locked_until>now()
  AND ((conn.verified_tax_id IS NOT NULL AND other.verified_tax_id=conn.verified_tax_id)
   OR (other.workspace_id=conn.workspace_id AND other.company_id=conn.company_id))) THEN RETURN; END IF;
 -- New recent ranges run promptly; rotate existing ranges so neither the
 -- initial backfill nor incremental updates can starve the other indefinitely.
 SELECT * INTO job FROM analytics_sync_jobs j WHERE workspace_id=conn.workspace_id AND connection_id=conn.id
 AND status IN ('queued','retry','running') AND next_at<=now() AND (lease_until IS NULL OR lease_until<now())
 ORDER BY last_claimed_at NULLS FIRST,to_date DESC,created_at,id FOR UPDATE LIMIT 1;
 UPDATE analytics_connections SET sync_lock=token,sync_locked_until=now()+interval '90 seconds',last_processed_at=now()
  WHERE workspace_id=conn.workspace_id AND id=conn.id;
 RETURN QUERY UPDATE analytics_sync_jobs SET lease_token=token,lease_until=now()+interval '90 seconds',status='running',updated_at=now(),last_claimed_at=now()
  WHERE workspace_id=job.workspace_id AND id=job.id RETURNING *;
END $$;

-- Incrementals can be queued alongside backfills; a per-account lease still
-- serializes execution. Historical gap subtraction retains v12 semantics.
CREATE OR REPLACE FUNCTION public.analytics_schedule_range(p_workspace uuid,p_connection uuid,p_from date,p_to date,p_mode text DEFAULT 'backfill') RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE span record; cursor_day date:=p_from; created integer:=0; BEGIN
 IF p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>3660 OR p_mode NOT IN ('backfill','incremental') THEN RAISE EXCEPTION 'INVALID_RANGE'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('analytics-schedule:'||p_workspace::text||':'||p_connection::text,0));
 PERFORM 1 FROM analytics_connections WHERE workspace_id=p_workspace AND id=p_connection AND enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONNECTION_REQUIRED'; END IF;
 IF p_mode='incremental' THEN
  IF EXISTS(SELECT 1 FROM analytics_sync_jobs WHERE workspace_id=p_workspace AND connection_id=p_connection AND mode='incremental'
   AND (status IN ('queued','running','retry','failed') OR (to_date>=p_to AND updated_at>now()-interval '1 hour'))) THEN RETURN 0; END IF;
  INSERT INTO analytics_sync_jobs(workspace_id,connection_id,mode,from_date,to_date,cursor_date,query_phase,covers_sales)
   VALUES(p_workspace,p_connection,p_mode,p_from,p_to,p_from,'sales',true);
  RETURN 1;
 END IF;
 FOR span IN SELECT from_date,to_date FROM analytics_sync_jobs
  WHERE workspace_id=p_workspace AND connection_id=p_connection AND from_date<=p_to AND to_date>=p_from
   AND ((status='completed' AND (mode='backfill' OR covers_sales)) OR (status IN ('queued','running','retry','failed') AND (mode='backfill' OR covers_sales)))
  ORDER BY from_date,to_date LOOP
  IF span.from_date>cursor_day THEN
   INSERT INTO analytics_sync_jobs(workspace_id,connection_id,mode,from_date,to_date,cursor_date,query_phase,covers_sales)
    VALUES(p_workspace,p_connection,'backfill',cursor_day,least(p_to,span.from_date-1),cursor_day,'sales',true);
   created:=created+1;
  END IF;
  cursor_day:=greatest(cursor_day,span.to_date+1);
  EXIT WHEN cursor_day>p_to;
 END LOOP;
 IF cursor_day<=p_to THEN
  INSERT INTO analytics_sync_jobs(workspace_id,connection_id,mode,from_date,to_date,cursor_date,query_phase,covers_sales)
   VALUES(p_workspace,p_connection,'backfill',cursor_day,p_to,cursor_day,'sales',true);
  created:=created+1;
 END IF;
 RETURN created;
END $$;

CREATE OR REPLACE FUNCTION public.analytics_claim_jobs(p_workspace uuid DEFAULT NULL,p_limit integer DEFAULT 3)
RETURNS SETOF public.analytics_sync_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE slot integer; BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>3 THEN RAISE EXCEPTION 'INVALID_WORKER_LIMIT'; END IF;
 FOR slot IN 1..p_limit LOOP
  -- Each prior claim keeps its account locked, so no account is returned twice.
  RETURN QUERY SELECT * FROM analytics_claim_job(p_workspace);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.analytics_claim_jobs(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_claim_jobs(uuid,integer) TO service_role;
COMMIT;
