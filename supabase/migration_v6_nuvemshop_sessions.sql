-- Execute after v5. Additive: preserves historical Yampi batches and Tiny tokens.
BEGIN;

CREATE TABLE IF NOT EXISTS public.nuvemshop_integrations (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  store_id text NOT NULL CHECK (store_id ~ '^[0-9]+$'),
  access_token text NOT NULL,
  olist_ecommerce_id bigint CHECK (olist_ecommerce_id > 0),
  reference_field text CHECK (reference_field IN ('ecommerceOrderNumber', 'ecommerceChannelOrderNumber')),
  reference_kind text CHECK (reference_kind IN ('id', 'number')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.nuvemshop_order_cache (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_id text NOT NULL,
  order_id bigint NOT NULL,
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, store_id, order_id)
);
ALTER TABLE public.nuvemshop_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nuvemshop_order_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nuvemshop_integrations, public.nuvemshop_order_cache FROM anon, authenticated;

ALTER TABLE public.olist_order_cache ADD COLUMN IF NOT EXISTS ecommerce_id bigint;
ALTER TABLE public.olist_order_cache ADD COLUMN IF NOT EXISTS ecommerce_name text;
ALTER TABLE public.olist_order_cache ADD COLUMN IF NOT EXISTS ecommerce_order_number text;
ALTER TABLE public.olist_order_cache ADD COLUMN IF NOT EXISTS ecommerce_channel_order_number text;

CREATE TABLE IF NOT EXISTS public.scan_sessions (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  responsible text NOT NULL CHECK (char_length(trim(responsible)) BETWEEN 3 AND 100),
  orders jsonb NOT NULL CHECK (jsonb_typeof(orders) = 'array' AND jsonb_array_length(orders) BETWEEN 1 AND 1000),
  revision integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  batch_id uuid REFERENCES public.lotes_bipagem(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scan_sessions_owner_idx ON public.scan_sessions(owner_id, updated_at DESC);
ALTER TABLE public.scan_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.scan_sessions FROM anon, authenticated;
GRANT ALL ON public.nuvemshop_integrations, public.nuvemshop_order_cache, public.scan_sessions TO service_role;
CREATE INDEX IF NOT EXISTS olist_cache_ecommerce_reference_idx ON public.olist_order_cache(owner_id, ecommerce_id, ecommerce_order_number);

ALTER TABLE public.lotes_bipagem ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.scan_sessions(id);
CREATE UNIQUE INDEX IF NOT EXISTS lotes_bipagem_session_idx ON public.lotes_bipagem(session_id) WHERE session_id IS NOT NULL;

-- Only the authenticated application server may write batches after this migration.
DROP POLICY IF EXISTS "Operators can create their own batches" ON public.lotes_bipagem;
REVOKE INSERT, UPDATE, DELETE ON public.lotes_bipagem FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.finish_scan_session(p_owner uuid, p_session uuid)
RETURNS public.lotes_bipagem
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.scan_sessions; b public.lotes_bipagem;
BEGIN
  SELECT * INTO s FROM public.scan_sessions WHERE id = p_session AND owner_id = p_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;
  IF s.batch_id IS NOT NULL THEN
    SELECT * INTO b FROM public.lotes_bipagem WHERE id = s.batch_id AND owner_id = p_owner;
    RETURN b;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(s.orders) o
    WHERE o->>'status' IS DISTINCT FROM 'checked' OR nullif(trim(o->>'trackingCode'), '') IS NULL OR nullif(o->>'scannedAt', '') IS NULL)
    THEN RAISE EXCEPTION 'SESSION_INCOMPLETE'; END IF;
  INSERT INTO public.lotes_bipagem(owner_id, session_id, responsavel, data, qtd_pedidos, pedidos)
    VALUES (p_owner, p_session, s.responsible, (now() AT TIME ZONE 'America/Sao_Paulo')::date, jsonb_array_length(s.orders), s.orders)
    RETURNING * INTO b;
  UPDATE public.scan_sessions SET status = 'completed', batch_id = b.id, revision = revision + 1, updated_at = now() WHERE id = s.id;
  RETURN b;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_scan_session(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finish_scan_session(uuid, uuid) TO service_role;
COMMIT;
