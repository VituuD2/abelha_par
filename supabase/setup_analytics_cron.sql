-- Run after migration v11 and deploy. Uses the Vault secrets already used by Olist token refresh.
-- Vault: abelha_par_app_url (https://your-app), abelha_par_cron_secret (same CRON_SECRET as server).
-- No tokens or credentials belong in this file. pg_cron/pg_net must be enabled in Supabase.
DO $$ DECLARE job bigint; BEGIN
 FOR job IN SELECT jobid FROM cron.job WHERE jobname='abelha-par-analytics-sync' LOOP PERFORM cron.unschedule(job); END LOOP;
 PERFORM cron.schedule('abelha-par-analytics-sync','* * * * *',$job$
   SELECT net.http_post(
     url := rtrim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='abelha_par_app_url'),'/')||'/api/internal/analytics-sync',
     headers := jsonb_build_object('Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='abelha_par_cron_secret'),'Content-Type','application/json'),
     body := '{}'::jsonb, timeout_milliseconds := 55000
   );
 $job$);
END $$;
