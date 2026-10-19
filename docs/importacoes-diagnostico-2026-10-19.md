# Diagnóstico da importação — 19/10/2026

Observação de 15:17:22 a 15:20:23, horário de São Paulo. Produção consultada somente em leitura. Não foram executados workers, agendamentos, alterações de fila, renovações OAuth ou migrações. As leituras de tabelas e métricas são sequenciais/paralelas, não um snapshot transacional único.

A consolidação não regrava os pedidos importados: v14/v15 criam funções de relatório STABLE. O importador continua gravando as entidades originais por conta Olist e usando seus checkpoints. A página ainda pode programar cobertura faltante pelo fluxo que já existia; mudar de produto original para produto base não muda o contrato da ingestão. Consultas concorrem pelos recursos do banco e podem aumentar carga, mas os fatores e o rateio são aplicados somente na leitura.

| Conta | Pedidos armazenados ao fim | Última data de venda presente | Histórico confirmado por varredura | Cursor do histórico pendente | Novas linhas em ~3 minutos |
| --- | ---: | --- | --- | --- | ---: |
| Olist 1 | 4.124 | 08/10/2026 | 01–29/08 e 03–08/10 | 30/08 | 12 |
| Olist 2 | 1.110 | 08/10/2026 | 01–09/08 e 03–08/10 | 10/08; bloqueado por valor negativo | 9 |
| Olist 3 | 3.602 | 09/10/2026 | 01/08–08/10 | Histórico até 02/10 concluído | 7 |

Total: **8.836 pedidos armazenados**, inclusive situações não elegíveis à ABC. Ter uma venda em 09/10 não comprova cobertura integral desse dia. Nenhuma conta está confirmada como atualizada até hoje, 19/10. A cobertura indica conclusão da varredura, não conciliação ID a ID com o ERP atual.

O cron registrou solicitações por minuto na janela. O avanço dos contadores comprova execução de trabalho, mas os registros acessíveis não informam o HTTP final de cada solicitação: `net._http_response` precisa de leitura pelo SQL Editor autorizado. Os três jobs incrementais foram criados por volta de 10:57 de hoje e, às 15:20, continuavam na fase de alterações do dia 01/10, com offsets 400, 600 e 1.000. `incremental_through` continua vazio nas três contas. Eles também reprocessam pedidos existentes; seus contadores não equivalem a vendas novas.

## Ritmo e duração

| Conta | Eventos processados em ~3 min | Eventos/min | Novas linhas/min |
| --- | ---: | ---: | ---: |
| Olist 1 | 14 | 4,66 | 3,99 |
| Olist 2 | 10 | 3,33 | 2,99 |
| Olist 3 | 11 | 3,66 | 2,33 |

Foram 35 eventos e 28 linhas novas. Comparando a contagem anterior, aproximadamente às 12:08, com o fim desta medição, o banco passou de 7.428 para 8.836 linhas: +1.408 em cerca de 3h12. Isso mistura novos registros, atualizações, intervalos históricos e diferenças entre os instantes de leitura; não é um benchmark controlado.

Não há previsão confiável de conclusão: existe um bloqueio determinístico, atualizações reprocessam registros, a demanda continua chegando e as três tentativas de contar o período inteiro na Olist expiraram após 15 segundos. A auditoria interrompeu essas consultas em vez de insistir. Não foi obtida uma contagem atual exata do saldo a importar.

## Bloqueio confirmado na Olist 2

O job histórico `1af1f19a-24cf-427e-b4bb-3fb317c051c0` está parado no pedido **7925**, ID ERP **382643017**, de **10/08/2026**. A consulta GET de detalhe confirmou uma unidade do SKU **SBLL001-K001** com preço unitário **−R$ 5,94**. A função `normalizeOrder` reproduziu localmente o erro `Valor decimal inválido ou negativo.` com esse detalhe.

Havia oito tentativas acumuladas, sem avanço no checkpoint. O backoff chegou a uma hora; a próxima tentativa estava marcada para **16:08:16**. Repetir o mesmo dado mantém o erro. A regra de composição e o CMV não participam dessa validação. Não converter o preço em zero, usar valor absoluto ou pular a venda: qualquer tratamento precisa preservar o valor e tornar a exceção rastreável.

Na última amostra também apareceram erros de leitura da conexão no banco nos incrementais das contas 2 e 3, com uma tentativa e retomada automática para aproximadamente 15:20:35. Houve progresso antes desses erros. A causa técnica dessas falhas transitórias não foi identificada: as mensagens atuais ocultam o código do erro de banco/rede. Isso merece investigação própria, sem atribuir automaticamente a falta de memória ou a configuração inválida.

## Limites e arquitetura

