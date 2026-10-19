# Auditoria verificável do Néctar — 16/10/2026

Escopo: estado local do repositório e ambiente publicado acessível, com produção **somente em leitura**. Horários de apresentação em America/Sao_Paulo; os JSONs preservam UTC. Referência Git local: `aef286b7`, com alterações locais anteriores à auditoria. Nenhum deploy, migração, refresh OAuth, importação, cancelamento ou alteração financeira foi executado em produção.

## A. Diagnóstico executivo

1. **A Curva ABC funciona hoje? Parcialmente.** O banco agrega/classifica os registros existentes, mas a ingestão real está bloqueada e os números estão incompletos/desatualizados. Não atende ao critério de sucesso operacional.
2. **O que funciona de verdade?** As três autorizações existentes responderam `/info` HTTP 200 com CNPJ correspondente; consultas PostgreSQL reais filtraram as seis combinações de empresas; ranking/classes coincidiram com o motor TS. Em ambiente isolado funcionaram ingestão idempotente, permissões, filtros, drilldown e CSV/XLSX.
3. **O que está quebrado?** Cinco checkpoints retornam `Identificador Olist inválido.` em itens reais com `produto.id=0`; juntos acumulavam **1.152 tentativas** na leitura de 15h38. Nenhuma conexão registra avanço de importação após 08/10. O schema publicado não possui os recursos v13 exigidos pelo código local.
4. **O que não foi verificado?** SHA da publicação; interface autenticada no navegador; responsividade/QA visual; execução HTTP e configuração exata de `cron.job`/`net._http_response`; definições exatas das funções remotas; RLS real usando sessões de admin/operator; notas/devoluções individuais; carga de 500 mil pedidos e concorrência PostgreSQL real.
5. **Os dados são confiáveis?** A aritmética dos registros presentes passou nas verificações; a completude e a atualização do conjunto foram **reprovadas**. Cobertura de importação não equivale a reconciliação financeira.
6. **As três empresas funcionam corretamente?** As três identidades foram confirmadas agora, superando a pendência histórica do relatório de 02/10. As três ingestões apresentam bloqueios. Multiempresa matemático funciona sobre os dados disponíveis, não sobre toda a operação.
7. **Os números servem para decisões comerciais?** Apenas para exploração provisória, com aviso. Na amostra real de 08/10, o bruto elegível da fonte é **R$ 21.338,66** e o persistido com as situações elegíveis do dashboard é **R$ 4.723,10**: diferença de **R$ 16.615,56**. Não homologar a classificação para decisões definitivas.
8. **Principal motivo da experiência ruim:** incompatibilidade entre o contrato presumido de produto e pedidos reais bloqueia toda a conta; incrementais não avançam, enquanto o painel consegue exibir totais antigos. Repetir retries ou aumentar paralelismo não corrige esse dado.
9. **Caminho mais rápido e seguro:** publicar a correção de itens sem vínculo junto com o schema compatível v13; manter os checkpoints; confirmar avanço pelo cron; atualizar o período de controle, incluindo situações; reconciliar exatamente com cada ERP; só então ampliar histórico e otimizar UX.

**Resultado entregue:** correções locais testadas, scripts reproduzíveis, plano de ativação/rollback e pendências explícitas. A produção continua no estado diagnosticado.

## Evidências e ambientes

| Evidência | Conteúdo e limite |
| --- | --- |
| [Ambiente em leitura](evidencias/curva-abc-2026-10-16/ambiente-readonly.json) | 3 empresas, 3 conexões, 12 jobs, 6.762 pedidos, 6.943 itens, 425 produtos, 14 origens, cobertura/RPCs e HTTP público. Snapshot, não monitoramento contínuo. |
| [Pedidos que bloqueiam a fila](evidencias/curva-abc-2026-10-16/fonte-bloqueios.json) | Cinco detalhes reais HTTP 200; IDs de produto zero; reprodução anterior à correção; sem payload pessoal ou tokens. |
| [Reconciliação de 08/10](evidencias/curva-abc-2026-10-16/reconciliacao-2026-10-08.json) | Fonte consultada a partir de 15h34 e banco recontado às 15h40. São snapshots distintos; não há snapshot transacional na API Olist. |
| [Benchmark isolado](evidencias/curva-abc-2026-10-16/benchmark-isolado.json) | Seeds sintéticos 10k/50k/100k, planos EXPLAIN, duração e memória. Não é SLA de produção. |
| [Testes e comandos](evidencias/curva-abc-2026-10-16/README.md) | Logs completos, ambiente e restrições de execução. |

Documentos lidos integralmente: [relatório final histórico](curva-abc-relatorio-final.md), [implantação/operação](curva-abc-implantacao.md), [auditoria anterior](curva-abc-auditoria.md) e [relatório operacional](relatorio-operacional-abelha-par.md). As afirmações históricas foram confrontadas com código, banco e fonte atual; não foram usadas como aprovação atual.

Versões efetivamente instaladas: Node 24.18.1, Next 15.5.27, React 19.2.8, TypeScript 5.9.3; Windows/PowerShell, PGlite local em memória. As faixas do `package.json` não determinam sozinhas a versão instalada. `npm audit` encontrou seis alertas altos; atualização pontual de `source-map-js` 1.2.1 → 1.2.2 reduziu para cinco. Os demais derivam de `braces` na cadeia `eslint-config-next → fast-glob → micromatch`. Não foi aplicado o downgrade incompatível sugerido por `audit fix --force`. [Advisory source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), [advisory braces, sem versão corrigida informada](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).

