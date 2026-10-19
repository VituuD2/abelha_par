# Curva ABC: tempo de resposta

O usuário identificou `/api/analytics/abc` como a requisição que levou 22 segundos. Essa duração completa não foi reproduzida com uma sessão real no servidor hospedado. Foram feitas medições limitadas, somente de leitura, e testes locais de atrasos/concorrência. Nenhuma migração, publicação ou alteração de pedidos/checkpoints foi executada.

## Medição de referência

Às 18:40 de São Paulo, consultas desta máquina ao Supabase, para o período padrão de 20/09 a 19/10 e situações 1/5/6, deram:

| Consulta | Tempo | Pedidos no resultado | Entidades |
| --- | ---: | ---: | ---: |
| Produtos base, composição v16 | 1.387 ms | 3.883 | 82 |
| Produtos Olist | 1.139 ms | 3.883 | 365 |
| Opções de filtro | 220 ms | — | — |

As regras de composição enviadas ao banco tinham aproximadamente 52 KB; o relatório consolidado retornou aproximadamente 30 KB. Foram feitas uma consulta de cada tipo, sem repetição para testar carga. Isso não mede autenticação do operador, início da função hospedada, rede do navegador ou agendamento. Não permite atribuir os 22 segundos somente ao SQL ou prometer um tempo final de 1,4 segundo. Evidência: [baseline.json](evidencias/abc-desempenho-2026-10-19/baseline.json).

## Esperas removidas

Antes, a rota calculava o relatório e depois aguardava `analytics_ensure_coverage` antes de devolver os dados. Esse segundo passo pode disputar locks de agendamento, mas não é necessário para apresentar vendas já armazenadas.

O dashboard agora pede o relatório com `ensureCoverage:false` e agenda a cobertura em uma requisição independente, `POST /api/analytics/coverage`, iniciada em paralelo. A programação continua usando a mesma função transacional/idempotente, com filtros validados e workspace/ator obtidos no servidor. Operadores mantêm a mesma capacidade de programar o histórico correspondente à análise; a rota não executa workers. Erros continuam visíveis e a atualização manual permite nova tentativa. Respostas de filtros anteriores são descartadas. Ordenação/paginação não repetem o agendamento concluído.

O endpoint de relatório mantém o contrato anterior para clientes que não enviam `ensureCoverage:false`, inclusive o erro de agendamento junto dos dados existentes. Nesse caminho, o módulo de sincronização é importado somente quando necessário. No fluxo novo, a resposta de leitura não espera esse módulo nem o agendamento.

Foi corrigida também uma disputa com a atualização automática. O painel consulta o progresso a cada 15 segundos. Antes, um avanço podia disparar outro relatório e abortar o anterior; uma consulta mais lenta que esse intervalo podia ser interrompida repetidamente. Agora os avanços são acumulados enquanto o relatório termina e geram uma única leitura seguinte. A necessidade de atualizar opções de filtro também é preservada. Mudanças explícitas de agrupamento/filtros continuam cancelando respostas antigas. A aba oculta continua suspendendo o polling.

Os cálculos SQL, rateio por CMV, conversões de quantidade, ranking, limiares A/B, filtros, detalhamento e exportação não foram alterados. Não foi introduzido cache de relatório ou redução do conjunto de dados. Cada relatório segue sendo calculado pelo banco sobre seu snapshot completo.

## Como localizar uma demora restante

As respostas agora incluem `Server-Timing`:

- `/api/analytics/abc`: `authorize`, `report` e `coverage`. No dashboard novo, `coverage` deve ser `0.0`, pois o agendamento foi separado.
- `/api/analytics/coverage`: `authorize` e `coverage`.
- `/api/analytics/options`: `authorize`, `options` e `status`; opções/status são consultados em paralelo.

Compare esses tempos com a duração total no painel de rede. `report` inclui a viagem do servidor ao Supabase e a resposta da RPC. `authorize` inclui autenticação e leitura da participação. O tempo fora dessas etapas pode incluir rede, espera e inicialização da função antes de entrar no handler. Os cabeçalhos não incluem nomes, documentos, tokens ou conteúdo dos pedidos.

## Validação

Passaram **49 testes** de API, desempenho, cálculo, composições e interação do gráfico. Cobrem cálculo exato, filtros aplicados antes da composição, isolamento por workspace, catálogo do servidor, CMV ausente, soma de centavos, pedidos distintos, ordenação/paginação, exportação e detalhamento.

Os novos testes verificam que um agendamento pendente não segura a leitura, sua falha não apaga os valores exibidos, atualização manual tenta novamente, erro antigo não substitui a análise atual e três avanços da importação durante uma consulta lenta geram apenas uma leitura seguinte. O teste do servidor também mantém o agendamento pendente enquanto confirma que o endpoint ABC consegue responder.

A execução adicional do arquivo `analytics-ui.test.cjs` continuou com as duas falhas já documentadas: expectativa do texto de pedidos processados e de `Escopo parcial`, elementos retirados anteriormente da interface. Os outros oito testes desse arquivo passaram, incluindo filtros, detalhamento, exportação, respostas antigas e agrupamento inicial. Nenhum teste foi removido/ignorado para esconder as falhas, nem a interface anterior foi reinserida como parte desta alteração.

Typecheck e build de produção passaram. O lint mantém quatro avisos anteriores no dashboard, sem novos avisos. Evidência do build: [producao.json](evidencias/abc-desempenho-2026-10-19/producao.json). O teste de DOM não equivale à validação de desempenho em navegador autenticado de produção.

Para ativar, publicar a aplicação completa, incluindo o novo endpoint de cobertura. Não exige nova migration. O ganho efetivo no caso dos 22 segundos deve ser conferido no ambiente publicado pelos tempos acima.
