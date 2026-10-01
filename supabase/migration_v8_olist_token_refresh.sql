-- Apply before deploying automatic Olist token renewal. Existing credentials are preserved.
BEGIN;
ALTER TABLE public.tiny_integrations
  ADD COLUMN IF NOT EXISTS refresh_lock uuid,
  ADD COLUMN IF NOT EXISTS refresh_locked_until timestamptz;
COMMENT ON COLUMN public.tiny_integrations.refresh_lock IS
  'Server-only OAuth refresh lease; writes also compare the previous encrypted refresh token.';
REVOKE ALL ON public.tiny_integrations FROM anon, authenticated;
GRANT ALL ON public.tiny_integrations TO service_role;
COMMIT;