## B. Mapa real e matriz de estado

`Olist → OAuth/API → worker/checkpoint → analytics_orders/items → SQL filtrado/ranking → API interna → dashboard → CSV/XLSX`

| Subsistema | Estado atual publicado | Evidência / observação |
| --- | --- | --- |
| Identidade OAuth das três contas | Funcional na leitura observada | `/info` 200 e CNPJs corretos nas três. Não foi testada renovação real nem reconexão. |
| Listagem/detalhe de pedidos | Funcional na amostra | 252 pedidos de 08/10, 256 GETs de listagem/detalhe. Não prova outros períodos/endpoints. |
| Produtos/notas/marcadores | Parcial | Detalhes reais têm produto zero; catálogo/nota/marcadores reais não foram todos consultados. Testes locais cobrem indisponibilidade opcional. |
| Sincronização histórica | Não funcional nos checkpoints bloqueados | 5 retries com mesmo erro; cursores parados em 04/08, 23/08, 05/10 e 06/10. Correção local validada, não publicada. |
| Atualização incremental | Não funcional como garantia de atualidade | Nenhum job incremental entre os 12 observados; situações e vendas de 08/10 desatualizadas. v12 bloqueia agendamento diante de histórico ativo; v13 local muda essa regra. |
| Persistência/idempotência | Parcial em produção; funcional nos testes | Tabelas reais existem; 6.762 aliases e pedidos. Substituição de itens, cancelamento e rollback exercitados no PostgreSQL isolado. Não foram feitos writes produtivos. |
| Agregação e matemática ABC | Funcional para o conjunto presente | 6 consultas reais, nenhuma divergência de ranking/classe com TS; oráculo independente nos testes SQL/TS. |
| Isolamento entre empresas | Funcional nas consultas verificadas | Todas, 1, 2, 3, 1+3, 1+2; somas aditivas, SKU não une produtos. Não implica ausência de duplicidade comercial desconhecida. |
| API interna autenticada | Não verificado em produção com sessão | Anônimos recebem 401; `/analytics/abc` redireciona ao login; GET do worker dá 405. Integração de handlers testada localmente. |
| Dashboard, filtros e drilldown | Parcial | DOM real React verificado; navegador autenticado indisponível. Não se aprovou layout/renderização visual. |
| Exportação CSV/XLSX | Funcional no teste integrado isolado | Mesmo SQL/escopo, leitura do XLSX gerado, texto sem fórmula, valores exatos. Download produtivo não testado. |
| Cron | Parcial | Registros de requisição a cada minuto (2.880 retidos), alterações em retries. Schemas cron/net não expostos via REST; status HTTP final não verificado. |
| Schema/código v13 | Não funcional para ativar o worker local atual | `last_claimed_at` ausente (42703); OpenAPI não contém `analytics_claim_jobs`. Aplicação antiga pode continuar com worker anterior; não afirmar que v13 já está publicada. |
| RLS/segurança | Funcional nos testes, não verificado integralmente no banco remoto | Sem tokens em respostas; limites de workspace/admin exercitados; não houve sessão real de operador. |

### Inventário de código e dependências de execução

| Camada | Arquivos e papel |
| --- | --- |
| Navegação e página | `src/components/layout/sidebar.tsx`, `nectar-icon.tsx`, `src/lib/analytics/config.ts`, `src/app/analytics/abc/page.tsx`: Néctar, autenticação e papel. |
| Interface | `src/components/analytics/abc-dashboard.tsx`, `connection-progress.tsx`: rascunho/aplicação dos filtros, resumo, Pareto limitado a 60, paginação, detalhe, progresso. `src/components/ninho/analytics-connections.tsx`: administração. |
| Consulta | `/api/analytics/abc`, `/options`, `/drilldown`, `/export`; `filters.ts`, `server.ts`, `types.ts`, `engine.ts`, `export.ts`, `coverage.ts`, `reliability.ts`, `progress.ts`. |
| Administração/OAuth | `/api/analytics/connections`, `/oauth/login`, `/oauth/callback`; `auth.ts`, `oauth-errors.ts`, `sync-errors.ts`, criptografia e `tiny-auth.ts` para vínculo operacional. |
| Ingestão | `/api/analytics/sync`, `/api/internal/analytics-sync`; `sync.ts`, `olist-client.ts`, `normalize.ts`: pacing, lease, checkpoint, enrichment, upsert transacional. |
| Dados | v11, v12, v13, `setup_analytics_cron.sql`, `setup_analytics_grupo_multiempresas.sql`, `rollback_v11_analytics_abc.sql`. |
| Operação preservada | `/api/olist`, Nuvemshop, scanner/sessões, histórico, webhook e cron operacional não foram alterados por esta auditoria. |

Não existe segunda ingestão ABC somando Nuvemshop ou cache operacional. `rankABC` TS é referência/teste; a classificação exibida vem de SQL. Funções de ingestão/classificação não são duplicadas no cliente. A redefinição SQL entre versões é intencional e precisa de ordem de aplicação; scripts de testes antigos na raiz não compõem `npm test` e não foram executados por poderem chamar serviços reais fora do escopo de leitura.

