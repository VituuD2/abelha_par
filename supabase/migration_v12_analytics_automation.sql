-- Apply after v11. Additive: operational credentials and scan history are untouched.
BEGIN;
ALTER TABLE public.analytics_connections ADD COLUMN IF NOT EXISTS error_code text;
ALTER TABLE public.analytics_sync_jobs ADD COLUMN IF NOT EXISTS error_code text;
ALTER TABLE public.analytics_sync_jobs ADD COLUMN IF NOT EXISTS query_phase text NOT NULL DEFAULT 'updates' CHECK(query_phase IN ('sales','updates'));
ALTER TABLE public.analytics_sync_jobs ADD COLUMN IF NOT EXISTS covers_sales boolean NOT NULL DEFAULT false;

-- Old update-only incrementals must not be treated as sales-date coverage.
CREATE INDEX IF NOT EXISTS analytics_jobs_sales_coverage ON public.analytics_sync_jobs(workspace_id,connection_id,from_date,to_date)
 WHERE status='completed' AND (mode='backfill' OR covers_sales);

CREATE OR REPLACE FUNCTION public.analytics_coverage(p_workspace uuid,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM analytics_assert_member(p_workspace,p_actor);
 RETURN (WITH previous AS (
  SELECT connection_id,from_date,to_date,max(to_date) OVER(PARTITION BY connection_id ORDER BY from_date,to_date ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) prior_end
  FROM (SELECT connection_id,from_date,CASE WHEN status='completed' THEN to_date ELSE least(to_date,cursor_date-1) END to_date
   FROM analytics_sync_jobs WHERE workspace_id=p_workspace AND (mode='backfill' OR covers_sales)
    AND (status='completed' OR cursor_date>from_date)) proven
 ), islands AS (
  SELECT *,sum(CASE WHEN prior_end IS NULL OR from_date>prior_end+1 THEN 1 ELSE 0 END) OVER(PARTITION BY connection_id ORDER BY from_date,to_date) section FROM previous
 ), ranges AS (
  SELECT connection_id,min(from_date) from_date,max(to_date) to_date FROM islands GROUP BY connection_id,section
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('connection_id',connection_id,'mode','backfill','status','completed','covers_sales',true,'from_date',from_date,'to_date',to_date)),'[]') FROM ranges);
END $$;

-- Recent incremental history must not hide an older running backfill in the UI.
CREATE OR REPLACE FUNCTION public.analytics_job_status(p_workspace uuid,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM analytics_assert_member(p_workspace,p_actor);
 RETURN (WITH ranked AS (
  SELECT j.*,row_number() OVER(PARTITION BY connection_id ORDER BY updated_at DESC,id) position
  FROM analytics_sync_jobs j WHERE workspace_id=p_workspace
 ) SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',id,'connection_id',connection_id,'mode',mode,'from_date',from_date,'to_date',to_date,'cursor_date',cursor_date,
  'page_offset',page_offset,'pending_index',pending_index,'processed',processed,'pages',pages,'status',status,
  'last_error',last_error,'error_code',error_code,'updated_at',updated_at,'next_at',next_at,'covers_sales',covers_sales,'query_phase',query_phase
 ) ORDER BY updated_at DESC,id),'[]') FROM ranked WHERE position<=10 OR status<>'completed');
END $$;

-- Serialize all scheduling for an account. Subtract coverage AND reserved intervals,
-- including failed checkpoints: retry the checkpoint instead of cloning its work.
CREATE OR REPLACE FUNCTION public.analytics_schedule_range(p_workspace uuid,p_connection uuid,p_from date,p_to date,p_mode text DEFAULT 'backfill') RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE span record; cursor_day date:=p_from; created integer:=0; BEGIN
 IF p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>3660 OR p_mode NOT IN ('backfill','incremental') THEN RAISE EXCEPTION 'INVALID_RANGE'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('analytics-schedule:'||p_workspace::text||':'||p_connection::text,0));
 PERFORM 1 FROM analytics_connections WHERE workspace_id=p_workspace AND id=p_connection AND enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONNECTION_REQUIRED'; END IF;
 IF p_mode='incremental' THEN
  -- Repeated cron invocations on the same day should refresh that day after an hour,
  -- while historical coverage must never suppress new updates/cancellations.
  IF EXISTS(SELECT 1 FROM analytics_sync_jobs WHERE workspace_id=p_workspace AND connection_id=p_connection
   AND (status IN ('queued','running','retry','failed') OR (mode='incremental' AND to_date>=p_to AND updated_at>now()-interval '1 hour'))) THEN RETURN 0; END IF;
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

