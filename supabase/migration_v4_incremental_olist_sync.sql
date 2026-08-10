-- Incremental Olist synchronization: cache, queue and per-user checkpoints.
-- Run AFTER migration_v3_security.sql in the Supabase SQL Editor.
-- This migration does not modify or remove existing batches or OAuth tokens.

CREATE TABLE IF NOT EXISTS public.olist_order_cache (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  olist_order_id bigint NOT NULL,
  yampi_id text,
  tracking_code text NOT NULL DEFAULT '',
  client_name text NOT NULL DEFAULT '',
  numero_pedido bigint,
  data_criacao text,
  situacao integer,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, olist_order_id)
);

CREATE TABLE IF NOT EXISTS public.olist_sync_state (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_discovery_at timestamptz,
  last_webhook_at timestamptz,
  last_sync_at timestamptz,
  last_sync_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olist_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  olist_order_id bigint NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  requested_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  completed_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  UNIQUE (owner_id, olist_order_id)
);

CREATE INDEX IF NOT EXISTS olist_order_cache_owner_resolved_idx
  ON public.olist_order_cache (owner_id, resolved_at DESC);
CREATE INDEX IF NOT EXISTS olist_sync_jobs_claim_idx
  ON public.olist_sync_jobs (status, next_attempt_at, requested_at);

ALTER TABLE public.olist_order_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olist_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olist_sync_jobs ENABLE ROW LEVEL SECURITY;

-- Cache and queue are server-internal. The authenticated UI accesses them only
-- through API routes that enforce the current user.
REVOKE ALL ON TABLE public.olist_order_cache FROM anon, authenticated;
REVOKE ALL ON TABLE public.olist_sync_state FROM anon, authenticated;
REVOKE ALL ON TABLE public.olist_sync_jobs FROM anon, authenticated;

-- Atomically claims a small group of due jobs. SKIP LOCKED prevents concurrent
-- cron invocations from processing the same Tiny order twice.
CREATE OR REPLACE FUNCTION public.claim_olist_sync_jobs(job_limit integer DEFAULT 10)
RETURNS SETOF public.olist_sync_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM public.olist_sync_jobs
    WHERE status IN ('queued', 'failed')
      AND next_attempt_at <= now()
      AND attempts < 8
    ORDER BY requested_at
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(job_limit, 25))
  )
  UPDATE public.olist_sync_jobs jobs
  SET status = 'processing',
      attempts = jobs.attempts + 1,
      locked_at = now()
  FROM candidates
  WHERE jobs.id = candidates.id
  RETURNING jobs.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_olist_sync_jobs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_olist_sync_jobs(integer) TO service_role;

COMMENT ON TABLE public.olist_order_cache IS
  'Server-only cache of resolved Olist orders used to avoid repeated detail requests.';
COMMENT ON TABLE public.olist_sync_state IS
  'Server-only cursor and health state for each Olist integration.';
COMMENT ON TABLE public.olist_sync_jobs IS
  'Server-only durable queue for Olist order refreshes triggered by webhooks or cron.';