### Migrations, funções e integridade

| Arquivo | Conteúdo relevante |
| --- | --- |
| v11 | Oito tabelas, RLS, índices e vínculo legacy; `analytics_assert_member`, `analytics_coverage`, `analytics_claim_job`, `analytics_ingest`, `analytics_reconcile_source`, `analytics_match`, `analytics_cancel_order`, `analytics_filtered_items`, `analytics_abc`, `analytics_drilldown`, `analytics_options`. |
| v12 | `error_code`, `query_phase`, `covers_sales`, índice de cobertura; redefine `analytics_coverage`; cria `analytics_job_status`, `analytics_schedule_range`, `analytics_ensure_coverage`, `analytics_relink_legacy`, trigger/função `analytics_resume_verified_jobs`; classifica/retoma estados antigos. Reaplicação pode alterar filas: não é operação de leitura. |
| v13 | `last_claimed_at`; redefine `analytics_claim_job` e `analytics_schedule_range`; cria `analytics_claim_jobs`. Reserva até três contas distintas, rotaciona jobs e permite incremental junto ao backfill. Arquivo já existia sem versionamento ao iniciar esta auditoria. |
| Cron | `invoke_analytics_sync`, `analytics_cron_runs`, cron separado por minuto, HTTP assíncrono com Vault. O script **dispara uma execução ao ser aplicado**; não foi executado nesta sessão. |
| Rollback v11 | Remove a camada inteira e seus dados. Não é o rollback recomendado para esta correção. Preservação do operacional foi testada isoladamente. |

v11/v12 têm colunas/assinaturas compatíveis no ambiente remoto; isso não comprova hashes das definições. v13 está comprovadamente incompleta/ausente nesse banco. Reaplicar v11 após v12 troca cobertura/claim antigos; reaplicar v12 após v13 troca o agendador. Se houver sobrescrita por versão antiga, reaplicar **todas as definições posteriores afetadas em sequência**, não presumir que apenas v13 recompõe funções exclusivas da v12. Preparado [SQL de inspeção somente de leitura](../supabase/audit_analytics_readonly.sql) para o editor SQL autorizado; não executado no remoto.

Índices por workspace/data/status/empresa/origem, produto e jobs foram exercitados com EXPLAIN isolado. FKs compostas impedem cruzar workspaces; relações adicionais entre companhia/conexão/origem dependem também da RPC de ingestão, pois uma FK isolada não prova igualdade de todos esses vínculos dentro do mesmo workspace. Escrita é restrita ao service role. RLS e privilégios foram testados; o catálogo remoto não foi acessado diretamente para certificar todos os índices/policies. Leases de 90s, token de lease nas escritas, chave canônica bloqueada transacionalmente e substituição de itens passaram localmente. PGlite de conexão única não comprova deadlocks/locks sob concorrência de várias instâncias PostgreSQL.

## C. Bugs e reprodução

“Corrigido local” sempre significa código testado **ainda não publicado**.