O código espaça chamadas Olist em **2,1 segundos**, no mínimo: aproximadamente 28,6 chamadas/minuto durante execução contínua. Um pedido normal precisa de detalhe e marcadores; com nota fiscal, são três consultas, além das listagens e do enriquecimento de produtos quando necessário. Produtos enriquecidos são reaproveitados por sete dias.

O cron chama uma rota com `maxDuration=60`. O aplicativo reserva 45 segundos para a rotina inteira, desconta a renovação/agendamento e deixa 12 segundos de margem antes de iniciar outra chamada. Restam no máximo cerca de **33 segundos para iniciar requisições**, antes de considerar outras despesas. Com três chamadas por pedido e espaçamento de 2,1 segundos, o cenário idealizado fica na ordem de cinco pedidos por conta/minuto; banco, latência, cache frio, retomadas e falhas reduzem esse ritmo. Há até três contas em paralelo, com execução serializada dentro de cada conta. Histórico e incremental disputam os turnos da mesma conta.

A Olist documenta limites de leitura de **30, 60, 120 ou 140 chamadas por minuto**, conforme o plano, compartilhados entre aplicativos da mesma conta. Não foi identificado o plano efetivo de cada conta: o GET `/info` confirmou a identidade, mas não retornou cotas. Aumentar o ritmo sem conhecer essa franquia pode provocar mais 429. [Limites oficiais da Olist](https://ajuda.olist.com/pt_BR/hubs-e-plataformas-via-api/aplicativos-api-v3-configuracoes-e-utilizacao).

A Vercel documenta até 300 segundos no Hobby com Fluid Compute, mas não foi consultada a configuração efetiva deste projeto. O limite de 60 segundos e o orçamento de 45 segundos estão no aplicativo; não são evidência de que a plataforma só permita esse tempo. Aumentar a janela exige revisar cron, reserva de 90 segundos e retomada, para preservar a exclusão por conta. [Duração oficial das Functions](https://vercel.com/docs/functions/configuring-functions/duration).

## Supabase Free nesta amostra

Métricas entre 15:16:21 e 15:17:27, cerca de 65,5 segundos:

| Indicador | Medição |
| --- | ---: |
| CPU fora de idle | 6,88% |
| Dados somados dos bancos do cluster | 47,09 MB |
| Banco postgres | 31,98 MB |
| Memória disponível / total visível | 167,65 / 456,82 MB |
| Conexões / máximo configurado | 13 / 60 |
| Clientes aguardando no pooler medido | 0 |
| Deadlocks novos | 0 |
| Escrita temporária de consultas na janela | 9,15 MB |
| Três consultas ABC sequenciais, incluindo rede | 1.240 / 1.195 / 1.187 ms |

O Free publica 500 MB de banco, CPU compartilhada, 500 MB de RAM e 5 GB de egress. O volume conservador medido é aproximadamente **9,4% da cota de banco**. A amostra não mostra saturação geral. Houve swap e arquivos temporários: não equivale a ausência completa de pressão, e a janela curta não explica todas as falhas intermitentes. Não foi obtido o consumo mensal de egress nem o histórico de pico. [Plano oficial do Supabase](https://supabase.com/pricing).

A conclusão é que **pagar por mais banco, isoladamente, não resolve o pedido com preço negativo nem a estratégia de reprocessamento**. A medição atual não justifica afirmar que o Supabase Free seja a causa principal da lentidão.

## Prioridades propostas

1. Tratar a exceção de valor negativo de forma rastreável, preservando o pedido e seus valores, para liberar o histórico da Olist 2.
2. Separar a prioridade de novas vendas recentes da varredura extensa de alterações antigas. Hoje uma fase longa de alterações de 01/10 atrasa a chegada aos dias seguintes.
3. Registrar código, status e duração das falhas transitórias de banco/rede; as mensagens atuais não permitem concluir sua causa.
4. Reduzir consultas repetidas e revisar enriquecimentos de notas/marcadores, checkpoints e orçamento de execução, mantendo os campos necessários e as reservas por conta.
5. Ajustar o limite de chamadas só depois de confirmar os planos da Olist e o uso compartilhado. Reavaliar upgrade de infraestrutura com medições de pico e egress.

Nenhuma dessas alterações foi aplicada ao worker nesta verificação.

Evidências: [snapshots e ritmo](evidencias/importacao-ritmo-20261019181722/status.json), [detalhe sanitizado do bloqueio](evidencias/importacao-ritmo-20261019181722/diagnostico-olist.json), [tentativas de contagem na origem](evidencias/importacao-ritmo-20261019181722/contagens-olist.json), [métricas de infraestrutura](evidencias/supabase-capacidade-20261019181620/medicao.json).
