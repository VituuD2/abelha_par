-- Removes only v23 quota/telemetry objects. The app returns to its old conservative pace.
-- This deletes the collected API usage history; orders, costs, jobs and credentials are preserved.
BEGIN;
DROP FUNCTION IF EXISTS public.olist_api_usage(uuid,uuid,integer);
DROP FUNCTION IF EXISTS public.olist_api_record(uuid,integer,integer,text,integer,integer,integer,integer);
DROP FUNCTION IF EXISTS public.olist_api_acquire(uuid,text,boolean,uuid,uuid);
DROP FUNCTION IF EXISTS public.olist_api_scope(uuid,uuid);
DROP TABLE IF EXISTS public.olist_api_permits;
DROP TABLE IF EXISTS public.olist_api_samples;
DROP TABLE IF EXISTS public.olist_api_minutes;
DROP TABLE IF EXISTS public.olist_api_state;
DROP TABLE IF EXISTS public.olist_api_policies;
NOTIFY pgrst,'reload schema';
COMMIT;