| ID | Problema | Severidade | Causa raiz | Reprodução / esperado | Evidência | Correção | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ABC-01 | Item sem vínculo paralisa a conta | P0 | `id(produto.id)` rejeita zero na pré-consulta e normalização | Pedido com quantidade/preço reais e produto zero; esperado preservar item sem inventar catálogo; observado retry infinito | Cinco detalhes reais e 1.152 tentativas | Identidade interna `order:<pedido>:item:<posição>`, escopada pela conexão; não consultar catálogo; flag e nome explícitos | Corrigido local, fila remota pendente |
| ABC-02 | Publicar worker v13 no schema atual falha | P0 | RPC/coluna v13 ausentes | `processAnalyticsBatches` depende de `analytics_claim_jobs`; banco não oferece assinatura | 42703 e OpenAPI remoto | Plano de aplicar v13 antes do deploy; preflight e rollback abaixo | Implantação pendente |
| ABC-03 | Dia “concluído” permanece incompleto/desatualizado | P0 | Backfill de dia em curso é snapshot; incrementais bloqueados por histórico no agendador anterior; filas envenenadas | Consultar 08/10 na fonte e no banco em 16/10; esperado mesmo conjunto/situações; diferença R$ 16.615,56 | Reconciliação real de 252 pedidos | Desbloquear ingestão, v13, retomar incrementais e reconciliar; análise sempre provisória até validação | Sinalização corrigida local; dados não recuperados |
| ABC-04 | Estado vazio confunde falta de vendas com ausência/falha de importação | P1 | Texto vazio único; avaliação ignorava erros de jobs quando conexão não tinha erro | Mesmo resultado zero com coverage vazio, queued, retry e cobertura completa; esperado mensagens distintas | Teste da política compartilhada e DOM existente | `reportReliability`: uncovered/importing/sync_error/covered | Corrigido local |
| ABC-05 | Resposta antiga com falha remove relatório novo | P1 | catch verificava nome do erro, mas não o signal já abortado | Primeiro relatório pendente; trocar Produtos/Clientes; novo responde; antigo rejeita TypeError; esperado manter novo | Regressão DOM com sucesso e falha tardios | Guardas de aborto em relatório/status/detalhe/busca | Corrigido local |
| ABC-06 | Catálogo removido provoca retry permanente | P1 | 404 tratado como transitório obrigatório | API de produto retorna 404, detalhe tem quantidade/preço; esperado manter identidade e marcar enrichment pendente | Teste worker + normalizador | Tratar 404 do produto como enrichment ausente, guardar check | Corrigido local; cenário real ainda não observado |
| ABC-07 | Exportação inclui status de todo workspace e não declara confiabilidade | P1 | Dump JSON global sem resumo de seleção; célula pode crescer demais | Exportar só 1+3; esperado metadados desse escopo; antes incluía 2 e jobs globais | Código e teste integrado CSV/XLSX | Metadados por conexão/intervalo selecionado e aviso provisório; sem dump global | Corrigido local |
| ABC-08 | Atualização recente de enrichment negado é ignorada | P2 | `enriched_at || enrichment_checked_at` escolhe snapshot velho mesmo após check recente | Snapshot antigo e check novo; esperado não repetir API por 7 dias | Teste específico | Usar maior timestamp | Corrigido local |
| ABC-09 | Importar novamente um intervalo coberto não o reconcilia | P1 | `analytics_schedule_range` subtrai períodos concluídos; UI não oferece modo explícito de revisão | Reimportar dia coberto; esperado ação de reconciliação explícita; agendamento normal cria zero | Leitura SQL e testes de agendamento | Criar ação administrativa auditada de reconciliação, com fila/range distintos ou revisão dos incrementais | Pendente; evitar SQL ad hoc produtivo |
| ABC-10 | Sem detecção acionável de cron parado e de idade da fila | P1 | Polling mostra progresso/erros, sem heartbeat do cron/atraso comercial | Cron parado deixa queued sem avanço; esperado aviso temporal com orientação | Código; cron real apenas parcialmente verificável | Telemetria segura e detecção de estagnação | Pendente |
| ABC-11 | Falta recuperar seleção após reload | P2 | Filtros só em estado React | Alterar período/empresas e recarregar; volta aos últimos 30 dias | Inspeção do ciclo de estado; reload real não exercitado | URL/versionamento de filtros; limpar por workspace quando necessário | Pendente |
| ABC-12 | Dependência source-map-js vulnerável | P1 | Versão 1.2.1 no lock | `npm audit`; esperado versão corrigida sem alteração ampla | Advisory e lock | Patch 1.2.2; somente um pacote mudou | Corrigido local |

Itens zero não são descartados nem unidos por SKU/nome. Sua identidade interna representa **a linha da venda**, não um produto canônico inventado; duas linhas/pedidos/empresas ficam separadas. A reimportação substitui transacionalmente as linhas. A análise de relevância por produto continua provisória enquanto houver itens sem vínculo; o bruto e a quantidade reais são preservados. Não mudou a fórmula financeira nem a regra ABC.

## D. Validações executadas

### Reconciliação com a fonte original

Dia comercial **08/10/2026**, situações elegíveis **1, 5 e 6**, cancelados excluídos. Fonte e banco são filtrados independentemente pelas situações registradas em cada um; comparar só os itens dos pedidos atualmente elegíveis na fonte esconderia parte do problema de situações antigas no banco. Por isso o JSON guarda também o subtotal pareado inicial em campo separado.

| Empresa | Pedidos fonte / banco, todas as situações | Elegíveis fonte / banco | Linhas elegíveis fonte / banco | Bruto fonte | Bruto banco | Banco − fonte |
| --- | --- | --- | --- | --- | --- | --- |
| Olist 1 | 148 / 54 | 140 / 27 | 141 / 28 | R$ 7.620,65 | R$ 973,63 | −R$ 6.647,02 |
| Olist 2 | 50 / 16 | 45 / 10 | 55 / 12 | R$ 9.710,69 | R$ 2.563,84 | −R$ 7.146,85 |
| Olist 3 | 54 / 19 | 49 / 15 | 49 / 15 | R$ 4.007,32 | R$ 1.185,63 | −R$ 2.821,69 |
| Total | 252 / 89 | 234 / 52 | 245 / 55 | R$ 21.338,66 | R$ 4.723,10 | −R$ 16.615,56 |

163 IDs da listagem não existem no banco desse dia; nenhum dos 89 IDs persistidos ficou fora da listagem atual. 84 pedidos presentes tinham situação diferente da fonte. IDs de origem não se repetiram nessa listagem. O verificador compara linhas por posição, quantidade racional e valor em centavos; não ajusta valores e não soma total comercial/frete como bruto dos itens. A fonte não fornece snapshot consistente documentado: reconciliação reproduzível não significa imutável. Não foram auditados XMLs, notas autônomas, devoluções ou descontos comerciais individuais.

Em consulta real de 01/08 a 08/10, a ABC retornou 6.514 pedidos elegíveis, 416 entidades e 48.255.021 centavos. Totais por seleção: 1 = 16.645.415; 2 = 6.663.643; 3 = 24.945.963; 1+3 = 41.591.378; 1+2 = 23.309.058. São centavos do conjunto incompleto, não estimativa da operação. Todas as consultas tiveram zero divergência de classe/ranking contra TS. Leituras RPC GET levaram 775–1.235 ms incluindo rede e comparação local; não são latência do endpoint Next autenticado.

