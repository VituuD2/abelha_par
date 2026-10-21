# Importações após a v24 — 21/10/2026, 14h18 de São Paulo

**Atualização posterior, às 14h41:** a [métrica mensal e semanal](metrica-importacoes-mensal-semanal-2026-10-21.md) conferiu os IDs de todo o histórico configurado. De 23/07 a 30/09, todos os pedidos não cancelados estavam presentes. Outubro estava em 99,84% de presença, com oito ausentes de hoje e divergências de situação. As projeções abaixo representam o processamento acumulado, incluindo releituras, e não o prazo para importar oito pedidos novos. Os números seguintes preservam a leitura anterior das 14h18.

**Previsão de planejamento para encerrar o passivo e fazer mais uma rodada de atualização: 48–72 horas para as três contas**, condicionada à manutenção do ritmo observado. Olist 2 tem faixa de 18–24 horas e Olist 3 de 24–36 horas. As contas trabalham em paralelo; os prazos não são somados. Há pausas intermitentes em chamadas ao banco/controle de reserva, portanto esta faixa não é compromisso de conclusão.

O principal resultado da nova conferência é que **todos os 4.872 pedidos não cancelados criados de 01 a 20/10 já estão presentes**. O trabalho da fila inclui muitas revisões de pedidos existentes. Não faltam os milhares de pedidos novos que os contadores de processamento podem sugerir.

## Presença e atualização dos pedidos

Conferência por ID imutável do ERP, de 01 a 20/10, terminada entre 14h15 e 14h17:

| Conta | Não cancelados na fonte | Presentes no aplicativo | Ausentes | Situações divergentes entre os registros presentes |
| --- | ---: | ---: | ---: | ---: |
| Olist 1 | 2.633 | 2.633 | 0 | 75 |
| Olist 2 | 965 | 965 | 0 | 20 |
| Olist 3 | 1.274 | 1.274 | 0 | 44 |
| Total | 4.872 | 4.872 | 0 | 139 |

Foram percorridas 54 páginas e 5.226 IDs, incluindo cancelados. Os 139 casos são divergências de situação em IDs já presentes, não pedidos ausentes. Cancelados nunca ingeridos podem ser omitidos da tabela analítica pelo worker; não são contabilizados como uma falta de venda ativa.

Nova conferência dos pedidos criados **hoje, 21/10**, às 14h18:

| Conta | Não cancelados no ERP | Presentes | Ainda ausentes |
| --- | ---: | ---: | ---: |
| Olist 1 | 50 | 48 | 2 |
| Olist 2 | 46 | 44 | 2 |
| Olist 3 | 37 | 36 | 1 |

São cinco ausentes neste recorte. Entre 14h07 e 14h18, a Olist 3 passou de 27 para 36 pedidos de hoje presentes, comprovando avanço da fila recente. Novos pedidos chegaram também durante a medição; esta tabela não é uma fotografia transacional simultânea dos três ERPs.

Presença por ID e comparação de situação não comprovam igualdade de todos os valores, itens, notas e demais campos. A revisão do worker continua necessária. Não foi feita reconciliação ID a ID de todo o período de julho a setembro nesta rodada.

## Filas e prazo

As três filas históricas já têm `scan.version = 2`, mas ainda estavam na fase de vendas por criação; a revisão particionada das alterações ainda vem depois. A cobertura contínua comprovada vai de 23/07 a 08/10 na Olist 1, até 13/10 na Olist 2 e até 11/10 na Olist 3. Também há ciclos de recentes concluídos para 20–21/10 nas três contas. Cobertura significa que houve uma varredura completa; novos pedidos e alterações posteriores exigem outros ciclos.

Todos os `incremental_through` permaneciam nulos: ainda não houve conclusão integral do incremental pendente. Os cursores de vendas estavam em 05/10, 14/10 e 12/10, respectivamente. O cursor não indica a data da venda mais recente presente no aplicativo.

| Conta | Pedidos armazenados, todo o histórico | Processamentos restantes no job atual¹ | Job atual + rodada seguinte¹ | Ritmo efetivo do histórico | Projeção com volume congelado | Faixa de planejamento |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Olist 1 | 9.548 | ~5.586 | ~6.907 | 2,32/min | ~49,6 h | 48–72 h |
| Olist 2 | 4.139 | ~1.642 | ~2.278 | 2,54/min | ~14,9 h | 18–24 h |
| Olist 3 | 4.596 | ~2.388 | ~3.146 | 2,89/min | ~18,1 h | 24–36 h |

¹ São passagens por pedidos, incluindo releituras e atualizações. Não são IDs únicos faltantes nem quantidade de requisições HTTP.

O ritmo foi medido de 12h46m31s a 14h18m14s, aproximadamente 91,7 minutos, pelo crescimento dos contadores persistidos da fila histórica. O ritmo total de cada conta é maior, mas parte da capacidade está destinada à fila recente; dividir o histórico pelo ritmo total subestimaria o prazo.

