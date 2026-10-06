# Curva ABC — implantação e operação

O código está implementado. Estes passos ativam o módulo no ambiente escolhido; a produção não foi migrada nem recebeu importações nesta entrega.

## Sequência de implantação

1. Confirmar v9 (workspaces) e v10 (bipagem atômica) no banco.
2. Confirmar `supabase/migration_v11_analytics_abc.sql` e aplicar **`supabase/migration_v12_analytics_automation.sql` antes de publicar o código atualizado**. Ambas são reaplicáveis. A v12 acrescenta agendamento atômico de lacunas, classificação de erros, retomada de checkpoints após validação e cobertura por dias confirmados. Não altera credenciais, cache ou histórico da bipagem. Não reaplicar v11 depois de v12, pois isso substituiria a função de cobertura pela versão antiga.
3. Publicar o código Next.js pelo processo normal do projeto. Reutiliza `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TOKEN_ENCRYPTION_KEY` e `CRON_SECRET`. As credenciais da conexão antiga continuam nas variáveis `TINY_CLIENT_ID`/`TINY_CLIENT_SECRET`; novas conexões usam credenciais criptografadas no banco.
4. No Ninho → Conexões da Curva ABC, identificar a empresa da conexão atual como **Olist 2**, CNPJ **36.965.322/0001-12**. Se `credential_kind=legacy` e `legacy_integration_id` estiver nulo, usar **Restabelecer vínculo operacional**. O servidor consulta `/info` com a autorização operacional atual; o banco exige o mesmo workspace, o CNPJ cadastrado, a versão da conexão e o token operacional ainda vigente antes de gravar a referência. O procedimento preserva o ID analítico, os pedidos e a bipagem. Não preencher o UUID do vínculo diretamente por SQL. Se a autorização operacional venceu, reconectá-la primeiro nas configurações Olist do Ninho.
5. Cadastrar **Olist 1**, CNPJ **13.397.731/0001-64**, e **Olist 3**, CNPJ **37.201.039/0001-87**, empresas do mesmo grupo autorizado informado pelo responsável. Cadastrar desde o início permite que o painel mostre a ausência de conexão/histórico como escopo parcial.
6. Criar um aplicativo privado na conta ERP de cada empresa adicional, conforme a documentação oficial. Não reutilizar automaticamente as credenciais da Olist 2. Autorizar leitura de pedidos, produtos, notas, marcadores e informações da conta, conforme as permissões efetivamente disponibilizadas no aplicativo.
7. Cadastrar a URL exata de retorno: `https://SEU-DOMINIO/api/analytics/oauth/callback`. A autorização operacional existente conserva sua própria URL `/api/auth/callback`.
8. Informar Client ID e Client Secret nos campos protegidos do Ninho. O servidor criptografa os segredos. Clicar em **Autorizar esta conta**, entrar na empresa correspondente e concluir OAuth. O callback consulta `/info` e exige correspondência com o CNPJ escolhido antes de salvar os tokens. Falhas temporárias nessa consulta recebem uma nova tentativa com o mesmo token, sem repetir a troca do código OAuth. Se não concluir, o Ninho mostra a etapa que falhou e registra uma mensagem na conexão; a validação manual continua bloqueada enquanto não houver autorização salva.
9. Para a recuperação relatada, reconectar **Olist 1 e 3** em suas respectivas contas. A validação do CNPJ no callback retoma os checkpoints falhos, mantendo dia, página, pedido pendente e os 3 pedidos já processados por conta. Após restabelecer Olist 2, aplicar o período **01/08/2026 a 02/10/2026** no painel. As lacunas são programadas automaticamente; trabalhos ativos ou interrompidos já existentes reservam seus intervalos. Conferir um dia conhecido por empresa no ERP. Não apagar os trabalhos nem criar novamente a mesma importação para destravar a fila.
10. Ativar `pg_cron` e `pg_net` no Supabase e aplicar `supabase/setup_analytics_cron.sql`. Usa os segredos Vault já utilizados pela renovação Olist: `abelha_par_app_url` e `abelha_par_cron_secret`. O valor deste último deve corresponder ao `CRON_SECRET` do servidor. Não inserir valores secretos em arquivos SQL versionados.

