# Importações: nova verificação em 19/10/2026, às 18h

Produção consultada somente em leitura. Não foram executados workers, alterações de fila, ingestão, renovação OAuth ou migrações. A medição não fez chamadas autenticadas à Olist nem conciliação com a origem. Contagens e checkpoints foram lidos em instantes ligeiramente diferentes.

## Situação às 18:05:52, horário de São Paulo

| Conta | Pedidos armazenados | Última data de venda presente | Situação do histórico |
| --- | ---: | --- | --- |
| Olist 1 | 4.604 | 08/10/2026 | Cursor em 02/09; varreduras concluídas em 01/08–01/09 e 03–08/10 |
| Olist 2 | 1.612 | 19/10/2026 | Cursor em 10/08 bloqueado; varreduras concluídas em 01–09/08, 01/10 e 03–08/10 |
| Olist 3 | 4.191 | 18/10/2026 | Histórico de 01/08 a 08/10 com varredura concluída |

Total na primeira amostra: **10.407 pedidos**, incluindo situações não elegíveis à ABC. A presença de uma venda recente não comprova que todas as vendas anteriores foram importadas. `incremental_through` ainda está vazio nas três contas.

No intervalo de 01/08 a 19/10, de 80 dias, faltava confirmar a varredura de 42 dias da Olist 1, 64 dias da Olist 2 e 11 dias da Olist 3. Esses números não representam dias totalmente sem dados nem quantidades de pedidos faltantes. O dia atual também ainda pode receber novas vendas.

As três atualizações incrementais começaram hoje às 10:57; às 18:05, tinham cerca de **7h09 de tempo decorrido**, sem conclusão. A Olist 1 ainda estava na fase de alterações de 01/10, a Olist 2 em 02/10 e a Olist 3 em 01/10. A fila histórica das contas 1/2 foi criada em 02/10 à noite; sua idade não representa execução contínua, pois inclui pausas, tentativas e períodos sem trabalho.

Desde a medição encerrada às 15:20, até as 18:05, entraram mais **1.571 linhas de pedidos em aproximadamente 2h45**, cerca de 9,5 novas linhas/minuto somando as contas. Os contadores dos jobs também incluem reprocessamentos e cancelamentos; não equivalem a vendas novas.

## Ritmo medido de 18:05:52 a 18:08:52

| Conta | Pedidos armazenados ao fim | Eventos processados em ~3 min | Novos pedidos em ~3 min | Novos pedidos/minuto |
| --- | ---: | ---: | ---: | ---: |
| Olist 1 | 4.619 | 15 | 15 | 4,98 |
| Olist 2 | 1.612 | 19 | 0 | 0 |
| Olist 3 | 4.206 | 15 | 15 | 4,98 |

Ao fim: **10.437 pedidos**, 49 eventos processados e 30 novas linhas nessa janela. A Olist 2 trabalhou em registros existentes, mesmo sem aumentar sua contagem. Seu histórico bloqueado não avançou. Isso mostra por que observar só o total de pedidos pode dar a impressão de que toda a conexão parou. Os incrementais continuavam sem conclusão, cerca de **7h12** após a criação.

## Bloqueio da Olist 2

Às 18:06:20, o job `1af1f19a-24cf-427e-b4bb-3fb317c051c0` continuava no mesmo pedido **7925**, ID ERP **382643017**, cursor em **10/08**. O índice estava em 43 de uma página com 51 IDs. Restavam oito entradas nessa página, incluindo o pedido problemático; esse não é o saldo de todo o histórico.

O erro atual é `Valor decimal inválido ou negativo.`, com **10 tentativas** e próxima retomada agendada para **18:10:20**. O contador processado do histórico continuava em 522, sem avanço desde a medição das 15h. Uma consulta anterior à origem, às 15:18, havia confirmado um item do SKU `SBLL001-K001` com preço unitário **−R$ 5,94**, reproduzindo o erro localmente. Nesta nova verificação, foi confirmado que o checkpoint continua apontando para o mesmo ID; o detalhe da Olist não foi consultado novamente.

O erro bloqueia esse histórico, mas a atualização incremental da mesma conta continua progredindo. O cron está registrando solicitações por minuto. São sinais de continuidade automática; esses registros não permitem confirmar o HTTP final de cada chamada ao worker. Não é necessário manter a página aberta para o cron trabalhar.

## Por que demora

O código impõe espaçamento mínimo de **2,1 segundos por chamada Olist por conexão** durante a execução, aproximadamente 28,6 chamadas/minuto se o processamento fosse contínuo. Cada pedido pode exigir detalhe, marcadores e nota fiscal, além de listagens, enriquecimentos e chamadas ao banco. O cache de produtos reduz parte desse custo.

