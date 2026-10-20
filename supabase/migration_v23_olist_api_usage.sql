-- Apply after v13 (and alongside the existing v14-v22 reporting migrations).
-- Server-only pacing shared by sales, costs and operational requests; no order data is changed.
BEGIN;
CREATE TABLE IF NOT EXISTS public.olist_api_policies (
 account_key text PRIMARY KEY, plan_name text NOT NULL,
 plan_limit integer NOT NULL CHECK(plan_limit BETWEEN 1 AND 10000),
 app_limit integer NOT NULL CHECK(app_limit BETWEEN 1 AND plan_limit)
);
-- Plans supplied by the account owner; keys are identities, never connection display names.
INSERT INTO public.olist_api_policies VALUES
 ('tax:13397731000164','Domine',120,60),
 ('tax:36965322000112','Impulsione',60,36),
 ('tax:37201039000187','Impulsione',60,36)
ON CONFLICT(account_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.olist_api_state (
 account_key text PRIMARY KEY, next_at timestamptz NOT NULL DEFAULT '-infinity',
 monitoring_since timestamptz NOT NULL DEFAULT now(),
 cooldown_until timestamptz NOT NULL DEFAULT '-infinity', slow_until timestamptz NOT NULL DEFAULT '-infinity',
 provider_limit integer, provider_remaining integer, provider_reset_at timestamptz, observed_at timestamptz,
 cleanup_at timestamptz NOT NULL DEFAULT '-infinity'
);
CREATE TABLE IF NOT EXISTS public.olist_api_minutes (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id), account_key text NOT NULL,
 minute timestamptz NOT NULL, source text NOT NULL CHECK(source IN ('orders','costs','operational','identity')),
 requests integer NOT NULL DEFAULT 0, responses integer NOT NULL DEFAULT 0, retries integer NOT NULL DEFAULT 0,
 throttled integer NOT NULL DEFAULT 0, server_errors integer NOT NULL DEFAULT 0,
 timeouts integer NOT NULL DEFAULT 0, network_errors integer NOT NULL DEFAULT 0,
 duration_ms bigint NOT NULL DEFAULT 0, max_duration_ms integer NOT NULL DEFAULT 0,
 PRIMARY KEY(workspace_id,account_key,minute,source)
);
CREATE INDEX IF NOT EXISTS olist_api_minutes_retention ON public.olist_api_minutes(account_key,minute);
-- Highest observed account consumption in each clock minute. Provider windows may differ.
CREATE TABLE IF NOT EXISTS public.olist_api_samples (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),account_key text NOT NULL,minute timestamptz NOT NULL,
 provider_limit integer NOT NULL,provider_remaining integer NOT NULL,provider_reset_at timestamptz NOT NULL,
 observed_at timestamptz NOT NULL,sample_count integer NOT NULL DEFAULT 1,
 PRIMARY KEY(workspace_id,account_key,minute)
);
CREATE INDEX IF NOT EXISTS olist_api_samples_retention ON public.olist_api_samples(account_key,minute);
CREATE TABLE IF NOT EXISTS public.olist_api_permits (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, account_key text NOT NULL,
 minute timestamptz NOT NULL, source text NOT NULL,
 started_at timestamptz NOT NULL, recorded boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS olist_api_permits_retention ON public.olist_api_permits(account_key,started_at);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['olist_api_policies','olist_api_state','olist_api_minutes','olist_api_samples','olist_api_permits'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END $$;

-- Operational and analytical links to the same CNPJ resolve to the same account gate.
CREATE OR REPLACE FUNCTION public.olist_api_scope(p_connection uuid DEFAULT NULL,p_workspace uuid DEFAULT NULL)
RETURNS TABLE(workspace_id uuid,account_key text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c record; legacy uuid; BEGIN
 IF p_connection IS NOT NULL THEN
  SELECT cn.workspace_id,cn.id,co.tax_id INTO c FROM analytics_connections cn JOIN analytics_companies co
   ON co.workspace_id=cn.workspace_id AND co.id=cn.company_id WHERE cn.id=p_connection AND cn.enabled;
  IF NOT FOUND OR (p_workspace IS NOT NULL AND p_workspace<>c.workspace_id) THEN RAISE EXCEPTION 'CONNECTION_REQUIRED'; END IF;
  RETURN QUERY SELECT c.workspace_id,coalesce('tax:'||c.tax_id,'connection:'||c.id::text); RETURN;
 END IF;
 SELECT ti.id INTO legacy FROM tiny_integrations ti WHERE ti.workspace_id=p_workspace;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONNECTION_REQUIRED'; END IF;
 SELECT cn.workspace_id,cn.id,co.tax_id INTO c FROM analytics_connections cn JOIN analytics_companies co
  ON co.workspace_id=cn.workspace_id AND co.id=cn.company_id
  WHERE cn.workspace_id=p_workspace AND cn.legacy_integration_id=legacy AND cn.enabled ORDER BY cn.id LIMIT 1;
 RETURN QUERY SELECT p_workspace,CASE WHEN c.tax_id IS NOT NULL THEN 'tax:'||c.tax_id ELSE 'legacy:'||legacy::text END;
END $$;

CREATE OR REPLACE FUNCTION public.olist_api_acquire(p_request uuid,p_source text,p_retry boolean DEFAULT false,
 p_connection uuid DEFAULT NULL,p_workspace uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE scope record; st olist_api_state; policy olist_api_policies; existing olist_api_permits;
 at timestamptz; ready timestamptz; effective integer; bucket timestamptz; BEGIN
 IF p_source NOT IN ('orders','costs','operational','identity') OR p_request IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 SELECT * INTO scope FROM olist_api_scope(p_connection,p_workspace);
 INSERT INTO olist_api_state(account_key) VALUES(scope.account_key) ON CONFLICT DO NOTHING;
 SELECT * INTO st FROM olist_api_state s WHERE s.account_key=scope.account_key FOR UPDATE;
 SELECT * INTO existing FROM olist_api_permits WHERE id=p_request;
 IF FOUND THEN
  IF existing.workspace_id<>scope.workspace_id OR existing.account_key<>scope.account_key OR existing.source<>p_source
   THEN RAISE EXCEPTION 'PERMIT_SCOPE_CHANGED'; END IF;
  RAISE EXCEPTION 'PERMIT_ALREADY_RESERVED'; -- Never dispatch twice after an ambiguous acquire response.
 END IF;
 at:=clock_timestamp(); bucket:=date_trunc('minute',at);
 SELECT * INTO policy FROM olist_api_policies p WHERE p.account_key=scope.account_key;
 effective:=coalesce(policy.app_limit,28);
 IF st.observed_at>at-interval '15 minutes' AND st.provider_limit IS NOT NULL THEN
  effective:=least(effective,greatest(1,floor(st.provider_limit*0.6)::integer));
 END IF;
 IF st.slow_until>at THEN effective:=greatest(1,effective/2); END IF;
 ready:=greatest(st.next_at,st.cooldown_until);
 IF ready>at THEN RETURN jsonb_build_object('granted',false,'wait_ms',ceil(extract(epoch FROM ready-at)*1000),'effective_limit',effective); END IF;
 UPDATE olist_api_state SET next_at=at+make_interval(secs=>60.0/effective) WHERE account_key=scope.account_key;
 INSERT INTO olist_api_permits(id,workspace_id,account_key,minute,source,started_at)
  VALUES(p_request,scope.workspace_id,scope.account_key,bucket,p_source,at);
 INSERT INTO olist_api_minutes(workspace_id,account_key,minute,source,requests,retries)
  VALUES(scope.workspace_id,scope.account_key,bucket,p_source,1,CASE WHEN p_retry THEN 1 ELSE 0 END)
  ON CONFLICT(workspace_id,account_key,minute,source) DO UPDATE
   SET requests=olist_api_minutes.requests+1,retries=olist_api_minutes.retries+EXCLUDED.retries;
 IF st.cleanup_at<at THEN
  DELETE FROM olist_api_permits WHERE account_key=scope.account_key AND started_at<at-interval '10 minutes';
  DELETE FROM olist_api_minutes WHERE account_key=scope.account_key AND minute<at-interval '48 hours';
  DELETE FROM olist_api_samples WHERE account_key=scope.account_key AND minute<at-interval '48 hours';
  UPDATE olist_api_state SET cleanup_at=at+interval '10 minutes' WHERE account_key=scope.account_key;
 END IF;
 RETURN jsonb_build_object('granted',true,'wait_ms',0,'effective_limit',effective);
END $$;

CREATE OR REPLACE FUNCTION public.olist_api_record(p_request uuid,p_status integer,p_duration integer,p_kind text DEFAULT 'http',
 p_limit integer DEFAULT NULL,p_remaining integer DEFAULT NULL,p_reset integer DEFAULT NULL,p_retry_after integer DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE permit olist_api_permits; at timestamptz:=clock_timestamp(); pause integer; BEGIN
 SELECT * INTO permit FROM olist_api_permits WHERE id=p_request;
 IF NOT FOUND THEN RETURN; END IF;
 PERFORM 1 FROM olist_api_state WHERE account_key=permit.account_key FOR UPDATE;
 SELECT * INTO permit FROM olist_api_permits WHERE id=p_request FOR UPDATE;
 IF NOT FOUND OR permit.recorded THEN RETURN; END IF;
 IF p_status NOT BETWEEN 0 AND 599 OR p_kind NOT IN ('http','timeout','network') THEN RAISE EXCEPTION 'INVALID_RESULT'; END IF;
 UPDATE olist_api_permits SET recorded=true WHERE id=p_request;
 UPDATE olist_api_minutes SET responses=responses+1,
  throttled=throttled+CASE WHEN p_status=429 THEN 1 ELSE 0 END,
  server_errors=server_errors+CASE WHEN p_status>=500 AND p_kind='http' THEN 1 ELSE 0 END,
  timeouts=timeouts+CASE WHEN p_kind='timeout' THEN 1 ELSE 0 END,
  network_errors=network_errors+CASE WHEN p_kind='network' THEN 1 ELSE 0 END,
  duration_ms=duration_ms+greatest(0,least(p_duration,300000)),max_duration_ms=greatest(max_duration_ms,least(p_duration,300000))
  WHERE workspace_id=permit.workspace_id AND account_key=permit.account_key AND minute=permit.minute AND source=permit.source;
 IF p_limit BETWEEN 1 AND 10000 AND p_remaining BETWEEN 0 AND p_limit AND p_reset BETWEEN 0 AND 3600 THEN
  UPDATE olist_api_state SET provider_limit=p_limit,provider_remaining=p_remaining,
   provider_reset_at=at+make_interval(secs=>p_reset),observed_at=at WHERE account_key=permit.account_key;
  INSERT INTO olist_api_samples(workspace_id,account_key,minute,provider_limit,provider_remaining,provider_reset_at,observed_at)
   VALUES(permit.workspace_id,permit.account_key,date_trunc('minute',at),p_limit,p_remaining,at+make_interval(secs=>p_reset),at)
   ON CONFLICT(workspace_id,account_key,minute) DO UPDATE SET sample_count=olist_api_samples.sample_count+1,
    provider_limit=CASE WHEN EXCLUDED.provider_limit-EXCLUDED.provider_remaining>=olist_api_samples.provider_limit-olist_api_samples.provider_remaining THEN EXCLUDED.provider_limit ELSE olist_api_samples.provider_limit END,
    provider_remaining=CASE WHEN EXCLUDED.provider_limit-EXCLUDED.provider_remaining>=olist_api_samples.provider_limit-olist_api_samples.provider_remaining THEN EXCLUDED.provider_remaining ELSE olist_api_samples.provider_remaining END,
    provider_reset_at=CASE WHEN EXCLUDED.provider_limit-EXCLUDED.provider_remaining>=olist_api_samples.provider_limit-olist_api_samples.provider_remaining THEN EXCLUDED.provider_reset_at ELSE olist_api_samples.provider_reset_at END,
    observed_at=CASE WHEN EXCLUDED.provider_limit-EXCLUDED.provider_remaining>=olist_api_samples.provider_limit-olist_api_samples.provider_remaining THEN EXCLUDED.observed_at ELSE olist_api_samples.observed_at END;
  -- Stop using the account's last 10% while other integrations may be active.
  IF p_remaining<=greatest(3,ceil(p_limit*0.1)::integer) THEN
   UPDATE olist_api_state SET cooldown_until=greatest(cooldown_until,at+make_interval(secs=>p_reset+1)) WHERE account_key=permit.account_key;
  END IF;
 END IF;
 IF p_status=429 THEN
  pause:=greatest(3,least(3600,greatest(coalesce(p_retry_after,0),coalesce(p_reset,0),
   CASE WHEN p_retry_after IS NULL AND p_reset IS NULL THEN 60 ELSE 0 END)));
  UPDATE olist_api_state SET cooldown_until=greatest(cooldown_until,at+make_interval(secs=>pause)),
   slow_until=at+interval '15 minutes' WHERE account_key=permit.account_key;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.olist_api_usage(p_workspace uuid,p_actor uuid,p_minutes integer DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; BEGIN
 IF NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=p_workspace AND user_id=p_actor AND active AND role='admin')
  THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
 WITH accounts AS (
  SELECT cn.id,cn.name,coalesce('tax:'||co.tax_id,'connection:'||cn.id::text) key FROM analytics_connections cn
   JOIN analytics_companies co ON co.workspace_id=cn.workspace_id AND co.id=cn.company_id
   WHERE cn.workspace_id=p_workspace AND cn.enabled
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('connection_id',a.id,'name',a.name,'plan',coalesce(p.plan_name,'Não configurado'),
  'plan_limit',coalesce(p.plan_limit,30),'app_limit',coalesce(p.app_limit,28),
  'monitoring_since',s.monitoring_since,
  'effective_limit',greatest(1,least(coalesce(p.app_limit,28),
    CASE WHEN s.observed_at>now()-interval '15 minutes' AND s.provider_limit IS NOT NULL
     THEN greatest(1,floor(s.provider_limit*0.6)::integer) ELSE coalesce(p.app_limit,28) END)
    /CASE WHEN s.slow_until>now() THEN 2 ELSE 1 END),
  'cooldown_until',CASE WHEN s.cooldown_until>now() THEN s.cooldown_until END,
  'slow_until',CASE WHEN s.slow_until>now() THEN s.slow_until END,
  'provider_limit',s.provider_limit,'provider_remaining',s.provider_remaining,'provider_reset_at',s.provider_reset_at,'observed_at',s.observed_at,
  'minutes',coalesce((SELECT jsonb_agg(to_jsonb(m) - 'workspace_id' - 'account_key' ORDER BY m.minute,m.source)
   FROM olist_api_minutes m WHERE m.workspace_id=p_workspace AND m.account_key=a.key
    AND m.minute>=date_trunc('minute',now())-make_interval(mins=>greatest(1,least(p_minutes,120)))),'[]'::jsonb),
  'samples',coalesce((SELECT jsonb_agg(to_jsonb(o) - 'workspace_id' - 'account_key' ORDER BY o.minute)
   FROM olist_api_samples o WHERE o.workspace_id=p_workspace AND o.account_key=a.key
    AND o.minute>=date_trunc('minute',now())-make_interval(mins=>greatest(1,least(p_minutes,120)))),'[]'::jsonb)
 ) ORDER BY a.name),'[]'::jsonb) INTO result FROM accounts a
 LEFT JOIN olist_api_policies p ON p.account_key=a.key LEFT JOIN olist_api_state s ON s.account_key=a.key;
 RETURN jsonb_build_object('available',true,'generated_at',now(),'accounts',result,'retention_hours',48);
END $$;

REVOKE ALL ON FUNCTION public.olist_api_scope(uuid,uuid),public.olist_api_acquire(uuid,text,boolean,uuid,uuid),
 public.olist_api_record(uuid,integer,integer,text,integer,integer,integer,integer),public.olist_api_usage(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.olist_api_scope(uuid,uuid),public.olist_api_acquire(uuid,text,boolean,uuid,uuid),
 public.olist_api_record(uuid,integer,integer,text,integer,integer,integer,integer),public.olist_api_usage(uuid,uuid,integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