CREATE OR REPLACE FUNCTION public.analytics_ensure_coverage(p_workspace uuid,p_actor uuid,p_filters jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE account_row record; created integer:=0; BEGIN
 PERFORM analytics_assert_member(p_workspace,p_actor);
 FOR account_row IN SELECT id FROM analytics_connections c WHERE workspace_id=p_workspace AND enabled
  AND analytics_match(p_filters,'companies',c.company_id::text) AND analytics_match(p_filters,'connections',c.id::text)
  AND (jsonb_array_length(coalesce(p_filters->'selections'->'sources','[]'))=0 OR EXISTS(
   SELECT 1 FROM analytics_sources s WHERE s.workspace_id=p_workspace AND s.connection_id=c.id AND analytics_match(p_filters,'sources',s.id::text)))
 LOOP
  created:=created+analytics_schedule_range(p_workspace,account_row.id,(p_filters->>'from')::date,(p_filters->>'to')::date);
 END LOOP;
 RETURN jsonb_build_object('scheduled',created);
END $$;

-- Reconnection is committed only if the operational token, link version and CNPJ
-- still match the exact snapshot checked against /info by the server.
CREATE OR REPLACE FUNCTION public.analytics_relink_legacy(p_workspace uuid,p_actor uuid,p_connection uuid,p_version integer,p_integration uuid,p_access_token text,p_tax text,p_fingerprint text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c analytics_connections; tax text; BEGIN
 IF NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=p_workspace AND user_id=p_actor AND active AND role='admin') THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
 SELECT * INTO c FROM analytics_connections WHERE workspace_id=p_workspace AND id=p_connection AND credential_kind='legacy' AND version=p_version FOR UPDATE;
 IF NOT FOUND OR (c.sync_locked_until IS NOT NULL AND c.sync_locked_until>now()) THEN RAISE EXCEPTION 'CONNECTION_CHANGED'; END IF;
 SELECT tax_id INTO tax FROM analytics_companies WHERE workspace_id=p_workspace AND id=c.company_id FOR SHARE;
 IF tax IS NULL OR tax<>p_tax OR p_tax !~ '^\d{14}$' THEN RAISE EXCEPTION 'CNPJ_MISMATCH'; END IF;
 PERFORM 1 FROM tiny_integrations WHERE workspace_id=p_workspace AND id=p_integration AND access_token=p_access_token FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INTEGRATION_CHANGED'; END IF;
 UPDATE analytics_connections SET legacy_integration_id=p_integration,verified_tax_id=p_tax,verified_at=now(),verified_token_fingerprint=p_fingerprint,
  version=version+1,enabled=true,last_error=null,error_code=null WHERE workspace_id=p_workspace AND id=c.id;
END $$;

CREATE OR REPLACE FUNCTION public.analytics_resume_verified_jobs() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.verified_at IS NOT NULL AND NEW.verified_tax_id IS NOT NULL AND NEW.enabled
  AND (NEW.version<>OLD.version OR NEW.verified_at IS DISTINCT FROM OLD.verified_at) THEN
  -- Preserve day, offset, pending order index, counters and all ingested orders.
  UPDATE analytics_sync_jobs j SET status='queued',attempts=0,next_at=now(),last_error=null,error_code=null,lease_token=null,lease_until=null,updated_at=now()
   WHERE j.workspace_id=NEW.workspace_id AND j.connection_id=NEW.id AND j.status='failed'
    AND j.id=(SELECT pick.id FROM analytics_sync_jobs pick WHERE pick.workspace_id=j.workspace_id AND pick.connection_id=j.connection_id
     AND pick.mode=j.mode AND pick.from_date=j.from_date AND pick.to_date=j.to_date AND pick.status='failed' ORDER BY pick.created_at,pick.id LIMIT 1)
    AND NOT EXISTS(SELECT 1 FROM analytics_sync_jobs active WHERE active.workspace_id=j.workspace_id AND active.connection_id=j.connection_id
     AND active.mode=j.mode AND active.from_date=j.from_date AND active.to_date=j.to_date AND active.status IN ('queued','running','retry'));
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS analytics_resume_verified ON public.analytics_connections;
CREATE TRIGGER analytics_resume_verified AFTER UPDATE ON public.analytics_connections FOR EACH ROW EXECUTE FUNCTION public.analytics_resume_verified_jobs();

-- Classify old stopped authorizations so they remain actionable until reconnected.
UPDATE public.analytics_sync_jobs SET error_code=CASE
 WHEN last_error ~* '(CNPJ.*(mudou|difere|corresponde))' THEN 'identity_mismatch'
 WHEN last_error ~* '(autorização.*(expir|revog|renov)|reconect|operacional.*remov|autorize esta)' THEN 'authorization_required'
 ELSE error_code END WHERE status IN ('failed','retry') AND error_code IS NULL;
UPDATE public.analytics_sync_jobs SET status='failed',lease_token=null,lease_until=null WHERE status='retry' AND error_code IS NOT NULL;
UPDATE public.analytics_sync_jobs j SET status='retry',attempts=0,next_at=now(),updated_at=now()
 WHERE status='failed' AND error_code IS NULL AND NOT EXISTS(
 SELECT 1 FROM public.analytics_sync_jobs a WHERE a.workspace_id=j.workspace_id AND a.connection_id=j.connection_id AND a.mode=j.mode
  AND a.from_date=j.from_date AND a.to_date=j.to_date AND a.status IN ('queued','running','retry'))
 AND j.id=(SELECT pick.id FROM public.analytics_sync_jobs pick WHERE pick.workspace_id=j.workspace_id AND pick.connection_id=j.connection_id
  AND pick.mode=j.mode AND pick.from_date=j.from_date AND pick.to_date=j.to_date AND pick.status='failed' AND pick.error_code IS NULL ORDER BY pick.created_at,pick.id LIMIT 1);
UPDATE public.analytics_connections c SET error_code=j.error_code FROM public.analytics_sync_jobs j
 WHERE c.workspace_id=j.workspace_id AND c.id=j.connection_id AND j.status='failed' AND j.error_code IS NOT NULL;

REVOKE ALL ON FUNCTION public.analytics_job_status(uuid,uuid),public.analytics_schedule_range(uuid,uuid,date,date,text),public.analytics_ensure_coverage(uuid,uuid,jsonb),public.analytics_relink_legacy(uuid,uuid,uuid,integer,uuid,text,text,text),public.analytics_resume_verified_jobs() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_job_status(uuid,uuid),public.analytics_schedule_range(uuid,uuid,date,date,text),public.analytics_ensure_coverage(uuid,uuid,jsonb),public.analytics_relink_legacy(uuid,uuid,uuid,integer,uuid,text,text,text) TO service_role;
COMMIT;
