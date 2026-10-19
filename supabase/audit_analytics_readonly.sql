-- Run deliberately in the authorized project's SQL editor. Read-only, no jobs/RPC mutations.
BEGIN TRANSACTION READ ONLY;
SELECT now() AS observed_at,
 to_regprocedure('public.analytics_claim_jobs(uuid,integer)') AS parallel_v13,
 EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='analytics_sync_jobs' AND column_name='last_claimed_at') AS v13_column;
SELECT proname,md5(pg_get_functiondef(p.oid)) AS definition_hash,
 CASE WHEN proname='analytics_schedule_range' THEN strpos(pg_get_functiondef(p.oid),'mode=''incremental''')>0 ELSE NULL END AS contains_incremental_mode_check
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND proname IN ('analytics_coverage','analytics_claim_job','analytics_claim_jobs','analytics_schedule_range','analytics_abc');
SELECT c.name,j.mode,j.status,j.from_date,j.to_date,j.cursor_date,j.page_offset,j.pending_index,j.processed,j.attempts,j.next_at,j.updated_at,j.error_code,j.last_error
FROM public.analytics_sync_jobs j JOIN public.analytics_connections c ON c.workspace_id=j.workspace_id AND c.id=j.connection_id
ORDER BY c.name,j.from_date;
SELECT c.name,c.enabled,c.verified_at,c.last_synced_at,c.error_code,c.last_error,
 (SELECT count(*) FROM public.analytics_orders o WHERE o.workspace_id=c.workspace_id AND o.connection_id=c.id) AS orders
FROM public.analytics_connections c ORDER BY c.name;
SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename LIKE 'analytics_%';
SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'analytics_%' AND c.relkind='r';
SELECT jobname,schedule,active FROM cron.job WHERE jobname IN ('abelha-par-analytics-sync','abelha-par-olist-token-refresh');
SELECT r.requested_at,h.status_code,h.timed_out,h.error_msg FROM public.analytics_cron_runs r
 LEFT JOIN net._http_response h ON h.id=r.request_id ORDER BY r.requested_at DESC LIMIT 20;
ROLLBACK;