### Matemática e base financeira

Oráculo racional independente do código de produção: 7 distribuições × 2 modos × 2 métricas × 2 pares de limites, comparando SQL/TS, além de paginação e ordenação posterior. Inclui vazio, zero, entidade única 100%, 99,68%, 80/15/5, empates, valores acima do inteiro seguro JS e quantidades de 0,125/0,25/0,375. Percentuais TS são truncados a quatro casas; SQL mantém precisão maior, com tolerância abaixo de 0,00011 ponto percentual. Classificação usa comparações exatas, não percentuais arredondados exibidos.

`TINY_LEGACY` permanece padrão. Com limites 80/95, usa acumulado anterior; igualdade avança de classe. `STRICT_CUMULATIVE` usa o posterior: 80/15/5 resulta B/C/C, e entidade única de 100% resulta C; histórico resulta A/B/C e A, respectivamente. Foi adicionada explicação na UI, sem mudar semântica. Empates: métrica DESC, quantidade DESC, identidade ASC (C no SQL). Filtros precedem classificação; ordenar/paginar não recalcula classes sobre a página.

Métrica monetária é a soma de **quantidade × preço unitário**, arredondada por linha em centavos, sem frete/despesas e sem deduzir desconto global/devolução. Não é total comercial, receita líquida, lucro ou margem. Base NF é pedido com nota vinculada elegível, não relatório de todas as notas. Nenhum novo indicador financeiro foi inventado.

### Fluxos e falhas

| Verificação | Execução / resultado |
| --- | --- |
| Página/login produtivo | GET sem sessão: 307 para login. APIs options/sync: 401. Não representa aprovação de usuário autenticado. |
| Primeiro acesso, contas, configuração | DOM do dashboard e Ninho; erros OAuth e vínculo legacy testados. Autorização real completa com interação humana não executada. |
| Consulta/período/empresas | SQL real nas 6 combinações; testes de UI aplicam multisseleção; filtros de situação/produto/canal combinados no PostgreSQL isolado. |
| Histórico, retomada, atualização | Worker com APIs simuladas e banco de teste/fixtures; SQL real testa lease, checkpoint, cobertura parcial, v13 e revalidação. Sem write produtivo. |
| Progresso/refresh | Polling DOM a cada 15s, aba oculta, invalidação por avanço, sem disparar worker pelo navegador. Fechar navegador produtivo não foi testado. |
| Tabela, Pareto, agrupamento/detalhe | DOM: paginação, ranking após sort, mudança de agrupamento, abertura/fechamento de diálogo; SQL drilldown respeita filtros. Sem QA visual. |
| Exportação | CSV/XLSX pelo handler com PostgreSQL isolado: todas as entidades filtradas; centavos corretos; strings de planilha sem fórmulas; CSV neutraliza fórmula; erro 503 libera botão e mantém relatório. |
| Operador/admin | Handlers negam mutação sem admin; operador consulta/exporta; DOM operador sem link administrativo. Sem sessão real de operador produtivo. |
| Vazio/sem histórico/falha | Política compartilhada testada: uncovered, importing, sync_error, covered. Banco isolado vazio exercitado pelo oráculo. |
| 401/403/429/5xx/timeout | Testes de worker: ação necessária ou retry, checkpoint intacto, sem venda parcial. Cliente HTTP: TimeoutError → 503, Retry-After limitado, resposta inválida rejeitada. Sem timeout real esperado por 10s: a exceção de transporte foi simulada. |
| Dados incompletos | Zero/sem ID de produto preservado como linha; SKU pode faltar; cliente sem ID é escopado por pedido; sem nota/produto/marcador não inventa metadado. Pedido sem itens é recusado e continua pendente. |
| Concorrência e respostas antigas | Regressão DOM com sucesso/rejeição tardios; claims distintos/lease expirado; OAuth concorrente e versão/token antigos; transações de ingestão. Concorrência real multi-instância não certificada. |
| Cancelamento/reimportação | SQL testa exclusão de cancelados e atualização sem itens; imports repetidos não somam; aliases sobrevivem à reconciliação confirmada. |
| Segurança | RLS/workspaces, membro inativo, admin estrangeiro, workspace forjado, RPCs service-only, OAuth replay/CNPJ e exportação; SQL parametrizado e ordenação permitida. React escapa texto; não houve pentest de navegador. |
| Regressão operacional | Suíte completa existente de scanner, bipagem, rastreio, sessões, Nuvemshop, OAuth e banco aprovada. Não houve uso real de scanner/equipamento físico. |

Navegador: a skill foi lida, conexão tentada e troubleshooting executado; retorno **“No browser is available”**, lista vazia. Não há screenshots, Playwright real nem aprovação visual desktop/mobile. DOM não foi apresentado como E2E de produção. Reload não restaura filtros e permanece pendente. Não houve teste empírico de exclusão retroativa ou inclusão entre duas páginas Olist; o risco de offset sem snapshot continua aberto.

## E. Alterações implementadas nesta auditoria

