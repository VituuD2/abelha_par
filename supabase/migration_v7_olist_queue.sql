-- Apply after v6. Claims expire; an event arriving during processing is retained.
BEGIN;
ALTER TABLE public.olist_sync_jobs ADD COLUMN IF NOT EXISTS request_version bigint NOT NULL DEFAULT 1;
ALTER TABLE public.olist_sync_jobs ADD COLUMN IF NOT EXISTS claimed_version bigint;
ALTER TABLE public.olist_sync_jobs ADD COLUMN IF NOT EXISTS lock_token uuid;
ALTER TABLE public.olist_sync_state ADD COLUMN IF NOT EXISTS discovery_day date;
ALTER TABLE public.olist_sync_state ADD COLUMN IF NOT EXISTS discovery_offset integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.enqueue_olist_sync_jobs(p_owner uuid, p_ids bigint[], p_refresh boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.olist_sync_jobs(owner_id, olist_order_id)
    SELECT p_owner, id FROM (SELECT DISTINCT unnest(p_ids) id) ids WHERE id > 0
    ON CONFLICT (owner_id, olist_order_id) DO UPDATE SET
      request_version = olist_sync_jobs.request_version + 1,
      requested_at = now(),
      status = CASE WHEN olist_sync_jobs.status = 'processing' THEN 'processing' ELSE 'queued' END,
      attempts = CASE WHEN olist_sync_jobs.status = 'processing' THEN olist_sync_jobs.attempts ELSE 0 END,
      next_attempt_at = now()
    WHERE p_refresh;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_olist_sync_jobs(job_limit integer DEFAULT 5)
RETURNS SETOF public.olist_sync_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY WITH candidates AS (
    SELECT id FROM public.olist_sync_jobs
    WHERE (status IN ('queued', 'failed') AND next_attempt_at <= now() AND attempts < 8)
      OR (status = 'processing' AND (locked_at IS NULL OR locked_at < now() - interval '5 minutes'))
    ORDER BY requested_at FOR UPDATE SKIP LOCKED LIMIT greatest(1, least(job_limit, 5))
  ) UPDATE public.olist_sync_jobs jobs SET status = 'processing', attempts = jobs.attempts + 1,
      locked_at = now(), lock_token = gen_random_uuid(), claimed_version = jobs.request_version
    FROM candidates WHERE jobs.id = candidates.id RETURNING jobs.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_olist_sync_job(p_id uuid, p_lock uuid, p_error text DEFAULT NULL, p_retry integer DEFAULT 300)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.olist_sync_jobs SET
    status = CASE WHEN request_version > claimed_version THEN 'queued' WHEN p_error IS NULL THEN 'completed' ELSE 'failed' END,
    attempts = CASE WHEN request_version > claimed_version THEN 0 ELSE attempts END,
    next_attempt_at = CASE WHEN request_version > claimed_version THEN now() ELSE now() + make_interval(secs => greatest(1, least(p_retry, 3600))) END,
    completed_at = CASE WHEN p_error IS NULL THEN now() ELSE completed_at END,
    locked_at = NULL, lock_token = NULL, last_error = left(p_error, 500)
  WHERE id = p_id AND lock_token = p_lock AND status = 'processing';
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_olist_sync_jobs(uuid, bigint[], boolean), public.claim_olist_sync_jobs(integer), public.finish_olist_sync_job(uuid, uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_olist_sync_jobs(uuid, bigint[], boolean), public.claim_olist_sync_jobs(integer), public.finish_olist_sync_job(uuid, uuid, text, integer) TO service_role;
COMMIT;
