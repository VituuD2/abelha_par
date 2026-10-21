# Importações retomáveis — implantação v24

Implementação decorrente da [auditoria das importações](importacoes-requisicoes-gargalos-2026-10-21.md). A migração v24 foi executada pelo responsável no SQL Editor e sua disponibilidade foi confirmada por leitura às **12h24 de 21/10/2026**, horário de São Paulo: [evidência](evidencias/supabase-schema-20261021152401/status.json). A publicação do código e sua observação em produção são registradas ao final deste documento.

## Comportamento implementado

| Problema | Comportamento |
| --- | --- |
| Mesmos pedidos relidos em uma busca ampla de alterações para cada dia | O incremental termina as vendas por criação e percorre as alterações uma vez por ciclo, com a mesma referência inicial e intervalos de criação disjuntos |
| Listagens amplas demoradas na Olist 1 | Partições iniciais de sete dias; timeout ou HTTP 400 na listagem reduz a partição para um dia e retoma sem pular seu início |
| Novas vendas esperando um incremental antigo terminar | Fila de criação de hoje/ontem independente; começa por hoje, com pedidos mais recentes primeiro |
| Histórico ou custos ocupando todas as oportunidades | Prioridade de recentes com rotação dos históricos; CMV tem um ciclo a cada três, mantendo dois ciclos disponíveis para pedidos |
| Consulta de marcadores repetida apesar de já vir no detalhe | Usa o array válido do detalhe, inclusive vazio; consulta separada quando ausente/inválido |
| Fim de orçamento ou espera depois de consultar detalhe/NF | Snapshot por etapa permite retomar sem repetir as etapas concluídas |
| Espera de cota local classificada como HTTP 503 | Pausa programada depois de persistir o checkpoint, sem aumentar tentativas de falha; erros reais continuam sinalizados |
| Falta de causa nos logs | Resultado, etapa, família de endpoint, categoria/código seguro, próxima tentativa, partição e reaproveitamento registrados sem payloads ou tokens |
| Marco incremental atualizado antes da conclusão do job | Conclusão do job e atualização do marco na mesma transação, com verificação da reserva original |
| Situação 10 bloqueando normalização | Preserva “Em devolução”; situações desconhecidas continuam rejeitadas |

Não foram aumentadas as cotas Olist ou a concorrência máxima de três contas. Reservas continuam compartilhadas por conta/CNPJ; gravação do pedido e seus itens permanece atômica. Notas fiscais continuam sendo verificadas para determinar elegibilidade fiscal.

## Cobertura e retomada

O recorte de atualizações usa `dataAtualizacao` fixada no início do job, junto de `dataInicial` e `dataFinal` por criação. O piso é a menor data solicitada nos jobs históricos da conexão; o teto inclui a data atual de São Paulo no início da varredura. Isso cobre o histórico solicitado ao aplicativo, não promete importar pedidos anteriores a esse escopo. As amostras de filtros combinados estão documentadas na auditoria. Novos ciclos preservam a sobreposição de dias já existente para alterações tardias; não se presume que um ID existente esteja atualizado em todos os campos.

Jobs antigos conservam seus IDs pendentes, índice, contadores e páginas. O worker termina a página pendente antes de migrar para o novo plano. Vendas cuja cobertura já é comprovada não são reiniciadas; jobs legados sem comprovação de vendas precisam fazer essa leitura antes de declarar cobertura. As alterações são verificadas novamente uma vez no novo plano, inclusive para pedidos mais antigos que o cursor atual.

Uma listagem vazia com total ainda pendente, total inconsistente ou IDs repetidos na mesma página falha sem avançar o cursor. Partições só avançam depois da página e dos pedidos correspondentes. `analytics_finish_import` rejeita conclusão com IDs pendentes, varredura incompleta ou reserva inválida. A atualização do marco usa o maior valor já confirmado.

A fila recente percorre hoje e ontem em ordem de dias descendente. Um novo ciclo pode ser agendado dez minutos **após o anterior terminar**; isso não é garantia de latência de dez minutos por pedido. A reserva favorece um job recente quando ele não recebeu uma oportunidade nos últimos dois minutos e, nos demais ciclos, mantém a rotação dos jobs antigos. Esses intervalos são oportunidades de execução, não promessas de vazão.

## Snapshots e segurança

`analytics_sync_jobs.import_state` guarda o plano e no máximo o pedido atual. O snapshot inclui somente campos usados pela normalização e a confirmação fiscal necessária; documentos, endereços completos, contatos e tokens não são copiados. Nome/ID do cliente e UF, já usados pela análise, continuam sujeitos às permissões de servidor da tabela. O status público dos jobs não passa a expor esse snapshot.

Detalhe e nota são reutilizados por até dez minutos, para o mesmo ID e versão da conexão. Um snapshot vencido ou de conexão alterada é descartado e consultado novamente. A conclusão de cada pedido remove seu snapshot; a rotina de agendamento remove snapshots de jobs sem atualização há mais de trinta minutos. O documento JSON tem limite de tamanho. O cache persistente de produtos continua separado e preserva suas regras de validade.

Novas funções são restritas a `service_role`. Contexto e conclusão exigem reserva válida; contexto não retorna credenciais. Espera de custos também verifica conta, versão e reserva e preserva offsets e tentativas. Falha ao persistir uma pausa é falha real, não sucesso do cron. A reserva de importação só é liberada com seu identificador original. O worker limita a cinco segundos suas próprias chamadas ao banco.

