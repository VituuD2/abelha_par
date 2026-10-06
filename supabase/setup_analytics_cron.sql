-- Run AFTER v12 and deployment. Independent of the hourly operational token cron.
-- Vault: abelha_par_app_url (HTTPS origin), abelha_par_cron_secret (server CRON_SECRET).
-- Never put secrets or OAuth tokens in versioned SQL or cron.job commands.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE TABLE IF NOT EXISTS public.analytics_cron_runs (
 request_id bigint PRIMARY KEY, requested_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.analytics_cron_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_cron_runs FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.analytics_cron_runs TO service_role;
CREATE OR REPLACE FUNCTION public.invoke_analytics_sync() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE app_url text; cron_secret text; request bigint; BEGIN
 SELECT decrypted_secret INTO app_url FROM vault.decrypted_secrets WHERE name='abelha_par_app_url';
 SELECT decrypted_secret INTO cron_secret FROM vault.decrypted_secrets WHERE name='abelha_par_cron_secret';
 IF app_url IS NULL OR app_url !~ '^https://[^/]+/?$' OR cron_secret IS NULL OR length(cron_secret)<32 THEN
  RAISE EXCEPTION 'Configure abelha_par_app_url (HTTPS) and abelha_par_cron_secret (32+ characters) in Vault first.';
 END IF;
 request:=net.http_post(
  url:=rtrim(app_url,'/')||'/api/internal/analytics-sync',
  headers:=jsonb_build_object('Authorization','Bearer '||cron_secret,'Content-Type','application/json'),
  body:='{}'::jsonb,timeout_milliseconds:=55000
 );
 INSERT INTO public.analytics_cron_runs(request_id) VALUES(request);
 DELETE FROM public.analytics_cron_runs WHERE requested_at<now()-interval '2 days';
 RETURN request;
END $$;
REVOKE ALL ON FUNCTION public.invoke_analytics_sync() FROM PUBLIC,anon,authenticated,service_role;
SELECT cron.schedule('abelha-par-analytics-sync','* * * * *','SELECT public.invoke_analytics_sync();');
SELECT public.invoke_analytics_sync() AS request_id;
COMMIT;

-- Run separately after a few seconds. Cron success means the HTTP was queued;
-- the HTTP response proves whether the app accepted and processed it.
-- SELECT jobname,schedule,active FROM cron.job WHERE jobname IN ('abelha-par-analytics-sync','abelha-par-olist-token-refresh');
-- SELECT r.requested_at,h.status_code,h.timed_out,h.error_msg,h.content
-- FROM public.analytics_cron_runs r LEFT JOIN net._http_response h ON h.id=r.request_id
-- ORDER BY r.requested_at DESC LIMIT 10;
-- 401: CRON_SECRET differs from Vault, or hosting access protection intercepted it.
-- 503 with reconnect guidance: repair the indicated account in Ninho.