- `src/lib/analytics/normalize.ts`: identidade de linha para item sem catálogo, flag de qualidade e nome explícito; preserva números e separação por conexão.
- `src/lib/analytics/sync.ts`: não requisita produto zero; 404 de produto preserva detalhe e marca enrichment; usa timestamp mais recente do cache. Preservadas mudanças de paralelismo já existentes antes da auditoria.
- `src/lib/analytics/reliability.ts` (novo): avaliação compartilhada do escopo/cobertura/erros, usada pela tela e exportação; não confunde importação com homologação.
- `src/components/analytics/abc-dashboard.tsx`: guardas de aborto; estados vazios distintos; resultado provisório; explicação financeira/modos/itens sem vínculo; duas mensagens com acentuação corrigidas. Sem redesenho.
- `src/lib/analytics/export.ts` e `src/app/api/analytics/export/route.ts`: metadados de confiabilidade e cobertura restritos à seleção; evita JSON global em célula única.
- `package-lock.json`: somente patch de `source-map-js` para 1.2.2; não alterado `package.json`.
- Novos testes `analytics-audit.test.cjs`, `analytics-provider.test.cjs`; regressões em engine, sync e UI. Fixture SQL e scripts em `scripts/`; SQL de inspeção e evidências nesta pasta.

Havia mudanças prévias em 14 arquivos, mais `progress.ts` e v13 não rastreados; elas foram preservadas. Não atribuir o diff total da sessão apenas à presente auditoria. Em particular, paralelismo v13, cron ajustado e lógica de progresso já estavam no diretório inicial. Nenhuma migration funcional nova foi criada por esta auditoria; o novo SQL é apenas diagnóstico. Artefatos `.next` rastreados foram recompostos ao estado anterior após os builds; não fazem parte da correção.

## F. Performance, capacidade e benchmark de produto

### Medições reproduzíveis

| Pedidos/itens | Produtos | SQL, 3 execuções (ms) | Página/Pareto | JSON paginado | Agregação exportação | RSS do processo |
| --- | --- | --- | --- | --- | --- | --- |
| 10.000 | 5.000 | 205,98 / 236,21 / 233,98 | 100 / 60 | 43.304 B | 261 ms | 424 MiB |
| 50.000 | 5.000 | 1.473,65 / 1.302,00 / 1.427,09 | 100 / 60 | 43.788 B | 1.350 ms | 511 MiB |
| 100.000 | 5.000 | 3.056,36 / 2.779,96 / 2.841,29 | 100 / 60 | 43.801 B | 3.472 ms | 620 MiB |

Exportação agregou 5.000 entidades, aproximadamente 1,37 MB de JSON. Filtro de produto: 13/19/27 ms. Três consultas solicitadas em paralelo, **serializadas na mesma conexão PGlite**: 1.393/3.765/9.986 ms. Não usar esses números como benchmark de concorrência de um servidor PostgreSQL. Seeds mantiveram FKs; EXPLAIN ANALYZE apenas no banco isolado. 500k não executado: 100k já demonstra crescimento/memória relevante; medir staging PostgreSQL antes de extrapolar. Tempo de interface utilizável, memória Vercel e duração completa do arquivo XLSX grande não foram medidos.

Índices existentes ajudam filtros seletivos; varredura/agregação completa continua proporcional ao volume filtrado. A resposta paginada é pequena, mas exportação materializa resultados completos no banco e no Node. CSV é stream HTTP de um conjunto materializado, não cursor SQL; XLSX limita 50 mil entidades depois da consulta. Não foi introduzido cache global sem isolamento de workspace. Materialização/exportação assíncrona ficam para volume comprovado, sem reescrever a arquitetura agora.

Capacidade Olist: listagem amortizada por página + detalhe por pedido + marcadores + nota quando vinculada + produtos novos/expirados. No cenário com nota/cache quente, aproximadamente 3 chamadas por pedido; com um produto novo, 4; múltiplos itens únicos aumentam o custo. O worker reserva cerca de 12s antes da próxima chamada, dentro de até 45s, mantendo pacing de 2,1s. A ordem de grandeza é **4–8 pedidos por ciclo de minuto por conta**, inferência de orçamento/chamadas, não throughput medido em importação produtiva. Para 10 mil pedidos de uma conta, isso sugere 21–42 horas de ciclos, antes de retries e disputa com outros aplicativos. Não é promessa de conclusão.

