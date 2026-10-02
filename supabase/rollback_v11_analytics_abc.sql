-- Optional rollback. Export analytical data first: this drops ONLY the new ABC layer.
-- Operational OAuth, caches, workspaces, scan sessions and history are preserved.
BEGIN;
DO $$ DECLARE job bigint; BEGIN
 IF to_regclass('cron.job') IS NOT NULL THEN
  FOR job IN SELECT jobid FROM cron.job WHERE jobname='abelha-par-analytics-sync' LOOP PERFORM cron.unschedule(job); END LOOP;
 END IF;
END $$;
DROP FUNCTION IF EXISTS public.analytics_options(uuid,uuid,text,text);
DROP FUNCTION IF EXISTS public.analytics_drilldown(uuid,uuid,jsonb,text,integer);
DROP FUNCTION IF EXISTS public.analytics_abc(uuid,uuid,jsonb,integer,integer,text,text);
DROP FUNCTION IF EXISTS public.analytics_filtered_items(uuid,jsonb);
DROP FUNCTION IF EXISTS public.analytics_match(jsonb,text,text);
DROP FUNCTION IF EXISTS public.analytics_ingest(uuid,uuid,jsonb,jsonb);
DROP FUNCTION IF EXISTS public.analytics_cancel_order(uuid,uuid,text,timestamptz);
DROP FUNCTION IF EXISTS public.analytics_reconcile_source(uuid,uuid,uuid,text,text,text,text);
DROP FUNCTION IF EXISTS public.analytics_claim_job(uuid);
DROP FUNCTION IF EXISTS public.analytics_coverage(uuid,uuid);
DROP FUNCTION IF EXISTS public.analytics_assert_member(uuid,uuid);
DROP TABLE IF EXISTS public.analytics_items;
DROP TABLE IF EXISTS public.analytics_order_aliases;
DROP TABLE IF EXISTS public.analytics_orders;
DROP TABLE IF EXISTS public.analytics_products;
DROP TABLE IF EXISTS public.analytics_sources;
DROP TABLE IF EXISTS public.analytics_sync_jobs;
DROP TABLE IF EXISTS public.analytics_connections;
DROP TABLE IF EXISTS public.analytics_companies;
COMMIT;
