-- Apply after v23, before publishing the importer that uses this checkpoint.
-- Additive: preserves jobs, pending IDs, cursors, counters, costs and credentials.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF to_regprocedure('public.olist_api_usage(uuid,uuid,integer)') IS NULL
  OR to_regprocedure('public.analytics_claim_jobs(uuid,integer)') IS NULL
  OR to_regprocedure('public.analytics_cost_history_status(uuid)') IS NULL
 THEN RAISE EXCEPTION 'APPLY_ANALYTICS_V13_V19_AND_V23_FIRST'; END IF;  
END $$;
ALTER TABLE public.analytics_sync_jobs
 ADD COLUMN IF NOT EXISTS lane text NOT NULL DEFAULT 'history' CHECK(lane IN ('history','recent')),
 ADD COLUMN IF NOT EXISTS import_state jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(import_state)='object' AND pg_column_size(import_state)<=1048576);

-- Server-only context; no credential values. A valid lease scopes the read.
CREATE OR REPLACE FUNCTION public.analytics_import_context(p_job uuid,p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j analytics_sync_jobs; c analytics_connections; floor_day date; BEGIN
 SELECT * INTO j FROM analytics_sync_jobs WHERE id=p_job AND lease_token=p_lease AND lease_until>now() AND status='running';
 IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_CHANGED'; END IF;
 SELECT * INTO c FROM analytics_connections WHERE workspace_id=j.workspace_id AND id=j.connection_id AND enabled;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONNECTION_CHANGED'; END IF;
 SELECT least(j.from_date,min(from_date)) INTO floor_day FROM analytics_sync_jobs
  WHERE workspace_id=j.workspace_id AND connection_id=j.connection_id AND lane='history';
 RETURN jsonb_build_object('historyFrom',floor_day,'connectionVersion',c.version,
  'creationThrough',greatest(j.to_date,(now() AT TIME ZONE 'America/Sao_Paulo')::date));
END $$;

-- Completion and watermark commit together, under the original account lease.
CREATE OR REPLACE FUNCTION public.analytics_finish_import(p_job uuid,p_lease uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j analytics_sync_jobs; BEGIN
 SELECT * INTO j FROM analytics_sync_jobs WHERE id=p_job AND lease_token=p_lease AND lease_until>now() AND status='running' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_CHANGED'; END IF;
 IF NOT j.page_done OR j.pending_index<jsonb_array_length(j.pending_ids)
  OR (j.lane='recent' AND j.cursor_date>j.from_date)
  OR (j.lane<>'recent' AND j.cursor_date<j.to_date)
  OR (j.mode='incremental' AND (j.query_phase<>'updates' OR NOT coalesce(
   (j.import_state#>>'{scan,version}')::integer=2 AND
   (j.import_state#>>'{scan,to}')::date>=(j.import_state#>>'{scan,ceiling}')::date,false)))
 THEN RAISE EXCEPTION 'IMPORT_NOT_COMPLETE'; END IF;
 UPDATE analytics_connections SET last_synced_at=now(),last_error=null,error_code=null,
  incremental_through=CASE WHEN j.mode='incremental' THEN greatest(incremental_through,j.to_date) ELSE incremental_through END
  WHERE workspace_id=j.workspace_id AND id=j.connection_id AND sync_lock=p_lease AND enabled;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_CHANGED'; END IF;
 UPDATE analytics_sync_jobs SET status='completed',pending_ids='[]',pending_index=0,lease_token=null,lease_until=null,
  last_error=null,error_code=null,updated_at=now(),import_state=import_state-'order'
  WHERE workspace_id=j.workspace_id AND id=j.id;
END $$;

-- A recent creation scan is independent of a long-running incremental.
-- At most one live recent job/account; refresh after ten minutes, preserving history.
CREATE OR REPLACE FUNCTION public.analytics_schedule_recent() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c record; today date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date; created integer:=0; n integer; BEGIN
 UPDATE analytics_sync_jobs SET import_state=import_state-'order'
  WHERE updated_at<now()-interval '30 minutes' AND import_state?'order';
 FOR c IN SELECT id,workspace_id FROM analytics_connections WHERE enabled AND last_synced_at IS NOT NULL LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('analytics-schedule:'||c.workspace_id::text||':'||c.id::text,0));
  IF EXISTS(SELECT 1 FROM analytics_sync_jobs WHERE workspace_id=c.workspace_id AND connection_id=c.id
    AND ((lane='recent' AND (status IN ('queued','running','retry','failed') OR updated_at>now()-interval '10 minutes'))
      OR (status='failed' AND error_code IS NOT NULL))) THEN CONTINUE; END IF;
  INSERT INTO analytics_sync_jobs(workspace_id,connection_id,mode,from_date,to_date,cursor_date,query_phase,covers_sales,lane)
   VALUES(c.workspace_id,c.id,'backfill',today-1,today,today,'sales',true,'recent')
   ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n=ROW_COUNT; created:=created+n;
 END LOOP;
 RETURN created;
END $$;

-- Quota waits preserve cost offsets and attempts, without manufacturing failures.
CREATE OR REPLACE FUNCTION public.analytics_defer_cost(p_workspace uuid,p_connection uuid,p_lease uuid,p_version integer,
 p_kind text,p_seconds integer,p_external text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF p_kind NOT IN ('catalog','history') THEN RAISE EXCEPTION 'INVALID_COST_KIND'; END IF;
 PERFORM 1 FROM analytics_connections c JOIN analytics_companies co ON co.workspace_id=c.workspace_id AND co.id=c.company_id
  WHERE c.workspace_id=p_workspace AND c.id=p_connection AND c.sync_lock=p_lease AND c.sync_locked_until>now()
   AND c.version=p_version AND c.enabled AND co.tax_id='13397731000164' FOR UPDATE OF c;
 IF NOT FOUND THEN RAISE EXCEPTION 'COST_LEASE_CHANGED'; END IF;
 IF p_kind='catalog' THEN
  UPDATE analytics_cost_sync SET next_at=now()+make_interval(secs=>greatest(1,least(p_seconds,3600))),last_error=null,updated_at=now()
   WHERE workspace_id=p_workspace AND connection_id=p_connection;
 ELSE
  UPDATE analytics_cost_history_sync SET next_at=now()+make_interval(secs=>greatest(1,least(p_seconds,3600))),last_error=null,updated_at=now()
   WHERE workspace_id=p_workspace AND connection_id=p_connection AND (p_external IS NULL OR external_id=p_external);
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'COST_CHECKPOINT_CHANGED'; END IF;
 UPDATE analytics_connections SET sync_lock=null,sync_locked_until=now()+interval '3 seconds'
  WHERE workspace_id=p_workspace AND id=p_connection AND sync_lock=p_lease;
END $$;

-- Same v13 leases/account locks. A recent job gets priority at most every two
-- minutes; intervening leases rotate older history jobs to avoid starvation.
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
 IF EXISTS(SELECT 1 FROM analytics_connections other WHERE other.id<>conn.id AND other.sync_locked_until>now()
  AND ((conn.verified_tax_id IS NOT NULL AND other.verified_tax_id=conn.verified_tax_id)
   OR (other.workspace_id=conn.workspace_id AND other.company_id=conn.company_id))) THEN RETURN; END IF;
 SELECT * INTO job FROM analytics_sync_jobs j WHERE workspace_id=conn.workspace_id AND connection_id=conn.id
 AND status IN ('queued','retry','running') AND next_at<=now() AND (lease_until IS NULL OR lease_until<now())
 ORDER BY CASE WHEN lane='recent' AND (last_claimed_at IS NULL OR last_claimed_at<now()-interval '2 minutes') THEN 0 ELSE 1 END,
  last_claimed_at NULLS FIRST,to_date DESC,created_at,id FOR UPDATE LIMIT 1;
 UPDATE analytics_connections SET sync_lock=token,sync_locked_until=now()+interval '90 seconds',last_processed_at=now()
  WHERE workspace_id=conn.workspace_id AND id=conn.id;
 RETURN QUERY UPDATE analytics_sync_jobs SET lease_token=token,lease_until=now()+interval '90 seconds',status='running',updated_at=now(),last_claimed_at=now()
  WHERE workspace_id=job.workspace_id AND id=job.id RETURNING *;
END $$;

REVOKE ALL ON FUNCTION public.analytics_import_context(uuid,uuid),public.analytics_finish_import(uuid,uuid),public.analytics_schedule_recent(),
 public.analytics_defer_cost(uuid,uuid,uuid,integer,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_import_context(uuid,uuid),public.analytics_finish_import(uuid,uuid),public.analytics_schedule_recent(),
 public.analytics_defer_cost(uuid,uuid,uuid,integer,text,integer,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