As contagens reproduzem o plano v24: vendas do cursor até o fim do job, descontando página e índice já consumidos; depois alterações desde a referência fixa do job, em intervalos de criação disjuntos, sem somar repetidamente a mesma consulta diária. Acrescentei uma rodada de vendas e alterações de 18 a 21/10, que é a sobreposição prevista após o job atual até 19/10. Na Olist 1, a contagem de setembro foi dividida em semanas após timeout da janela mensal.

Memória da rodada seguinte: Olist 1, 440 vendas + 881 alterações; Olist 2, 225 + 411; Olist 3, 243 + 515. As projeções descontam o avanço posterior à contagem inicial. Fórmula: `(processamentos restantes + próxima rodada) / ritmo histórico / 60`. A margem de planejamento é operacional, não um intervalo estatístico.

Em calendário, 48–72 horas a partir desta leitura correspondem aproximadamente à tarde de **23 a 24/10** para encerrar o passivo das três contas, se o serviço mantiver a vazão média. Novos pedidos, novas alterações, mudança de escopo ou pausas mais longas podem ampliar o prazo. A antiga projeção de 6–10 dias utilizava o algoritmo anterior e não deve continuar sendo usada.

## Pedidos recentes e gargalos

Os pedidos novos entram independentemente do fim do histórico. Os primeiros ciclos recentes completos duraram aproximadamente 63 minutos na Olist 1, 43 na Olist 2 e 36 na Olist 3; outro ciclo da Olist 3 levou cerca de 33 minutos. O próximo ciclo pode ser agendado dez minutos após a conclusão do anterior. Isso sustenta uma atualização em lotes, da ordem de dezenas de minutos e eventualmente mais de uma hora, sem garantia de latência fixa por pedido.

Na observação curta de 14h08–14h11, Olist 1 e 3 não avançaram e Olist 2 avançou 14 eventos. Na leitura de 14h18, as três tinham voltado a avançar. Foram encontrados erros de consulta de contexto, gravação de origem, controle de consultas e checkpoint com mensagem de reserva alterada, geralmente com código de banco `unavailable`. Essa mensagem pode representar falha da chamada ao banco; não prova por si só que outra execução roubou a reserva.

A telemetria anterior aos GETs diagnósticos, às 14h04, tinha 541/574/585 reservas na última hora e nenhuma resposta 429 registrada. O consumo médio estava muito abaixo dos tetos de 60/36/36 chamadas por minuto. Os totais posteriores incluem os próprios GETs desta auditoria, que também registraram timeouts em consultas amplas. Não misturo esses timeouts com falhas comprovadas do worker.

O snapshot leve de infraestrutura às 14h10 mostrou carga de 1 minuto de 0,09, aproximadamente 132 MiB de memória disponível em 436 MiB, 12 conexões para um limite de 60 e zero clientes aguardando no pool exposto. Essa única amostra não demonstra a causa das falhas; não há evidência suficiente para atribuí-las a saturação de hardware.

**Prioridade técnica:** investigar as falhas de transporte/RPC e os limites de tempo das chamadas ao Supabase, preservando retomada e segurança da reserva. Aumentar a cota da Olist não resolve essas falhas. A v24 já está ativa; não há indicação de migração faltante que explique a fila atual. Nenhum SQL, correção de produção ou deploy foi executado nesta análise.

## Evidências e método

- [Memória de cálculo consolidada](evidencias/importacao-v24-estimativa-20261021170711/estimate.json).
- [Conferência por ID de 01–20/10](evidencias/importacao-v24-reconciliacao-20261021171431/reconcile.json).
- [Snapshot final e conferência de hoje](evidencias/importacao-v24-estimativa-20261021171813/status.json).
- [Contagens Olist 2 e 3](evidencias/importacao-v24-estimativa-20261021170711/status.json) e [complemento da Olist 2](evidencias/importacao-v24-estimativa-20261021170711/next-cycle-olist2.json).
- [Contagem completa da Olist 1](evidencias/importacao-v24-estimativa-20261021170949/status.json).
- [Observação curta do progresso](evidencias/importacao-v24-20261021170853/status.json).
- [Telemetria anterior às consultas ao ERP](evidencias/olist-consumo-20261021170454/usage.json) e [snapshot de infraestrutura](evidencias/importacao-v24-estimativa-20261021170711/database-metrics.json).

A distinção entre criação e atualização segue o [contrato oficial de listagem da Olist](https://api-docs.erp.olist.com/api-reference/pedidos/listar-pedidos). As contagens empíricas e os IDs foram obtidos diretamente das contas verificadas, respeitando o controle compartilhado de cota, sem gravar pedidos ou modificar filas. A única escrita operacional dos diagnósticos foi a reserva de cota e sua telemetria. Tokens e payloads pessoais não foram salvos nas evidências.

Scripts de repetição: `node scripts/analytics-v24-estimate-readonly.cjs` consulta apenas o banco; `--source` acrescenta contagens no ERP; `--source --recent-only` confere os IDs de hoje. `node scripts/analytics-v24-reconcile-readonly.cjs --from=2026-10-01 --to=2026-10-20` repete a conferência fechada. Sintaxe dos dois scripts validada e consultas executadas com sucesso; nenhum teste de ingestão ou gravação foi disparado em produção.
