-- Run AFTER migration v8 and deployment. Compatible with Vercel Hobby.
-- First create these entries in Supabase Vault (Dashboard):
--   abelha_par_app_url     = https://abelha-par.vercel.app
--   abelha_par_cron_secret = the same random CRON_SECRET configured in Vercel
-- Do not paste either OAuth token here. The schedule stores only Vault names.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.invoke_olist_token_refresh()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  app_url text;
  cron_secret text;
BEGIN
  SELECT decrypted_secret INTO app_url FROM vault.decrypted_secrets WHERE name = 'abelha_par_app_url';
  SELECT decrypted_secret INTO cron_secret FROM vault.decrypted_secrets WHERE name = 'abelha_par_cron_secret';
  IF app_url IS NULL OR app_url !~ '^https://[^/]+/?$' OR cron_secret IS NULL OR length(cron_secret) < 32 THEN
    RAISE EXCEPTION 'Configure abelha_par_app_url (HTTPS) and abelha_par_cron_secret (32+ characters) in Vault first.';
  END IF;
  RETURN net.http_post(
    url := rtrim(app_url, '/') || '/api/internal/olist-token-refresh',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || cron_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
END;
$$;
REVOKE ALL ON FUNCTION public.invoke_olist_token_refresh() FROM PUBLIC, anon, authenticated, service_role;

-- Same job name updates the existing schedule on repeated execution.
SELECT cron.schedule('abelha-par-olist-token-refresh', '15 * * * *',
  'SELECT public.invoke_olist_token_refresh();');

-- First invocation now; inspect its HTTP result using the request ID returned.
SELECT public.invoke_olist_token_refresh() AS request_id;
COMMIT;

-- Validation (run separately after a few seconds):
-- SELECT id, status_code, timed_out, error_msg, content
-- FROM net._http_response ORDER BY created DESC LIMIT 5;
-- Expect HTTP 200 with ok=true. A cron job marked "succeeded" means only that
-- the HTTP request was queued: check the HTTP response as well.
