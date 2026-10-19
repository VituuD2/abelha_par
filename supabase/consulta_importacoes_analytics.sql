-- Consulta de acompanhamento. NÃO é migration e não inicia importações.
-- Executar no SQL Editor do projeto autorizado. Horário comercial: São Paulo.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '20s';

-- 1. Quantos pedidos existem por empresa e data da venda, em todas as situações.
-- A data da venda é diferente do horário em que o worker consultou o pedido.
SELECT c.workspace_id, c.name AS empresa, o.sale_date AS data_venda,
 count(*) AS pedidos_persistidos,
 count(*) FILTER (WHERE o.status=2) AS cancelados_persistidos,
 count(*) FILTER (WHERE o.status<>2) AS nao_cancelados,
 max(o.fetched_at) AT TIME ZONE 'America/Sao_Paulo' AS ultima_leitura_olist
FROM public.analytics_orders o
JOIN public.analytics_connections c ON c.workspace_id=o.workspace_id AND c.id=o.connection_id
GROUP BY c.workspace_id,c.id,c.name,o.sale_date
ORDER BY o.sale_date DESC,c.name;

-- 2. Identificar individualmente os 300 pedidos com datas de venda mais recentes.
-- Ajuste o filtro de data/limite para investigar um período específico.
SELECT c.name AS empresa,o.external_id AS pedido_olist,o.number AS numero,
 o.sale_date AS data_venda,o.status AS situacao,
 o.fetched_at AT TIME ZONE 'America/Sao_Paulo' AS ultima_leitura_olist
FROM public.analytics_orders o
JOIN public.analytics_connections c ON c.workspace_id=o.workspace_id AND c.id=o.connection_id
ORDER BY o.sale_date DESC,c.name,o.external_id LIMIT 300;

-- 3. Filas. processed conta eventos/reprocessamentos, não apenas novas vendas.
SELECT c.name AS empresa,j.mode AS modo,j.status AS estado,
 j.from_date AS de,j.to_date AS ate,j.cursor_date AS dia_em_processamento,
 j.query_phase AS fase,j.page_offset,j.pending_index,j.processed AS eventos_processados,
 j.updated_at AT TIME ZONE 'America/Sao_Paulo' AS ultimo_avanco,
 j.next_at AT TIME ZONE 'America/Sao_Paulo' AS proxima_tentativa,
 j.last_error AS erro
FROM public.analytics_sync_jobs j
JOIN public.analytics_connections c ON c.workspace_id=j.workspace_id AND c.id=j.connection_id
WHERE j.status<>'completed'
ORDER BY c.name,j.mode,j.from_date;

-- 4. O agendamento sozinho não comprova importação: conferir HTTP e avanço acima.
SELECT r.requested_at AT TIME ZONE 'America/Sao_Paulo' AS horario,
 h.status_code,h.timed_out,h.error_msg
FROM public.analytics_cron_runs r
LEFT JOIN net._http_response h ON h.id=r.request_id
ORDER BY r.requested_at DESC LIMIT 20;
ROLLBACK;
