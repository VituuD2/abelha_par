# Importações: pedidos ausentes, requisições e gargalos — 21/10/2026

**A auditoria de IDs de outubro encontrou dez pedidos não cancelados ausentes nas três contas.** Os aproximadamente 38,5 mil eventos estimados anteriormente para a Olist 1 representam trabalho do algoritmo atual, incluindo muitas releituras. Não representam pedidos únicos faltando.

Esta revisão investigou produção somente em leitura e acrescentou ferramentas de diagnóstico locais. Não modificou importações, checkpoints, credenciais, cotas ou dados de produção. As melhorias de processamento descritas abaixo ainda precisam de implementação e medição.

## Reconciliação por ID

Listagem completa dos pedidos com **data de criação entre 01/10 e 21/10**, cruzada pelo ID Olist com os registros da conexão no banco, sem comparar apenas contagens ou datas comerciais.

| Conta | IDs na fonte, incluindo cancelados | Não cancelados na fonte | Não cancelados com ID no banco | Não cancelados ausentes | IDs existentes com status diferente, incluindo cancelados |
| --- | ---: | ---: | ---: | ---: | ---: |
| Olist 1 | 2.811 | 2.674 | 2.668 | 6 | 93 |
| Olist 2 | 1.085 | 998 | 996 | 2 | 5 |
| Olist 3 | 1.422 | 1.299 | 1.297 | 2 | 28 |
| Total | 5.318 | 4.971 | 4.961 | 10 | 126 |

Leituras realizadas aproximadamente entre 11h36 e 11h42, horário de São Paulo. Não há snapshot transacional entre ERP e banco; pedidos novos e o próprio worker podem alterar os números durante a consulta. Não foram comparados todos os itens, valores, marcadores e notas de cada pedido. Logo, IDs presentes não provam igualdade integral dos dados.

O escopo é outubro por criação. Não é uma reconciliação de todos os pedidos anteriores a outubro nem de todo o acervo do ERP. Pedidos cancelados ausentes são contados separadamente na evidência: o worker pode não criar uma venda analítica para um cancelado que nunca foi importado. Não devem ser somados automaticamente à meta de novas vendas.

Evidências: [Olist 2 e 3](evidencias/importacao-requests-20261021143635/audit.json) e [Olist 1](evidencias/importacao-requests-20261021143923/audit.json).

## Requisições atuais por pedido

O fluxo está em [sync.ts](../src/lib/analytics/sync.ts). As consultas ao ERP são GETs. Além delas, existem leituras e gravações no Supabase, que não consomem a cota de leitura da Olist.

| Requisição | Frequência atual | Finalidade |
| --- | --- | --- |
| `GET /pedidos?...limit=100&offset=...` | Uma por página consultada, não uma por pedido | Descobrir IDs e percorrer criação/atualizações. Dias vazios e múltiplas varreduras também consomem páginas. |
| `GET /pedidos/{id}` | Uma por tentativa de processar o pedido | Itens, quantidades, preços, cliente, origem, situação e identificação de NF. |
| `GET /pedidos/{id}/marcadores` | Uma por pedido não cancelado processado | Marcadores usados nos filtros analíticos; atualmente é consultada mesmo se o detalhe já contiver o campo. |
| `GET /notas/{id}` | Uma quando o pedido tem NF vinculada | Confirmar situação, tipo, finalidade e data para elegibilidade da análise por nota autorizada. |
| `GET /produtos/{id}` | Condicional, por produto distinto sem cache válido | Complementar cadastro, produto pai, GTIN, categoria e marca. O cache persistido vale sete dias; existe também cache do lote. |
| `GET /info` | Na verificação da identidade, inclusive após mudança do token | Conferir o CNPJ da autorização. Não é uma consulta obrigatória por pedido. |
| `POST` no endpoint OAuth de token | Quando a credencial precisa ser renovada | Renovar acesso. É uma operação separada do fluxo de leitura de pedidos. |

Um pedido não cancelado com NF e produtos em cache normalmente exige **três GETs individuais**: detalhe, marcadores e NF. Soma-se a fração da listagem. Sem NF, normalmente são dois; produtos sem cache e repetições aumentam esse custo. Um cancelado segue o caminho curto: detalhe, atualização do cancelamento no banco e checkpoint, sem enriquecimento subsequente.

Exemplo: cem pedidos com NF, todos em uma página e com produtos em cache, exigem aproximadamente **301 GETs**: uma listagem, cem detalhes, cem consultas de marcadores e cem notas. Não é uma medição de tempo; é a contagem do caminho de código nessas condições.

