-- Optional diagnosis in the authorized Supabase SQL Editor, not a migration.
-- Does not execute workers, rotate tokens, change jobs, or expose secret values.
-- Private schemas are intentionally not exposed through the REST API.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

SELECT now() AS observed_at, current_setting('transaction_read_only') AS read_only;

-- 1. Required function contracts. Presence does not prove identical definitions.
WITH expected(migration, signature) AS (VALUES
 ('v13', 'public.analytics_claim_jobs(uuid,integer)'),
 ('v18', 'public.analytics_claim_cost_sync()'),
 ('v19', 'public.analytics_cost_history_status(uuid)'),
 ('v21', 'public.analytics_abc_components_v21(uuid,uuid,jsonb,jsonb,integer,integer,text,text)'),
 ('v21', 'public.analytics_drilldown_components_v21(uuid,uuid,jsonb,jsonb,text,integer)'),
 ('v23', 'public.olist_api_scope(uuid,uuid)'),
 ('v23', 'public.olist_api_acquire(uuid,text,boolean,uuid,uuid)'),
 ('v23', 'public.olist_api_record(uuid,integer,integer,text,integer,integer,integer,integer)'),
 ('v23', 'public.olist_api_usage(uuid,uuid,integer)'),
 ('cron', 'public.invoke_analytics_sync()'),
 ('cron', 'public.invoke_olist_token_refresh()')
)
SELECT migration, signature, p.oid IS NOT NULL AS present,
 p.provolatile AS volatility, p.prosecdef AS security_definer,
 CASE WHEN p.oid IS NOT NULL THEN has_function_privilege('anon',p.oid,'EXECUTE') END AS anon_can_execute,
 CASE WHEN p.oid IS NOT NULL THEN has_function_privilege('authenticated',p.oid,'EXECUTE') END AS authenticated_can_execute,
 CASE WHEN p.oid IS NOT NULL THEN has_function_privilege('service_role',p.oid,'EXECUTE') END AS service_can_execute
FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
ORDER BY migration,signature;

-- 2. v22 changes existing definitions; no separate "v22" function is expected.
WITH expected(signature) AS (VALUES
 ('public.analytics_abc(uuid,uuid,jsonb,integer,integer,text,text)'),
 ('public.analytics_abc_components(uuid,uuid,jsonb,jsonb,integer,integer,text,text)')
), definitions AS (
 SELECT signature, CASE WHEN to_regprocedure(signature) IS NOT NULL
  THEN pg_get_functiondef(to_regprocedure(signature)) END AS definition FROM expected
)
SELECT signature, definition IS NOT NULL AS present,
 strpos(definition,'SELECT jsonb_agg(row ORDER BY rank) FROM payload WHERE rank<=60')>0 AS old_60_limit,
 strpos(definition,'SELECT jsonb_agg(row ORDER BY rank) FROM payload)')>0 AS full_pareto_definition
FROM definitions;

-- 3. v20/v21: inspect constraints without inserting negative values in production.
SELECT c.relname AS table_name, con.conname, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('analytics_items','analytics_orders','analytics_product_costs')
 AND con.contype='c'
ORDER BY c.relname,con.conname;

-- 4. v23 tables: RLS should be enabled and browser roles should lack table access.
WITH expected(table_name) AS (VALUES ('olist_api_policies'),('olist_api_state'),
 ('olist_api_minutes'),('olist_api_samples'),('olist_api_permits'))
SELECT e.table_name,c.oid IS NOT NULL AS present,c.relrowsecurity AS rls_enabled,
 CASE WHEN c.oid IS NOT NULL THEN has_table_privilege('anon',c.oid,'SELECT') END AS anon_can_select,
 CASE WHEN c.oid IS NOT NULL THEN has_table_privilege('authenticated',c.oid,'SELECT') END AS authenticated_can_select,
 CASE WHEN c.oid IS NOT NULL THEN has_table_privilege('service_role',c.oid,'SELECT') END AS service_can_select
FROM expected e LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||e.table_name)
ORDER BY e.table_name;

-- 5. Schedules and Vault names only: no commands, headers, URLs or secret values.
-- Expected analytics: * * * * *; operational renewal: 15 * * * *; active=true.
SELECT jobname,schedule,active FROM cron.job
WHERE jobname IN ('abelha-par-analytics-sync','abelha-par-olist-token-refresh')
ORDER BY jobname;
WITH expected(name) AS (VALUES ('abelha_par_app_url'),('abelha_par_cron_secret'))
SELECT e.name,count(s.id) AS matching_entries
FROM expected e LEFT JOIN vault.secrets s ON s.name=e.name GROUP BY e.name ORDER BY e.name;

-- 6. "succeeded" in cron only means a request was queued. Check the HTTP result.
-- Response bodies are deliberately omitted; the application can return partial progress with 503.
SELECT r.requested_at,h.status_code,h.timed_out,
 h.error_msg IS NOT NULL AS has_transport_error
FROM public.analytics_cron_runs r LEFT JOIN net._http_response h ON h.id=r.request_id
ORDER BY r.requested_at DESC LIMIT 15;

-- 7. Index validity and maintenance statistics, without running maintenance.
SELECT t.relname AS table_name,i.relname AS index_name,x.indisvalid,x.indisready
FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid
JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE n.nspname='public' AND (left(t.relname,10)='analytics_' OR left(t.relname,10)='olist_api_')
ORDER BY t.relname,i.relname;
SELECT relname,n_live_tup,n_dead_tup,last_autovacuum,last_autoanalyze
FROM pg_stat_user_tables WHERE schemaname='public'
 AND (left(relname,10)='analytics_' OR left(relname,10)='olist_api_') ORDER BY relname;

ROLLBACK;
