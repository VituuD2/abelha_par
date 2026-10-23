-- Per-connection webhook identity; retain the workspace webhook as a legacy alias.
BEGIN;

ALTER TABLE public.analytics_connections
  ADD COLUMN IF NOT EXISTS webhook_secret text NOT NULL DEFAULT
    (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));

CREATE UNIQUE INDEX IF NOT EXISTS analytics_connections_webhook_secret_key
  ON public.analytics_connections(webhook_secret);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'analytics_connections'
      AND column_name = 'webhook_last_received_at'
  ) THEN
    ALTER TABLE public.analytics_connections ADD COLUMN webhook_last_received_at timestamptz;
    UPDATE public.analytics_connections c
    SET webhook_last_received_at = s.last_webhook_at
    FROM public.olist_sync_state s, public.tiny_integrations t
    WHERE c.workspace_id = s.workspace_id AND c.workspace_id = t.workspace_id
      AND c.credential_kind = 'legacy' AND c.legacy_integration_id = t.id;
  END IF;
END;
$$;

COMMIT;