A rota declara `maxDuration=60`, mas o orçamento da rotina inteira é de **45 segundos**, incluindo renovação e agendamento. O worker reserva 12 segundos antes de iniciar outra consulta. O cron roda por minuto e atende até três contas em paralelo, mantendo apenas um trabalho por conta de cada vez. Histórico e incremental alternam os turnos da mesma conta. Assim, a rotina não consome o minuto inteiro só importando pedidos.

A Olist documenta cotas de leitura de 30, 60, 120 ou 140 chamadas/minuto conforme o plano, compartilhadas entre aplicativos da mesma conta. O plano efetivo dessas contas não foi confirmado. Aumentar o ritmo exige conhecer essa cota e o uso das demais integrações. [Limites oficiais da Olist](https://ajuda.olist.com/pt_BR/hubs-e-plataformas-via-api/aplicativos-api-v3-configuracoes-e-utilizacao).

O limite de execução efetivo da hospedagem também não foi consultado. A Vercel permite configurar a duração conforme runtime e plano; o `maxDuration=60` é uma configuração explícita deste aplicativo. Alterar a janela exige rever a reserva de 90 segundos e o cron para não sobrepor trabalhos da mesma conta. [Documentação da Vercel](https://vercel.com/docs/functions/configuring-functions/duration).

## Infraestrutura na nova amostra

Métricas de 18:05:52 a 18:06:58, cerca de 65 segundos:

| Indicador | Resultado |
| --- | ---: |
| CPU fora de idle | 5,12% |
| Dados somados dos bancos do cluster | 49,04 MB |
| Banco postgres | 33,93 MB |
| Memória disponível / total visível | 137,70 / 456,82 MB |
| Conexões / máximo configurado | 14 / 60 |
| Clientes aguardando no pooler medido | 0 |
| Deadlocks novos | 0 |
| Escrita temporária na janela | 10,80 MB |
| Swap: páginas lidas / escritas na janela | 1.849 / 856 |
| Três leituras ABC sequenciais, incluindo rede desta máquina | 1.454 / 1.440 / 1.486 ms |

A amostra não mostra saturação geral de CPU/conexões. Houve pressão de memória, swap e arquivos temporários, portanto não comprova ausência de gargalos em todos os horários. Não foram medidos picos históricos, tempo interno de cada ingestão, espera de locks por pedido nem consumo mensal de egress. As consultas ABC desta máquina não medem a latência interna do worker hospedado.

O Free publica 500 MB de banco, CPU compartilhada, 500 MB de RAM e 5 GB de egress. O volume conservador de 49,04 MB corresponde a aproximadamente 9,8% da cota publicada de banco, sujeito ao método de contabilização da plataforma. [Plano oficial do Supabase](https://supabase.com/pricing).

Não há evidência nesta janela para atribuir a demora principalmente ao Supabase Free. Um upgrade isolado não corrige o valor negativo, o custo de múltiplas consultas por pedido ou a espera imposta pelo worker.

## Próximos ajustes recomendados

1. Tratar a exceção do pedido 7925 preservando os valores reais. Definir uma pendência rastreável por pedido, com reprocessamento, para evitar que um item excepcional bloqueie todo o restante do histórico; manter a cobertura incompleta enquanto a exceção não for resolvida. Não zerar, inverter o sinal nem descartar a venda silenciosamente.
2. Priorizar a captura das vendas recentes e separar sua chegada das varreduras longas de alterações antigas. Revisar também a semântica do filtro `dataAtualizacao` antes de modificar a estratégia de paginação.
3. Medir duração e códigos de erro das chamadas à Olist, banco, ingestão e checkpoints. Reduzir consultas repetidas e enriquecimentos no caminho principal, preservando os dados necessários e a retomada segura.
4. Só ajustar ritmo, duração e infraestrutura depois de confirmar a cota Olist e as configurações da hospedagem. Não remover a exclusão por conta.

Sem contagem atual do saldo na origem e com o bloqueio determinístico, **não há prazo confiável para concluir tudo**. A importação automática está ativa, mas o histórico da Olist 2 não se resolve apenas repetindo o mesmo dado.

Evidências: [snapshots e ritmo](evidencias/importacao-ritmo-20261019210552/status.json), [checkpoint bloqueado atual](evidencias/importacao-ritmo-20261019210552/bloqueio-atual.json), [métricas de infraestrutura](evidencias/supabase-capacidade-20261019210552/medicao.json), [detalhe anteriormente conferido na origem](evidencias/importacao-ritmo-20261019181722/diagnostico-olist.json).