A reconciliação fez 256 GETs para 252 pedidos; tempo de rede acumulado por conta foi 22,213s (Olist 2), 20,206s (3) e 56,566s (1), sem contar pacing. Não mediu enrichment produtivo. As 1.152 tentativas bloqueadas mostram desperdício, mas o número exato de chamadas desperdiçadas não pode ser recuperado sem telemetria. Atraso entre venda e dashboard, taxa real de importação e custo de execução serverless permanecem sem observabilidade suficiente. Não estimar custo financeiro sem plano/tarifa. Paralelizar contas não remove o custo por pedido nem resolve um item inválido. Os limites são compartilhados por conta/plano, conforme [Olist](https://ajuda.olist.com/pt_BR/hubs-e-plataformas-via-api/aplicativos-api-v3-configuracoes-e-utilizacao).

### Comparação com documentação pública

Referências consultadas em 16/10/2026; sem inferir funcionalidades por marketing. [Shopify](https://help.shopify.com/pt-BR/manual/inventory-and-locations/fundamentals/abc-analysis) documenta classes por contribuição de receita e orientação de gestão; [Business Central 723](https://learn.microsoft.com/en-us/dynamics365/business-central/reports/report-723) documenta limites, filtros, linhas sem vendas e layout Excel; seu [Power BI ABC](https://learn.microsoft.com/en-us/dynamics365/business-central/inventory-powerbi-abc-analysis) explicita quantidades, valores e composição por classe. [NetSuite](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_0702084957.html) usa consumo anual × custo, segmentação por local e agendamento; não é a mesma base financeira da ABC de vendas. [SAP](https://help.sap.com/saphelp_SCM700_ehp01/helpdata/en/91/0c9537ef68b16be10000009b38f8cf/content.htm?no_cache=true) documenta critérios, participações, acumulados e subtotais. [Olist/Tiny](https://ajuda.olist.com/relatorios-de-vendas/relatorio-de-curva-abc) documenta quantidade/valor, pedidos/notas e agrupamento pai. Essas fontes não certificam nossa regra exata de cruzamento de limites.

| Recurso | Existe aqui | Funcionamento comprovado | Referência documentada | Benefício | Esforço estimado | Prioridade |
| --- | --- | --- | --- | --- | --- | --- |
| Ranking/classificação e limites | Sim | SQL real + oráculo isolado; completude reprovada | Shopify, BC, SAP | Concentrar gestão nos itens relevantes | 1–3 dias para estabilizar/ativar | P0 |
| Receita/quantidade/base declarada | Sim | SQL/TS; bases não líquidas | Olist, BC | Evitar decisão sobre métrica errada | Correção de textos entregue | P1 |
| Filtros e detalhamento rastreável | Sim | SQL e DOM; falta navegador produtivo | Olist, BC | Investigar empresas/canais/pedidos | 1–3 dias de homologação | P1 |
| Exportação e contexto | Sim | Integração CSV/XLSX isolada | BC Excel; Olist | Compartilhar análise reproduzível | Metadados corrigidos; 1 dia de homologação | P1 |
| Cobertura, atualização, reconciliação | Parcial | Lacunas/erros reais comprovados | Critério próprio de confiabilidade; fontes não atestam equivalência | Evitar conclusões incompletas | 3–5 dias | P0/P1 |
| Onboarding por etapas | Parcial, Ninho com muitos controles | Apenas DOM; depende de apps privados | Olist API exige app por seller | Primeira curva sem suporte recorrente | 3–5 dias após estabilizar | P1 |
| Comparar períodos/mudança A/B/C | Não | Não implementado | Shopify descreve atenção a mudanças, sem assumir tela comparativa | Detectar perda/ganho de relevância | 4–8 dias | P2 |
| Visão comparativa de canais/empresas | Filtros e detalhe; sem matriz | Filtros reais comprovados | Requisito gerencial local | Alocação comercial | 3–5 dias | P2 |
| Relatórios salvos/links de filtros | Não | Não implementado | Não atribuído aos concorrentes sem fonte específica | Repetir análise | 2–4 dias | P2 |
| Consolidar produto equivalente | Não; por empresa é separado | Separação comprovada | NetSuite por item/local usa cadastro próprio, não prova equivalência entre nossos ERPs | Visão de grupo sem falsa junção | 5–10 dias + cadastro validado | P2 |
| Sem vendas, estoque, giro/ruptura | Não | Não implementado | BC linhas zero; Shopify gestão de disponibilidade | Reposição/disponibilidade | 10–20 dias + fonte de estoque | P3 |
| Custo/CMV/margem/reposição | Não | Fontes próprias não homologadas | NetSuite usa custo/consumo | Otimizar capital, se dados confiáveis | Descoberta antes de estimar entrega | P3 |

Estimativas em dias úteis de engenharia, sem tempo externo de autorização/ERP. Maturidade: **base analítica implementada, operação ainda não homologada**. Não equivale a ERP/BI pronto para decisões. Um administrador comum ainda pode precisar de ajuda para apps privados, callbacks, migrations, cron e falhas; o fluxo guiado Conectar → Validar → Importar → Confirmar cobertura → Analisar é recomendado depois dos P0.

## G. Roadmap e ativação segura

| Prioridade | Ação / benefício | Esforço | Dependências | Critério de aceite |
| --- | --- | --- | --- | --- |
| P0 | Publicar correção de item zero e ativar v13; remover causa da fila parada | 1–2 dias | Revisão, backup analítico, autorização de implantação | Cinco cursores avançam mantendo IDs/contadores; sem `/produtos/0`; nenhuma venda descartada |
| P0 | Recuperar atualizações e reconciliar amostra | 1–3 dias + tempo de API | Worker corrigido, cron aceitando HTTP | Mesmo conjunto/situações/quantidades; diferença 0 centavos por empresa em dia fechado |
| P1 | Reconciliação explícita de período já coberto | 2–4 dias | Desenho de fila, locks e auditoria administrativa | Revisar dia concluído sem duplicar venda e sem apagar checkpoint; conta/cancelamentos corretos |
| P1 | Telemetria/cron estagnado/frescor e revisão de erros determinísticos | 2–4 dias | Eventos sem dados sensíveis | Mostrar idade de fila, última execução HTTP, calls/order, pendências; alarmar sem expor tokens |
| P1 | Validar navegador desktop/mobile e acessibilidade | 1–3 dias | Navegador disponível, staging/sessões admin/operator | Todos os 15 passos, foco/teclado/modal/tabela, screenshots, download real |
| P1 | Onboarding Ninho em etapas | 3–5 dias | P0 homologado | Admin obtém primeira curva sem intervenção técnica recorrente |
| P1 | Resolver cadeia de lint vulnerável quando houver caminho compatível | 1–2 dias | Patch upstream ou alternativa revisada | Audit sem achado aplicável; build/lint regressões aprovados; sem downgrade amplo automático |
| P2 | Filtros persistidos, relatórios salvos, comparação temporal/classes/canais | 5–10 dias | Conjunto reconciliado e escopo versionado | Reload/link preservam seleção; comparação usa mesma base e cobertura |
| P2 | Equivalência explícita entre produtos e tratamento do catálogo ausente | 5–10 dias + cadastro | Identidade comprovada, trilha de auditoria | Nunca une por nome/SKU automaticamente; vínculos revisáveis sem dupla contagem |
| P2 | Medir staging 100k/500k, cache/agregados/exportação assíncrona se necessário | 3–7 dias | Volume real e orçamento definidos | SLA acordado, teste concorrente PostgreSQL; exportação sem exceder memória |
| P3 | Estoque, giro, ruptura, cobertura de estoque, CMV, margem e reposição | Descoberta + 10–20 dias por escopo | Dados de estoque/custo/devoluções íntegros | Reconciliação dessas fontes; fórmulas aprovadas; nenhuma margem inventada |

### Plano de implantação preparado, não executado

1. Registrar release/backup e observar jobs, contadores, status/CNPJs; executar o SQL de inspeção no projeto autorizado. Confirmar v11/v12 corretas; obter definições antes de qualquer reaplicação. Não alterar credenciais.
2. Aplicar **v13** após v12 validada e antes do worker novo. A migration é aditiva, mas muda concorrência/agendamento e depende de autorização produtiva. Testes de reaplicação, reservas distintas e rotação passaram no banco isolado.
3. Publicar a correção/release completa. O novo tratamento do item zero não exige nova coluna/tabela: IDs de produtos analíticos já são texto. Não trocar a regra financeira nem os modos ABC.
4. Manter os cinco checkpoints: o próximo retry deve processar o mesmo pedido e seguir. Não zerar contadores, apagar jobs ou criar cópias da importação. Não reaplicar v12 só para antecipar retry. O backoff pode levar até uma hora.
5. Confirmar respostas em `net._http_response`, progresso com navegador fechado, criação/avanço de incrementais e ausência de disputa na operação. Cron existente não deve ser recriado sem necessidade: o setup também dispara trabalho.
6. Atualizar o dia de controle por fluxo incremental/reconciliação administrado, respeitando reservas. A UI atual de backfill **não força** reprocessamento de período coberto. Não afirmar que só retomar o histórico corrige automaticamente todos os dias antigos; registrar necessidade de revisão dos intervalos e situações.
7. Reexecutar os verificadores em leitura e exigir igualdade em centavos/quantidade/IDs antes de homologar e ampliar histórico. Confirmar diariamente frescor e dias parcialmente importados.

Rollback de aplicação: retornar à release anterior do worker/UI, manter schema/dados/checkpoints; se necessário, suspender deliberadamente só o cron analítico mediante autorização. v13 é aditiva e pode permanecer durante rollback. Reverter funções v13 para v12 exige revisão e janela de concorrência, pois recupera a limitação que impede incremental durante histórico. **Não executar rollback v11** para desfazer esta correção: ele apaga dados analíticos. Não há rollback de dados artificial porque não houve escrita produtiva nesta auditoria.

## H. Critérios de aceite e situação

| Critério | Resultado |
| --- | --- |
| Reconciliação exata da amostra real | **Reprovado**: diferença R$ 16.615,56; pendente recuperar/reprocessar e repetir leitura |
| Ausência de duplicação por reimportação | Aprovado em SQL isolado, inclusive linhas sem vínculo; não certificado para todos os pedidos comerciais entre contas |
| Isolamento entre empresas | Aprovado nas seis consultas reais e nos seeds isolados |
| Matemática ABC | Aprovada no oráculo independente/SQL/TS e paridade dos rankings reais; regra financeira preservada |
| Filtros e detalhe | Aprovados SQL/DOM; navegador produtivo pendente |
| Retomada de importações | Aprovada em worker/SQL isolados; cinco checkpoints reais continuam pendentes de publicação |
| Dados incompletos identificados | Correção local aprovada; implantação pendente; reconciliação financeira não é inferida da cobertura |
| CSV/XLSX consistentes | Aprovados na integração com banco isolado; download real pendente |
| Administrador e operador utilizáveis | Permissões e DOM aprovados; onboarding/navegador real não homologados |
| Ausência de regressão operacional | 155 testes aprovados; build/typecheck/lint sem erros, dois warnings anteriores preservados; não substitui homologação física da bipagem |

O módulo só estará homologado quando o usuário puder selecionar empresas/período, reconhecer as pendências, reconciliar a fonte e exportar a mesma base correta com autonomia. A entrega local remove a causa comprovada dos cinco bloqueios; não declara recuperados dados que continuam parados em produção.
