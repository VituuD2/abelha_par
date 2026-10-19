-- History search only. Requires the workspace/RLS setup from v9; independent of analytics.
-- No changes to scan submission, tracking visibility, orders or import workers.
BEGIN;

CREATE OR REPLACE FUNCTION public.batch_history_search_text(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT regexp_replace(lower(normalize(coalesce(p_value,''),NFD)),U&'[\0300-\036f]','','g');
$$;

CREATE OR REPLACE FUNCTION public.search_workspace_batches(p_workspace uuid,p_query text,p_offset integer DEFAULT 0,p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE needle text:=batch_history_search_text(btrim(p_query)); result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM workspace_members WHERE user_id=auth.uid() AND workspace_id=p_workspace AND active) THEN
  RAISE EXCEPTION 'MEMBER_REQUIRED';
 END IF;
 IF p_query IS NULL OR length(btrim(p_query)) NOT BETWEEN 1 AND 200 OR p_offset IS NULL OR p_offset<0 OR p_offset>2000000
  OR p_limit IS NULL OR p_limit<1 OR p_limit>50 THEN RAISE EXCEPTION 'INVALID_SEARCH'; END IF;
 WITH matched AS MATERIALIZED (
  SELECT b.*,m.orders matched_orders
  FROM lotes_bipagem b
  CROSS JOIN LATERAL (
   SELECT jsonb_agg(o.item ORDER BY o.position) orders
   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(b.pedidos)='array' THEN b.pedidos ELSE '[]'::jsonb END)
    WITH ORDINALITY AS o(item,position)
   WHERE coalesce(o.item->>'status','checked')='checked'
    AND EXISTS(SELECT 1 FROM unnest(ARRAY[
      o.item->>'clientName',o.item->>'trackingCode',o.item->>'numeroPedido',o.item->>'nuvemshopNumber',o.item->>'yampiId',
      o.item->>'ecommerceOrderNumber',o.item->>'ecommerceChannelOrderNumber'
    ]) AS field(value) WHERE strpos(batch_history_search_text(field.value),needle)>0)
  ) m
  WHERE b.workspace_id=p_workspace AND m.orders IS NOT NULL
 ), page AS (
  SELECT * FROM matched ORDER BY created_at DESC,id DESC OFFSET p_offset LIMIT p_limit
 )
 SELECT jsonb_build_object(
  'batches',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',id,'numero_lote',numero_lote,'responsavel',responsavel,'data',data,'qtd_pedidos',qtd_pedidos,
   'pedidos',pedidos,'created_at',created_at,'matchedOrders',matched_orders
  ) ORDER BY created_at DESC,id DESC) FROM page),'[]'::jsonb),
  'total',(SELECT count(*) FROM matched),
  'matchingOrders',coalesce((SELECT sum(jsonb_array_length(matched_orders)) FROM matched),0)
 ) INTO result;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.batch_history_search_text(text),public.search_workspace_batches(uuid,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.batch_history_search_text(text),public.search_workspace_batches(uuid,text,integer,integer) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
