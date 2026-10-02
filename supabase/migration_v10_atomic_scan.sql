-- Apply after migration_v9_ninho_workspaces.sql. Safe to reapply.
BEGIN;

-- Mirrors normalizeTrackingForScan, including JavaScript whitespace characters.
CREATE OR REPLACE FUNCTION public.normalize_scan_tracking(p_value text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE compact text;
BEGIN
  compact := upper(regexp_replace(coalesce(p_value, ''),
    '[[:space:]' || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195)
    || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202)
    || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279) || ']', '', 'g'));
  IF length(compact) = 20 AND right(compact, 8) ~ '^[A-Z0-9]{8}$' THEN
    RETURN right(compact, 8);
  END IF;
  RETURN compact;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_workspace_scan(
  p_workspace uuid, p_actor uuid, p_session uuid, p_code text, p_revision integer DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.scan_sessions;
  normalized text;
  entry record;
  matched jsonb;
  matched_index integer;
  match_count integer := 0;
  checked_count integer := 0;
  previous_revision integer;
  result jsonb;
  payload jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members
    WHERE workspace_id = p_workspace AND user_id = p_actor AND active AND role IN ('admin', 'operator')) THEN
    RAISE EXCEPTION 'MEMBER_REQUIRED';
  END IF;
  normalized := public.normalize_scan_tracking(p_code);
  IF normalized = '' OR length(p_code) > 200 THEN RAISE EXCEPTION 'INVALID_CODE'; END IF;
  SELECT * INTO s FROM public.scan_sessions WHERE id = p_session AND workspace_id = p_workspace FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;
  IF s.status <> 'active' THEN RAISE EXCEPTION 'SESSION_CLOSED'; END IF;
  previous_revision := s.revision;

  FOR entry IN SELECT value, ordinality FROM jsonb_array_elements(s.orders) WITH ORDINALITY LOOP
    IF entry.value->>'status' = 'checked' THEN checked_count := checked_count + 1; END IF;
    IF public.normalize_scan_tracking(entry.value->>'trackingCode') = normalized THEN
      matched := entry.value;
      matched_index := entry.ordinality - 1;
      match_count := match_count + 1;
    END IF;
  END LOOP;

  IF match_count > 1 THEN
    result := jsonb_build_object('type', 'error', 'message', 'Este rastreio pertence a mais de um pedido. Revise o lote antes de continuar.');
  ELSIF match_count = 0 THEN
    result := jsonb_build_object('type', 'error', 'message', 'Código não encontrado na lista: ' || btrim(p_code));
  ELSIF matched->>'status' = 'checked' THEN
    result := jsonb_build_object('type', 'error', 'message', 'Pedido já bipado: ' || coalesce(matched->>'clientName', '') || ' (' || (matched->>'trackingCode') || ')', 'order', matched);
  ELSE
    matched := matched || jsonb_build_object('status', 'checked', 'scannedAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    s.orders := jsonb_set(s.orders, ARRAY[matched_index::text], matched);
    s.revision := s.revision + 1;
    checked_count := checked_count + 1;
    UPDATE public.scan_sessions SET orders = s.orders, revision = s.revision,
      last_updated_by = p_actor, updated_at = now() WHERE id = s.id;
    result := jsonb_build_object('type', 'success', 'message', '✓ ' || coalesce(matched->>'clientName', ''), 'order', matched);
  END IF;

  payload := jsonb_build_object('result', result, 'confirmation', jsonb_build_object(
    'sessionId', s.id, 'revision', s.revision, 'scannedCount', checked_count, 'totalCount', jsonb_array_length(s.orders)));
  -- Another operator or a tracking refresh changed this revision: synchronize once.
  -- Older clients without a revision also receive the previous full response format.
  IF p_revision IS DISTINCT FROM previous_revision THEN
    payload := payload || jsonb_build_object('session', jsonb_build_object(
      'id', s.id, 'responsible', s.responsible, 'orders', s.orders,
      'revision', s.revision, 'status', s.status, 'batch_id', s.batch_id));
  END IF;
  RETURN payload;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_scan_tracking(text), public.submit_workspace_scan(uuid, uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_scan_tracking(text), public.submit_workspace_scan(uuid, uuid, uuid, text, integer) TO service_role;
COMMIT;