O CMV usa outra fila: listagem de produtos e histórico `/produtos/{id}/custos` dos produtos base. Não há uma consulta de histórico de CMV por pedido. Essa fila pertence à Olist 1 e compartilha sua reserva de conta e a cota.

Documentação oficial: [listagem](https://api-docs.erp.olist.com/api-reference/pedidos/listar-pedidos), [detalhe do pedido](https://api-docs.erp.olist.com/api-reference/pedidos/obter-pedido), [marcadores](https://api-docs.erp.olist.com/api-reference/pedidos/obter-marcadores-do-pedido), [nota fiscal](https://api-docs.erp.olist.com/api-reference/notas/obter-nota-fiscal) e [produto](https://api-docs.erp.olist.com/api-reference/produtos/obter-produto).

## Por que a fila é tão maior que o número de pedidos ausentes

O incremental alterna a criação diária com `dataAtualizacao=cursor_date`, depois avança o cursor um dia e consulta atualizações novamente. Esses resultados não são conjuntos separados.

Nas amostras das Olist 2 e 3, os cem IDs mais recentes retornados para duas datas consecutivas foram **os mesmos cem IDs**. As amostras incluíam criações de 19–21/10 em buscas com referências de atualização de 09–11/10. Isso comprova sobreposição nessas amostras; a documentação não fornece nessa página um limite superior explícito de atualização.

O banco usa gravações idempotentes, portanto isso não significa duplicação das linhas de vendas. Entretanto, o app pode repetir detalhe, NF, marcadores, normalização e gravação do mesmo pedido em diversas passagens. Se um pedido passar dez vezes pelo caminho de três GETs, serão trinta GETs individuais para um ID, além das listagens.

Outro desperdício ocorre quando um lote termina ou uma etapa posterior falha depois de o detalhe/NF já terem sido consultados. O checkpoint mantém o pedido pendente, mas não persiste todas as etapas intermediárias. No lote seguinte, parte das consultas é repetida. O cache persistido de produtos já ajuda nesse caso; detalhe e NF ainda não têm a mesma retomada por etapa.

## Causa reproduzida na Olist 1

A consulta ampla `dataAtualizacao=2026-10-04`, com página de cem e ordenação descendente, retornou **HTTP 400** após aproximadamente quinze segundos. Mensagem da Olist:

> Sua consulta levou muito tempo. Por favor, ajuste seus filtros ou tente novamente mais tarde.

[Evidência do erro](evidencias/importacao-requests-20261021144025/audit.json). Essa é uma consulta diagnóstica da mesma família de filtro usada no worker; não prova que todos os timeouts do worker tiveram exatamente essa origem. A posição e a ordenação diferem das do checkpoint em andamento.

Mantendo a referência de atualização, testei acrescentar limites por criação:

| Janela de criação | Total retornado | Tempo da resposta HTTP | Resultado |
| --- | ---: | ---: | --- |
| 01–07/10 | 882 | 451 ms | 200 |
| 08–14/10 | 1.045 | 397 ms | 200 |
| 15–21/10 | 844 | 358 ms | 200 |

Os cem registros da amostra de cada resposta respeitaram sua janela de criação. [Evidência dos recortes](evidencias/importacao-requests-20261021144223/audit.json). Esse ensaio mostra que filtros mais seletivos funcionaram bem naquela ocasião; não comprova o tempo de todas as páginas, a equivalência com a consulta ampla nem um ganho global de produção.

O cliente do worker interrompe a consulta depois de dez segundos. Aumentar esse prazo isoladamente não corrige um erro que o próprio ERP encerra por consulta demorada. A estratégia a testar é particionar e reduzir o trabalho, preservando a cobertura.

Na janela de cerca de sessenta minutos encerrada por volta de 11h35, a telemetria persistida da Olist 1 registrou **852 reservas de chamadas, 847 resultados, sete timeouts, zero 429 e zero 5xx**. Foram 835 chamadas de vendas, dezesseis de custos e uma de identidade. Cinco reservas ficaram sem resultado confirmado. O consumo observado naquele instante tinha 97 chamadas restantes em um limite de 120. [Telemetria](evidencias/olist-consumo-20261021143536/usage.json).

Isso não elimina erros de cota em outros momentos, mas não sustenta tratar cota como causa de toda a lentidão nessa janela. Espera do limitador local e indisponibilidade de sua RPC também são situações diferentes de HTTP 429 do ERP. As RPCs de reserva e telemetria têm timeout local de dois segundos; o monitor atual não permite atribuir uma falha dessa reserva a uma causa específica do banco.

## Consulta extra que pode ser eliminada

Em um pedido real da Olist 1, o detalhe já trouxe três marcadores. A chamada separada de marcadores retornou as mesmas três descrições. O produto estava em cache válido e a normalização passou.

Tempos HTTP da amostra: detalhe 300 ms, marcadores 256 ms e NF 330 ms. Esses números excluem o espaçamento deliberado do diagnóstico. [Amostra](evidencias/importacao-pendencias-20261021143839/status.json).

Há uma melhoria objetiva para implementar: usar o array de marcadores presente no detalhe quando válido, inclusive vazio, e consultar o endpoint separado somente quando o campo estiver ausente ou inválido. No exemplo de cem pedidos com NF, isso reduziria 301 para 201 GETs, cerca de **33% menos chamadas**. O ganho de tempo total ainda precisaria ser medido.

O objeto de NF embutido no detalhe da amostra não trazia `tipo` e `finalidade`, exigidos pela regra atual de elegibilidade fiscal. Portanto, eliminar também a leitura da NF sem outro mecanismo confiável prejudicaria a qualidade da análise. A proposta é preservar a validação fiscal e estudar cache/retomada da NF por ID e revisão, com revalidação adequada.

## Complemento: erros da Vercel e CSV recebido

O arquivo `abelha-par-log-export-2026-10-21T14-36-24.csv` contém **216 linhas de log, mas somente 59 execuções HTTP distintas**, agrupadas por `requestId`. A janela é **10h37–11h35 de São Paulo**, UTC 13h37–14h35, em 21/10. Não corresponde às seis horas completas da imagem. O arquivo original foi apenas lido; o [resumo reproduzível dos cálculos](evidencias/vercel-importacoes-20261021/resumo.json) guarda seu SHA-256, método, totais e agregados por execução, sem copiar corpos de pedidos ou credenciais.

### O que os números comprovam

| Indicador | Resultado no CSV |
| --- | ---: |
| Execuções distintas | 59, uma iniciada em cada minuto |
| Respostas HTTP 503 | 53 — 89,8% |
| Respostas HTTP 200 | 6 |
| Lotes de conta registrados | 152 |
| Eventos de pedidos processados | 751 |
| Eventos processados nas execuções HTTP 503 | 705 |
| Consultas contabilizadas pelos lotes | 2.285 |
| Timeouts de consulta | 8 |
| Novas tentativas dentro do lote | 2 |
| Avisos de gravação da telemetria | 5 |

**Todas as 53 execuções HTTP 503 tiveram progresso registrado.** Cinco execuções HTTP 200 processaram os outros 46 eventos; a sexta não registrou lote. Isso não transforma o 503 em sucesso integral: houve interrupções reais de lotes, mas também houve trabalho salvo antes delas. `processed` conta processamentos, incluindo releituras, cancelamentos e atualizações; o CSV não traz IDs dos pedidos para medir novos pedidos ou deduplicar esses eventos.

Todos os 59 disparos identificam `pg_net/0.20.4` como agente. Isso é compatível com a chamada automatizada pelo banco e reforça a execução independente do navegador. Não é uma consulta às sessões de usuários.

### Resultado por conta

| Conta | Lotes | Eventos processados | Consultas contabilizadas | Lotes com `failed=true` | Timeouts de consulta |
| --- | ---: | ---: | ---: | ---: | ---: |
| Olist 1 | 41 | 270 | 830 | 25 | 6 |
| Olist 2 | 56 | 248 | 718 | 35 | 1 |
| Olist 3 | 55 | 233 | 737 | 39 | 1 |
| Total | 152 | 751 | 2.285 | 99 | 8 |

A Olist 1 concentrou seis dos oito timeouts e as duas novas tentativas internas. Ela também teve menos lotes de pedidos nessa janela. O CSV não registra o trabalho de CMV nem a razão de uma conta não receber lote; portanto, não permite atribuir todos esses intervalos ao CMV ou a bloqueio de conta.

Dos **99 lotes marcados como falha, 85 processaram eventos antes de parar**. Em 93 não houve falha transitória registrada pelo contador de consultas; os outros seis lotes concentraram os oito timeouts. Sete lotes com falha nem chegaram a registrar uma consulta pelo contador do worker. Isso não exclui consultas de identidade/renovação fora desse contador.

Os oito timeouts são abortos do cliente Olist, com prazo de dez segundos. O contador `transientFailures` também os inclui porque o cliente os representa internamente como status 503. **Não são oito respostas HTTP 503 comprovadamente enviadas pela Olist.** Não houve falha de rede registrada nesses lotes. O evento não conta separadamente HTTP 4xx; a ausência de 429 não pode ser deduzida desse CSV. A telemetria persistida citada anteriormente é outra fonte, com escopo e janela próprios.

### Por que a rota pode retornar 503 mesmo tendo processado

O [cliente Olist](../src/lib/analytics/olist-client.ts) transforma a impossibilidade de aguardar uma reserva local dentro do orçamento em `AnalyticsQuotaWait`. Nenhuma consulta precisa ter sido enviada ao ERP para essa exceção existir.

O [tratamento do lote](../src/lib/analytics/sync.ts) considera pausa normal somente `AnalyticsBudgetExceeded`, importado como `YieldBatch`. `AnalyticsQuotaWait` cai no caminho de falha: aumenta tentativas, agenda `retry`, grava a mensagem da conexão e retorna `error`. A [rota interna](../src/app/api/internal/analytics-sync/route.ts) retorna HTTP 503 quando qualquer lote retorna `error`, mesmo que as outras contas e parte daquele lote tenham avançado. Falhas de renovação, CMV e agendamento também podem produzir 503 nesse código.

Logo, **há um caminho concreto que classifica espera programada como erro do ciclo**. A distinção já existente entre espera local e 429 real no monitor não corrige, por si só, a classificação do resultado HTTP.

O CSV comprova que cada uma das 53 respostas 503 veio acompanhada de pelo menos um lote com `failed=true`. Entretanto, o evento registra apenas esse booleano: **não registra a exceção, sua categoria ou o endpoint em execução**. Não é possível afirmar que os 93 lotes sem falha transitória pararam todos por cota. Também podem existir HTTP 4xx, falha da reserva distribuída, checkpoint, normalização ou outra etapa. A relação acima usa o código local atual; o export não identifica o commit implantado para confirmar integralmente sua equivalência.

Os eventos são emitidos com `console.info`, inclusive quando `failed=true`. Filtrar apenas o nível `error` na Vercel não basta para investigar essas interrupções.

### Tempos reais e custo das consultas

O painel de duração da imagem está explicitamente marcado como **Demo Data**. Seus 80 ms de média não servem como medição desta investigação. Cada execução do CSV contém exatamente um `durationMs` preenchido:

- Média: **34,07 segundos**; mediana: **33,65 segundos**.
- P95 pelo método de posto mais próximo: **39,74 segundos**.
- Máximo: **40,46 segundos**, abaixo do `maxDuration=60` configurado na rota.

Não há evidência de timeout da função da Vercel nesse recorte. Isso é diferente dos oito timeouts internos de consulta à Olist.

Nos tempos somados dos lotes, **55,7%** estão em `pacingMs` e **12,8%** em `apiMs`. Por conta, a parcela de `pacingMs` é 46,1%, 57,6% e 61,1%. Esse campo inclui aquisição da reserva, chamadas ao controle distribuído, espera de ritmo e eventual espera antes de uma nova tentativa; não mede somente uma pausa intencional do limitador. Como a métrica é registrada após uma tentativa de consulta, esperas de reservas que falham antes de enviar a consulta não aparecem nesse campo. O restante inclui essas esperas e outras etapas, como banco, identidade, normalização e gravação de telemetria, sem separação suficiente para atribuir sua duração a uma delas. Como as contas executam em paralelo, a soma dos lotes não é o tempo de relógio da janela nem o uso de CPU.

As aproximadamente 74 mil chamadas ao Supabase e 16 mil à Tiny na imagem pertencem à janela de seis horas. Não são pedidos únicos, nem contagem de falhas. O código reserva a chamada, registra seu resultado, salva checkpoints e consulta/grava metadados, o que explica haver várias operações no banco por consulta ao ERP. Esses totais não demonstram, isoladamente, saturação do banco. A instrumentação deve separar tempo da RPC, espera deliberada e trabalho de persistência antes de propor aumento de limites ou paralelismo.

### Os cinco avisos do monitor

Os cinco avisos dizem: “Resultado não confirmado no monitor; tentativa permanece contabilizada.” Eles vêm de `recordOlistResult`, quando não é possível confirmar a gravação de telemetria, cujo prazo local é de dois segundos. **Não comprovam falha da consulta à Olist nem perda do pedido.** O código continua sem repetir uma leitura já realizada só porque a gravação do monitor falhou. Isso é adequado; falta registrar a categoria técnica da falha do monitor, sem expor dados sensíveis, para distinguir timeout de RPC, erro de banco e outros motivos.

### Ajustes indicados por esta evidência

1. **Separar resultado do lote e erro real.** Registrar conclusão, pausa por orçamento, espera local de cota, falha temporária e ação de autorização necessária. Tratar espera esperada como retomada programada somente depois de persistir o checkpoint e o próximo horário. Manter alertas e tratamento HTTP apropriado quando a falha realmente impedir processamento ou persistência; não trocar todos os 503 por 200.
2. **Registrar a causa da interrupção.** Acrescentar categoria, código seguro, família do endpoint, fase da consulta, duração da reserva e `next_at`, além de progresso salvo. Não registrar tokens, payloads de pedidos ou dados de clientes. Os atuais 93 casos sem falha transitória precisam dessa distinção.
3. **Corrigir a consulta ampla da Olist 1 e as varreduras repetidas**, conforme os ensaios anteriores. Esses são problemas de trabalho e latência; corrigir o HTTP, isoladamente, não acelera a importação.
4. **Reaproveitar os marcadores e retomar por etapa**, preservando a validação fiscal. Medir depois consultas por ID/revisão, atraso dos pedidos recentes e progresso da cobertura, além da taxa de erro do cron.

Este complemento não alterou código do worker, filas ou produção. Os logs reforçam que a previsão anterior não pode ser interpretada como dezenas de milhares de pedidos ausentes: há muito processamento repetido e retomada. Não permitem calcular um novo prazo de sincronismo completo sem medir a redução desse trabalho.

## Ordem recomendada de implementação

1. **Corrigir as varreduras sobrepostas.** Fazer a leitura de alterações desde um marco uma vez por ciclo, com partições seletivas por criação que cubram todo o histórico necessário. Deduplicar o trabalho por ID/revisão dentro do ciclo. Não excluir pedidos já importados de toda atualização: seus itens, status, notas e cancelamentos podem mudar.
2. **Dar prioridade aos pedidos recentes e às divergências comprovadas.** Uma fila pequena para novos IDs e eventos recentes, com tempo reservado para o histórico. A prioridade não deve depender de alguém abrir a página. A análise deve continuar sinalizando cobertura incompleta enquanto houver pendências.
3. **Reaproveitar os marcadores do detalhe**, com fallback para o endpoint específico quando necessário.
4. **Persistir a retomada por etapa**, para que um timeout em marcadores/NF ou o fim do orçamento não force a repetição do detalhe já obtido. Associar estágios ao workspace, conexão, ID, versão e data; publicar pedido e itens de forma atômica somente quando consistentes.
5. **Medir cada família de endpoint e distribuir custos/vendas com justiça.** Separar timeout do ERP, falha de rede, espera local e falha da reserva no banco; registrar duração e etapa sem dados de cliente ou tokens. Manter limites e reservas distribuídas.

Antes de alterar os checkpoints existentes, é necessário validar a nova consulta em todos os recortes, preservar as vendas por criação, atualizar os marcos apenas após a conclusão e testar retomada, cancelamento e concorrência. Não é seguro simplesmente avançar o cursor para hoje ou apagar os jobs antigos.

Uma fragilidade adicional de qualidade foi encontrada: a documentação de listagem inclui situação **10, Em devolução**, enquanto o normalizador e os rótulos atuais aceitam apenas 0–9. Isso pode bloquear um pedido desse tipo. Não foi comprovado como causa das pausas observadas nesta amostra; deve entrar nos testes e no ajuste do contrato de situações.

## Efeito sobre a previsão anterior

A previsão de 6–10 dias descrevia o custo de executar o algoritmo atual com suas releituras e instabilidade. A reconciliação por ID revela uma necessidade bem diferente: recuperar poucos IDs ausentes em outubro e atualizar dados existentes. Depois de corrigir o processamento, é necessário medir uma nova janela e recalcular o prazo. Não há evidência para prometer um número exato de horas antes da implementação.

Ferramentas de repetição: `node scripts/analytics-request-audit-readonly.cjs`, `--connection=UUID --creation-only`, `--connection=UUID --overlap-only` e `--connection=UUID --bounded-updates`. O teste de recortes está configurado para as janelas de outubro desta investigação. `node scripts/analytics-pending-readonly.cjs --connection=UUID --inspect-requests` inspeciona as chamadas de um pedido pendente sem salvar corpos com dados de cliente. Todas essas consultas gastam cota de leitura e devem ser usadas de forma pontual.
