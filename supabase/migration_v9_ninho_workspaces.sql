-- Apply after v8. Additive migration: keep tokens, webhook IDs and legacy columns.
BEGIN;

CREATE TABLE IF NOT EXISTS public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'Abelha Par',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.workspace_members (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  display_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'operator')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS olist_webhook_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS olist_webhook_revision integer NOT NULL DEFAULT 0;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspaces, public.workspace_members FROM anon, authenticated;
GRANT ALL ON public.workspaces, public.workspace_members TO service_role;
GRANT SELECT ON public.workspace_members TO authenticated;
DROP POLICY IF EXISTS "Read own membership" ON public.workspace_members;
CREATE POLICY "Read own membership" ON public.workspace_members FOR SELECT TO authenticated USING (user_id = auth.uid());

DO $$
DECLARE primary_owner uuid; owners_count integer; table_name text; constraint_row record;
BEGIN
  -- The original integration owner becomes the first administrator. Its UUID is
  -- also the workspace ID, so the already configured webhook URL stays valid.
  IF NOT EXISTS (SELECT 1 FROM public.workspaces) THEN
    SELECT count(*), (array_agg(owner_id))[1] INTO owners_count, primary_owner FROM (
      SELECT owner_id FROM public.tiny_integrations WHERE owner_id IS NOT NULL
      UNION SELECT owner_id FROM public.nuvemshop_integrations
    ) owners;
    IF owners_count > 1 THEN RAISE EXCEPTION 'Multiple integration owners: select the shared store before migrating'; END IF;
    IF primary_owner IS NULL THEN SELECT id INTO primary_owner FROM auth.users ORDER BY created_at LIMIT 1; END IF;
    IF primary_owner IS NULL THEN RAISE EXCEPTION 'Create the first Auth user before applying the Ninho migration'; END IF;
    INSERT INTO public.workspaces(id) VALUES (primary_owner);
    INSERT INTO public.workspace_members(user_id, workspace_id, display_name, role)
      SELECT id, primary_owner, coalesce(raw_user_meta_data->>'name', ''),
        CASE WHEN id = primary_owner THEN 'admin' ELSE 'operator' END FROM auth.users;
  ELSE
    SELECT id INTO primary_owner FROM public.workspaces ORDER BY created_at LIMIT 1;
  END IF;

  FOREACH table_name IN ARRAY ARRAY['tiny_integrations', 'nuvemshop_integrations', 'olist_order_cache',
    'nuvemshop_order_cache', 'olist_sync_state', 'olist_sync_jobs', 'scan_sessions', 'lotes_bipagem'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id)', table_name);
    EXECUTE format('UPDATE public.%I SET workspace_id = $1 WHERE workspace_id IS NULL', table_name) USING primary_owner;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN workspace_id SET NOT NULL', table_name);
    -- Credentials and synchronization must survive blocking/deleting their
    -- original administrator. Session/batch owner_id still records the actor.
    IF table_name NOT IN ('scan_sessions', 'lotes_bipagem') THEN
      FOR constraint_row IN SELECT conname FROM pg_constraint
        WHERE conrelid = format('public.%I', table_name)::regclass AND confrelid = 'auth.users'::regclass LOOP
        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', table_name, constraint_row.conname);
      END LOOP;
    END IF;
  END LOOP;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS tiny_integrations_workspace_key ON public.tiny_integrations(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS nuvemshop_integrations_workspace_key ON public.nuvemshop_integrations(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS olist_order_cache_workspace_key ON public.olist_order_cache(workspace_id, olist_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS nuvemshop_order_cache_workspace_key ON public.nuvemshop_order_cache(workspace_id, store_id, order_id);
CREATE UNIQUE INDEX IF NOT EXISTS olist_sync_state_workspace_key ON public.olist_sync_state(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS olist_sync_jobs_workspace_key ON public.olist_sync_jobs(workspace_id, olist_order_id);
CREATE INDEX IF NOT EXISTS scan_sessions_workspace_idx ON public.scan_sessions(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS lotes_bipagem_workspace_idx ON public.lotes_bipagem(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS olist_cache_workspace_reference_idx ON public.olist_order_cache(workspace_id, ecommerce_id, ecommerce_order_number);
ALTER TABLE public.scan_sessions ADD COLUMN IF NOT EXISTS last_updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.lotes_bipagem ADD COLUMN IF NOT EXISTS finished_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Fill compatibility columns for both old and new application versions during rollout.
CREATE OR REPLACE FUNCTION public.bind_workspace_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.workspace_id IS NULL THEN
    SELECT workspace_id INTO NEW.workspace_id FROM public.workspace_members WHERE user_id = NEW.owner_id;
    IF NEW.workspace_id IS NULL AND EXISTS (SELECT 1 FROM public.workspaces WHERE id = NEW.owner_id) THEN
      NEW.workspace_id := NEW.owner_id;
    END IF;
  END IF;
  IF NEW.owner_id IS NULL AND TG_TABLE_NAME NOT IN ('scan_sessions', 'lotes_bipagem') THEN NEW.owner_id := NEW.workspace_id; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bind_workspace_scope() FROM PUBLIC;
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['tiny_integrations', 'nuvemshop_integrations', 'olist_order_cache',
    'nuvemshop_order_cache', 'olist_sync_state', 'olist_sync_jobs', 'scan_sessions', 'lotes_bipagem'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS workspace_scope ON public.%I', table_name);
    EXECUTE format('CREATE TRIGGER workspace_scope BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bind_workspace_scope()', table_name);
  END LOOP;
END; $$;

DROP POLICY IF EXISTS "Operators can read their own batches" ON public.lotes_bipagem;
DROP POLICY IF EXISTS "Members can read workspace batches" ON public.lotes_bipagem;
CREATE POLICY "Members can read workspace batches" ON public.lotes_bipagem FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.user_id = auth.uid() AND m.active AND m.workspace_id = lotes_bipagem.workspace_id));

CREATE OR REPLACE FUNCTION public.update_workspace_member(p_workspace uuid, p_actor uuid, p_user uuid, p_role text, p_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Serialize role changes and prevent two concurrent requests removing the last admin.
  PERFORM 1 FROM public.workspaces WHERE id = p_workspace FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = p_workspace AND user_id = p_actor AND role = 'admin' AND active) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;
  IF p_role NOT IN ('admin', 'operator') OR p_role IS NULL OR p_active IS NULL THEN RAISE EXCEPTION 'INVALID_ROLE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = p_workspace AND user_id = p_user) THEN RAISE EXCEPTION 'MEMBER_NOT_FOUND'; END IF;
  IF EXISTS (SELECT 1 FROM public.workspace_members WHERE user_id = p_user AND role = 'admin' AND active)
    AND (p_role <> 'admin' OR NOT p_active)
    AND NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = p_workspace AND user_id <> p_user AND role = 'admin' AND active) THEN
      RAISE EXCEPTION 'LAST_ADMIN';
  END IF;
  UPDATE public.workspace_members SET role = p_role, active = p_active WHERE workspace_id = p_workspace AND user_id = p_user;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_workspace_olist_sync_jobs(p_workspace uuid, p_ids bigint[], p_refresh boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.olist_sync_jobs(workspace_id, olist_order_id)
    SELECT p_workspace, id FROM (SELECT DISTINCT unnest(p_ids) id) ids WHERE id > 0
    ON CONFLICT (workspace_id, olist_order_id) DO UPDATE SET
      request_version = olist_sync_jobs.request_version + 1, requested_at = now(),
      status = CASE WHEN olist_sync_jobs.status = 'processing' THEN 'processing' ELSE 'queued' END,
      attempts = CASE WHEN olist_sync_jobs.status = 'processing' THEN olist_sync_jobs.attempts ELSE 0 END,
      next_attempt_at = now() WHERE p_refresh;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_workspace_member(p_workspace uuid, p_actor uuid, p_user uuid, p_name text, p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM public.workspaces WHERE id = p_workspace FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE user_id = p_actor AND workspace_id = p_workspace AND role = 'admin' AND active) THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF p_role NOT IN ('admin', 'operator') OR p_role IS NULL THEN RAISE EXCEPTION 'INVALID_ROLE'; END IF;
  INSERT INTO public.workspace_members(user_id, workspace_id, display_name, role) VALUES (p_user, p_workspace, p_name, p_role);
END;
$$;
REVOKE ALL ON FUNCTION public.add_workspace_member(uuid, uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_workspace_member(uuid, uuid, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_workspace_scan_session(p_workspace uuid, p_actor uuid, p_session uuid)
RETURNS public.lotes_bipagem LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.scan_sessions; b public.lotes_bipagem;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE user_id = p_actor AND workspace_id = p_workspace AND active) THEN RAISE EXCEPTION 'MEMBER_REQUIRED'; END IF;
  SELECT * INTO s FROM public.scan_sessions WHERE id = p_session AND workspace_id = p_workspace FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;
  IF s.batch_id IS NOT NULL THEN SELECT * INTO b FROM public.lotes_bipagem WHERE id = s.batch_id AND workspace_id = p_workspace; RETURN b; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(s.orders) o WHERE o->>'status' IS DISTINCT FROM 'checked'
    OR nullif(trim(o->>'trackingCode'), '') IS NULL OR nullif(o->>'scannedAt', '') IS NULL) THEN RAISE EXCEPTION 'SESSION_INCOMPLETE'; END IF;
  INSERT INTO public.lotes_bipagem(workspace_id, owner_id, finished_by, session_id, responsavel, data, qtd_pedidos, pedidos)
    VALUES (p_workspace, s.owner_id, p_actor, p_session, s.responsible, (now() AT TIME ZONE 'America/Sao_Paulo')::date, jsonb_array_length(s.orders), s.orders) RETURNING * INTO b;
  UPDATE public.scan_sessions SET status = 'completed', batch_id = b.id, last_updated_by = p_actor, revision = revision + 1, updated_at = now() WHERE id = s.id;
  RETURN b;
END;
$$;
REVOKE ALL ON FUNCTION public.update_workspace_member(uuid, uuid, uuid, text, boolean), public.enqueue_workspace_olist_sync_jobs(uuid, bigint[], boolean), public.finish_workspace_scan_session(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_workspace_member(uuid, uuid, uuid, text, boolean), public.enqueue_workspace_olist_sync_jobs(uuid, bigint[], boolean), public.finish_workspace_scan_session(uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.configure_workspace_webhook(p_workspace uuid, p_actor uuid, p_action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM public.workspaces WHERE id = p_workspace FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE user_id = p_actor AND workspace_id = p_workspace AND role = 'admin' AND active) THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF p_action = 'rotate' THEN
    UPDATE public.workspaces SET olist_webhook_revision = olist_webhook_revision + 1 WHERE id = p_workspace;
    UPDATE public.olist_sync_state SET last_webhook_at = NULL WHERE workspace_id = p_workspace;
  ELSIF p_action IN ('enable', 'disable') THEN UPDATE public.workspaces SET olist_webhook_enabled = (p_action = 'enable') WHERE id = p_workspace;
  ELSE RAISE EXCEPTION 'INVALID_ACTION'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.configure_workspace_webhook(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.configure_workspace_webhook(uuid, uuid, text) TO service_role;
COMMIT;