O endpoint de processamento é `POST /api/internal/analytics-sync`, protegido por Bearer `CRON_SECRET`. A rotina **abelha-par-analytics-sync** roda a cada minuto: renova preventivamente uma autorização analítica elegível, programa incrementais e processa um lote com reserva no banco. Conexões cuja autorização exige intervenção ficam identificadas no Ninho; não impedem o processamento das demais contas. **abelha-par-olist-token-refresh**, configurado em `setup_olist_token_cron.sql`, roda de hora em hora e renova a autorização operacional: não importa o histórico ABC nem dá continuidade à fila analítica. Manter ambos ativos. A importação pelo filtro depende do cron analítico; fechar o navegador não interrompe os checkpoints persistidos.

O script analítico valida os nomes/valores do Vault e registra somente IDs de requisição e horários em `analytics_cron_runs`, com acesso restrito. Não há tokens nessa tabela. Em produção, configurar acesso do endpoint pela infraestrutura de hospedagem, incluindo eventuais proteções de preview/login, e confirmar que a URL Vault aponta para o domínio de produção que recebeu o código. Um HTTP 401 indica segredo divergente ou bloqueio da hospedagem; não confundir com autorização Olist vencida, reportada como erro acionável da conexão.

Validar separadamente as duas rotinas e a resposta HTTP real. O `pg_cron` registra o agendamento; o envio HTTP é assíncrono e sua resposta está em `net._http_response` ([Cron](https://supabase.com/docs/guides/cron), [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)). O estado `succeeded` no cron, sozinho, não comprova execução do worker:

```sql
SELECT jobname,schedule,active FROM cron.job
WHERE jobname IN ('abelha-par-analytics-sync','abelha-par-olist-token-refresh');

SELECT r.requested_at,h.status_code,h.timed_out,h.error_msg,h.content
FROM public.analytics_cron_runs r
LEFT JOIN net._http_response h ON h.id=r.request_id
ORDER BY r.requested_at DESC LIMIT 10;
```

Após reconectar as contas, esperar os ciclos do cron e verificar mudança em `processed`, `cursor_date` e `pending_index`, com o navegador fechado. Timeout/HTTP 5xx não apagam o progresso; leases vencidas podem ser retomadas por outra execução. HTTP 503 com orientação para reconectar exige resolver a conta indicada no Ninho. A implantação e a execução HTTP com as credenciais reais ainda precisam ser validadas no ambiente de produção.

Os passos 4/5 também podem ser preparados antes da primeira importação com `supabase/setup_analytics_grupo_multiempresas.sql`, preenchendo somente o UUID do workspace autorizado. O script identifica Olist 2 e cria Olist 1/3 como conexões pausadas, sem credenciais nem validação fictícia, sem atuar em outros workspaces. Depois escolher cada uma em **Adicionar conta Olist ou atualizar aplicativo**, salvar suas credenciais e autorizar. Validar o CNPJ da Olist 2 continua obrigatório antes de importar.

Antes de importar, o worker confirma o CNPJ correspondente a cada novo token e guarda apenas um fingerprint de validação, além do CNPJ. Isso protege também contra reconectar a autorização operacional antiga em outra empresa sem mudar o ID da integração. CNPJ diferente bloqueia a importação; o token não é copiado nem exibido.

Documentação oficial: [aplicativos privados por conta](https://ajuda.olist.com/hubs-e-plataformas-via-api/aplicativos-api-v3-configuracoes-e-utilizacao), [criar aplicativo](https://api-docs.erp.olist.com/documentacao/comecando/criando-um-aplicativo), [autenticação](https://api-docs.erp.olist.com/documentacao/comecando/autenticacao).

## Schema e isolamento

| Tabela | Finalidade |
| --- | --- |
| `analytics_companies` | Empresas autorizadas no workspace; nome/CNPJ. |
| `analytics_connections` | N contas Olist; empresa, referência à autorização antiga ou credenciais próprias criptografadas, validação de CNPJ, leases, estado OAuth e watermark incremental. |
| `analytics_sources` | Origem real identificada na Olist; canal e classificação explícita de marketplace/loja/conta. |
| `analytics_products` | Cadastro por conexão + ID; SKU, produto pai documentado, GTIN, categoria/marca e pendência de enriquecimento. |
| `analytics_orders` | Venda canônica; empresa/conexão/origem, cliente escopado, datas comerciais, situação atual, nota vinculada, total/desconto e sinais de qualidade. |
| `analytics_order_aliases` | Referências de importação que apontam para a mesma venda canônica. |
| `analytics_items` | Itens normalizados, quantidades/preços decimais e valor bruto em centavos. |
| `analytics_sync_jobs` | Backfill/incremental persistente por período/dia/página/pedido; fases de vendas/alterações, progresso, retry, erros acionáveis e lease. |

Todas as tabelas têm RLS. Leituras diretas, quando concedidas, exigem membro ativo no mesmo workspace. Nenhum usuário do navegador lê `analytics_connections`; os endpoints retornam uma projeção sem segredos. Escritas e RPCs são exclusivas do servidor com service role; RPCs de relatórios verificam novamente usuário/workspace, e reconciliação exige administrador. Chaves estrangeiras compostas impedem referências entre workspaces.

Índices: escopo/data/situação/empresa/origem dos pedidos, emissão de notas elegíveis, identidade de produto nos itens, fila por horário, unicidade de trabalho ativo por conexão/modo/período e cobertura de backfill concluído. Não há alteração de índice/tabela operacional.

## Valores, datas e classificação

- Valor vendido = soma de quantidade × valor unitário dos itens, arredondado uma vez por linha para centavos. Frete e outras despesas não entram. Total de pedido e desconto global são persistidos separadamente para futura análise comercial; não são rateados como devoluções.
- Preços e quantidades são `numeric` no PostgreSQL. O normalizador usa `bigint` e escala decimal; JSON envia totais monetários/quantidades como strings. A interface formata esses valores sem acumular números de ponto flutuante.
- O bruto divergir de `valorTotalProdutos` gera sinal de qualidade; não é silenciosamente ajustado.
- Por padrão, pedidos faturados, enviados e entregues (1/5/6). Outros estados podem ser selecionados; cancelados (2) são sempre excluídos. Cancelamentos conhecidos são aplicados mesmo se o detalhe deixar de fornecer itens. Não se inventa data de aprovação/cancelamento.
- Datas usam o calendário comercial e os presets de São Paulo. Períodos são inclusivos, validados e limitados a dez anos.
- Base **Pedidos com NF autorizada** considera pedidos já importados com nota vinculada de saída, finalidade normal e situação 6/7 confirmada na consulta da nota, pela data de emissão. Não representa todas as notas autônomas do ERP. Notas de devolução não são somadas como novas vendas.
- Devoluções/estornos não são automaticamente descontados da venda original. A V1 é uma visão bruta de pedidos elegíveis, não receita líquida após devoluções. CMV, margem e estoque ficam indisponíveis até haver fontes confiáveis.
- A/B = 80/95 por padrão; configuráveis com `0 < A < B < 100`. `TINY_LEGACY` usa acumulado **anterior**: `< A` → A; `< B` → B; restante C. `STRICT_CUMULATIVE` aplica os mesmos limites ao acumulado **após** a linha. Igualdade com 80/95 avança para a classe seguinte.
- Empates: métrica decrescente, quantidade decrescente, identidade crescente (collation C no SQL). Ordenação visual ocorre depois da classificação e não altera ranking/acumulado. Métrica zero em todo o conjunto produz classe C e percentuais zero.

## Identidade e deduplicação

Por padrão, venda = workspace + conexão Olist + ID do pedido; produto e cliente = conexão + ID. Ausência de ID de cliente usa uma identidade por pedido, nunca consolida por nome. SKUs iguais em empresas diferentes permanecem separados. Produto pai só agrupa se a API fornecer a relação; sem pai o registro permanece individual. Vinculação explícita de produtos entre empresas é uma extensão futura, não uma junção automática por SKU/GTIN.

Importação, reimportação e notificações operacionais não geram vendas extras: a V1 analítica lê somente pedidos Olist. Nuvemshop, cache e webhook não são somados à análise. Itens são substituídos em uma transação SQL.

Se duas conexões representam comprovadamente **a mesma conta de venda externa** e o mesmo identificador de pedido nessa conta, cadastrar a mesma **Conta externa canônica** nas origens e confirmar a reconciliação no Ninho. Não usar apenas o nome “Mercado Livre” ou “Site” como identidade: a conta precisa identificar o seller/loja real e o namespace da referência externa. A operação junta referências iguais, preserva aliases e escolhe a origem pela conexão com menor UUID, uma regra estável e documentada. Reimportação da outra cópia não soma nem substitui a fonte escolhida.

A alteração de identidade em vendas existentes passa pela RPC administrativa transacional. Remover uma conta canônica já usada é bloqueado porque as cópias deduplicadas não formam um arquivo de payloads recuperável; exige recuperação/reimportação assistida das fontes. Validar a identidade antes de confirmar a reconciliação. Não há deduplicação probabilística por cliente, nome, valor ou data.

## Sincronização e recuperação

### Falha no retorno da autorização

O retorno `analyticsError=configuration` de versões anteriores era genérico: não distinguia falha na troca dos tokens de falha na consulta do CNPJ. Uma tentativa que terminou assim não permite concluir que faltam permissões no aplicativo.

O callback agora distingue `token_request` (rede/timeout na autenticação), `exchange` (troca recusada), `token_response` (tokens inválidos), `account_permission` (HTTP 403 em `/info`), `account_authorization` (HTTP 401), `account_rate_limit` (HTTP 429), `account_unavailable` (falha temporária após nova tentativa), `account_response` (CNPJ ausente/inválido), `company` (CNPJ diferente) e `save` (persistência/conexão alterada). Os logs `[analytics-oauth]` contêm somente etapa, código interno, status HTTP e ID da conexão; os tokens e os segredos não são registrados.

O código OAuth é de uso único. Após corrigir a causa indicada, use **Autorizar esta conta** para obter outro código. Não recarregue a URL antiga do callback. Não é necessário salvar novamente o aplicativo se as credenciais não mudaram. Se as permissões forem alteradas, siga a orientação oficial da Olist para renovar o Client Secret, atualize-o no Ninho e autorize novamente.

Backfill consulta pedidos criados em cada dia, com paginação de 100, de todas as origens. Novos incrementais consultam **vendas criadas e depois alterações** por dia, com watermark persistente e sobreposição do dia anterior. A fase `sales` usa `dataInicial`/`dataFinal`; `updates` usa `dataAtualizacao`. O primeiro incremental começa no menor valor entre a data de criação do backfill e seu último dia, com a sobreposição, para captar alterações ocorridas durante a importação e vendas criadas entre o fim do período e sua conclusão. Mesmo sem novos dias, o cron repete o incremental após uma hora para captar alterações do dia atual, sem acumular trabalhos ativos duplicados.

A cobertura une históricos e novos incrementais com `covers_sales=true`. Incrementais antigos, que consultaram apenas alterações, não comprovam cobertura de vendas e permanecem fora dessa união. Trabalhos em andamento contribuem somente com os dias anteriores ao cursor que já terminaram todas as páginas e fases; o dia em processamento permanece parcial. Intervalos adjacentes são unidos e lacunas permanecem separadas, mesmo que existam alguns pedidos dentro delas. Não inferir cobertura pela menor/maior data de pedido.

Ao consultar a ABC, o servidor devolve os dados existentes e agenda as lacunas para as empresas/conexões selecionadas, com validação de membro e workspace no banco. Um lock transacional por conta serializa agendamentos concorrentes. Filtros de origem explícita restringem às conexões dessa origem; filtros comerciais não limitam a coleta dentro de uma conta, pois o cadastro completo é necessário para descobrir novas vendas e origens. Uma falha no agendamento é mostrada sem descartar o relatório já disponível. O painel atualiza relatório, filtros e status a cada cinco segundos enquanto houver trabalhos ativos. O Ninho e o painel mostram intervalos confirmados, dia/posição atual, pedidos processados, última sincronização e erros. A consulta de status preserva trabalhos pendentes antigos, mesmo com muitos incrementais recentes.

Cada conta tem lease de 90 segundos no banco; o worker usa o orçamento restante de até 45 segundos da rotina e espaça consultas em 2,1 segundos. Chamadas têm timeout de 10 segundos; renovação OAuth, 12 segundos. O erro 429 agenda retomada respeitando Retry-After, com limite de uma hora. Falhas transitórias usam atraso crescente, limitado a uma hora, e continuam em **retry** automaticamente. Não abandonam a fila depois de dez tentativas. HTTP 401, OAuth revogado/expirado, vínculo perdido, CNPJ divergente e HTTP 403 nas consultas obrigatórias exigem ação e preservam o checkpoint em **failed**, com código e orientação. Após reconexão/validação correspondente, a fila volta a **queued** automaticamente. A migração v12 classifica erros antigos de autorização e retoma falhas transitórias antigas. O botão **Processar próximo lote** continua disponível como apoio manual.

Cadastros consultados são persistidos antes de avançar o pedido e reaproveitados por sete dias. Isso permite retomar pedidos com muitos produtos. Permissão 403 em enriquecimento opcional é registrada; os dados ausentes não são inventados. Falhas transitórias e payloads inválidos interrompem o pedido antes da gravação parcial. Cursores são gravados após cada ingestão; falha entre gravação e checkpoint reimporta idempotentemente.

Não apagar dados financeiros para “corrigir” uma interrupção. Consultar erro, corrigir autorização/limite/permissão e retomar. Volumes/rate limits dependem do plano da conta e são compartilhados com outras aplicações. Antes do backfill grande, medir pedidos/minuto e reduzir a disputa com a operação. A API usa paginação por offset, sem snapshot histórico documentado; repetir períodos recentemente alterados para reconciliação de origem é recomendado.

## Consulta, exportação e performance

O dashboard não chama APIs comerciais. Filtra/agrega no PostgreSQL e recebe 25/50/100 entidades por página, até 60 pontos de Pareto e resumos. O acumulado do Pareto usa todas as entidades, mesmo quando só os primeiros 60 são desenhados. O corte aparece explicitamente no gráfico. Filtros recebem até 200 opções por dimensão e permitem busca adicional no servidor. Não há download de todos os pedidos para cálculo no navegador.

O drilldown usa o mesmo conjunto filtrado e pagina 50 pedidos. CSV/Excel exportam **todas** as entidades classificadas e metadados de escopo/cobertura, não apenas a página visível. A consulta de exportação é uma única instrução SQL, com snapshot MVCC consistente. O CSV protege células contra fórmulas injetadas e é codificado UTF-8 com BOM; Excel mantém campos de texto como texto.

**Limite prático:** CSV usa stream HTTP, mas o conjunto de entidades agregadas é materializado no PostgreSQL/Supabase e na memória do servidor. Não é um cursor de streaming de banco. XLSX aceita até 50 mil entidades; acima disso usar CSV. Para milhões de entidades distintas, adicionar exportação assíncrona para Storage e tabelas agregadas/materializadas antes de oferecer exportações tão grandes. Validar planos de consulta e duração no banco/volume real; testes locais não demonstram latência em produção.

## Rollback

Primeiro reverter a publicação do código e interromper a rotina analítica. Se for preciso remover o schema, exportar dados analíticos e aplicar **deliberadamente** `supabase/rollback_v11_analytics_abc.sql`. O script remove somente funções/tabelas/cron do módulo ABC. Nenhum token operacional, cache, workspace, sessão ou histórico de conferência é apagado. O rollback não foi executado em produção.

## Validação de ativação

Comparar um dia conhecido por empresa com o ERP: quantidade de pedidos por situação, soma bruta de itens, quantidades, cancelamentos e origens. Confirmar também que cada token retorna o CNPJ esperado, que as três empresas aparecem e que 1 + 3 exclui 2. Só ampliar o backfill quando essas referências concordarem. Registrar permissões sem dados e campos indisponíveis. O painel deve continuar indicando escopo parcial enquanto faltar empresa, autorização verificada, cobertura ou houver erro.