## Instalação e reversão

Ordem: executar `supabase/migration_v24_analytics_resumable_import.sql` inteiro, confirmar funções/colunas e publicar este código. A migração é aditiva e pode ser reaplicada; os testes verificam que ela não apaga ou reinicia jobs. A aplicação preserva compatibilidade com o banco anterior enquanto os novos campos não existem, mas a nova varredura e os snapshots exigem a v24.

Não usar `rollback_v23_olist_api_usage.sql`: ele removeria o controle de cota e o histórico de consumo. Também não voltar diretamente para um worker anterior à v24 depois de iniciar varreduras novas: ele não interpreta o plano salvo. Qualquer reversão deve preservar um worker que compreenda esses checkpoints. Nenhuma função de execução SQL genérica ou endpoint de migração foi acrescentado ao aplicativo.

## Validação e publicação

Os testes locais incluem migração repetida em PostgreSQL embarcado, preservação de checkpoint realista, reservas por conta, rotação de recentes/histórico, conclusão atômica e restrição de permissões. Os testes do worker cobrem retomada após NF, expiração e invalidação do snapshot, campos sensíveis excluídos, fallback de marcadores, partições sem lacunas, adaptação de timeout e distinção entre pausa esperada e falha de persistência.

Não há promessa de um novo prazo de conclusão antes de observar a produção com o novo algoritmo. O objetivo de aceitação é medir avanço de IDs/alterações, atraso de pedidos recentes, cobertura e categorias de falha; reduzir somente o HTTP 503 não prova sincronismo completo.

**Validação concluída:** 335 testes passaram, incluindo dez testes PostgreSQL da v24. TypeScript, lint e build de produção passaram. O build foi feito em checkout isolado do commit `68528739bbb928b135a18e8b8f0e118132ef7dde`; as outras edições locais não foram incluídas na publicação. Evidências: [resumo](evidencias/implantacao-importacoes-v24-20261021/validation.json), [testes completos](evidencias/implantacao-importacoes-v24-20261021/full-tests.log), [testes SQL](evidencias/implantacao-importacoes-v24-20261021/database-tests.log) e [build](evidencias/implantacao-importacoes-v24-20261021/build.log).

As consultas de validação ao ERP usaram os filtros exatos de partição, para 23–29/07 e 01–07/10, com alterações desde 01/10. As três contas responderam com dados dentro dos limites de criação. Houve uma primeira interrupção no controle de reserva da Olist 3 e um aviso de gravação da telemetria; a repetição pontual da conta passou. Esses eventos não foram apagados da evidência: [primeira coleta](evidencias/implantacao-importacoes-v24-20261021/provider-smoke.json) e [Olist 3](evidencias/implantacao-importacoes-v24-20261021/provider-smoke-olist3.json). Foram somente leituras ao ERP, respeitando o controle distribuído e registrando sua telemetria; nenhum pedido foi ingerido manualmente nessa validação.

**Publicação concluída:** o commit foi enviado para `main` às 12h36. A Vercel confirmou a [implantação](https://vercel.com/vituud2s-projects/abelha-par/6mB5tdB6wx69VgwChPrSx8riGoKu) às **12h45m10s**, após um intervalo sem confirmação de início. O responsável havia sido avisado porque não havia autenticação da CLI Vercel nem navegador conectado neste ambiente. A [observação inicial](evidencias/importacao-v24-20261021153824/status.json) preserva o estado anterior à ativação; o [status da implantação](evidencias/implantacao-importacoes-v24-20261021/deployment.json) identifica o commit e a confirmação da Vercel.

Na [observação de três minutos após a publicação](evidencias/importacao-v24-20261021154630/status.json), cada conta avançou **25 processamentos**, totalizando **75 eventos**. As três tinham fila recente, retomada por etapa e ausência de código de ação de autorização. Não são 75 pedidos novos comprovados: incluem leituras/atualizações de pedidos já existentes.

Os jobs incrementais legados ainda estavam terminando suas páginas pendentes: o plano de partição estava nulo nesses jobs durante essa janela, como previsto pela preservação do checkpoint. A ativação observada comprova o novo worker, os jobs recentes e os snapshots; a conversão desses jobs para a varredura particionada ocorre no término de suas páginas atuais. Os testes e as consultas de validação ao ERP cobrem essa transição, mas a janela inicial não comprova a execução integral das partições de produção.

Na [telemetria posterior à publicação](evidencias/implantacao-importacoes-v24-20261021/usage-after-deploy.json), desde 12h46 até aproximadamente 12h49m49s, não houve 429, 5xx, timeout ou falha de rede **registrados** nas três contas. Foram 68/57/59 reservas e 66/57/59 resultados, respectivamente. As duas reservas sem resultado confirmado não foram classificadas como sucesso nem como falha. Esses números são da API Olist e não uma medição dos HTTP 503 da rota na Vercel.

A [conferência dos dez IDs antes ausentes](evidencias/implantacao-importacoes-v24-20261021/initial-missing-followup.json), às 12h48, encontrou seis presentes e quatro da Olist 1 ainda ausentes. Esse recorte apenas acompanha aqueles IDs; não é uma nova reconciliação de todos os pedidos da Olist, nem demonstra que as seis inclusões ocorreram exclusivamente depois deste deploy. A cobertura histórica e a recuperação dos demais pedidos continuam em andamento.
