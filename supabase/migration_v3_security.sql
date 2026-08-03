-- SECURITY BREAKING CHANGE: execute after creating at least one Supabase Auth user.
-- Existing records with owner_id = NULL are intentionally hidden. Reconnect Tiny
-- and create new batches after deploying the application changes.

ALTER TABLE public.lotes_bipagem ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id);
ALTER TABLE public.tiny_integrations ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id);
ALTER TABLE public.tiny_integrations ADD COLUMN IF NOT EXISTS refresh_expires_at timestamptz;
ALTER TABLE public.lotes_bipagem ALTER COLUMN owner_id SET DEFAULT auth.uid();

DROP POLICY IF EXISTS "Allow all operations" ON public.lotes_bipagem;
DROP POLICY IF EXISTS "Allow all operations on tiny_integrations" ON public.tiny_integrations;

CREATE POLICY "Operators can read their own batches"
ON public.lotes_bipagem FOR SELECT TO authenticated
USING (owner_id = auth.uid());

CREATE POLICY "Operators can create their own batches"
ON public.lotes_bipagem FOR INSERT TO authenticated
WITH CHECK (owner_id = auth.uid());

-- No policy is created for OAuth credentials. Server-only service role bypasses RLS.
REVOKE ALL ON TABLE public.tiny_integrations FROM anon, authenticated;

ALTER TABLE public.tiny_integrations
  DROP CONSTRAINT IF EXISTS tiny_integrations_owner_id_key;
ALTER TABLE public.tiny_integrations
  ADD CONSTRAINT tiny_integrations_owner_id_key UNIQUE (owner_id);
CREATE INDEX IF NOT EXISTS lotes_bipagem_owner_created_at_idx
ON public.lotes_bipagem(owner_id, created_at DESC);
