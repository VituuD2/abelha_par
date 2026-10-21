# Estimativa de conclusão — 21/10/2026, aproximadamente 11h25 de São Paulo

**Atualização às 11h43:** a [auditoria de requisições e IDs](importacoes-requisicoes-gargalos-2026-10-21.md) confirmou forte sobreposição das varreduras. Na janela de criação de 01–21/10, foram encontrados dez pedidos não cancelados ausentes nas três contas, além de divergências de status. Os números abaixo continuam sendo uma projeção do trabalho do algoritmo atual, incluindo suas releituras; não são uma meta de pedidos únicos faltantes. Uma implementação que elimine o desperdício exige nova medição de prazo.

A previsão de planejamento é **6–10 dias para as três contas**, condicionada à recuperação das pausas da Olist 1 e à manutenção do ritmo médio. Olist 2 e 3 têm cenário de **2–3 dias**. A projeção da Olist 1 tem baixa confiança: sua contagem é amostral e houve timeouts e pouco avanço na medição curta. Não é um prazo garantido, nem uma previsão de sincronismo em tempo real.

## Dados usados

| Conta | Trabalho restante até os dados de 21/10 | Ritmo do incremental em aproximadamente 32 minutos | Ritmo em aproximadamente 18h36 | Projeção com volume congelado |
| --- | ---: | ---: | ---: | --- |
| Olist 1 | Aproximadamente 38.515 eventos, interpolados | 3,43/min | 4,86/min | 132–187 horas |
| Olist 2 | 7.973 eventos contados | 3,27/min | 2,77/min | 41–48 horas |
| Olist 3 | 11.747 eventos contados | 3,43/min | 4,76/min | 41–57 horas |

As contas executam em paralelo: os tempos não devem ser somados. Eventos incluem releituras, alterações e cancelamentos, além da descoberta de vendas. Não são quantidades de pedidos únicos faltando no banco. Os totais são fotografias das consultas e cursores em momentos próximos, sem snapshot transacional entre banco e ERP.

Na medição curta de 11h20–11h23, Olist 1 avançou apenas dois eventos; Olist 2 e 3 avançaram 13 cada. Nenhuma conta acrescentou linhas de pedidos nessa janela, embora estivessem trabalhando. Portanto, usar apenas o crescimento da tabela de pedidos daria uma estimativa incorreta. Essa janela é pequena e inclui consultas diagnósticas concorrendo por uma pequena parcela da cota; as janelas maiores ajudam a reduzir essa distorção.

## Cálculo

As contagens foram feitas com GETs, reproduzindo os filtros que o worker ainda terá de percorrer. A [documentação Olist](https://api-docs.erp.olist.com/api-reference/pedidos/listar-pedidos) distingue data de criação e data de atualização; não assumi que `dataAtualizacao` represente um dia isolado. Cada consulta diária foi contabilizada separadamente com o total informado pelo próprio ERP.

Para Olist 2 e 3: soma dos totais de atualização do cursor atual até 19/10, menos `page_offset + pending_index` do cursor atual, mais os pedidos por criação dos dias seguintes. Acrescentei o ciclo seguinte de 18–21/10, porque o agendamento atual sobrepõe dois dias após concluir o incremental até 19/10.

Olist 2: **6.676 eventos da fila atual + 1.297 do ciclo seguinte = 7.973**. Olist 3: **10.264 + 1.483 = 11.747**.

Na Olist 1, a tentativa de contagem completa encontrou timeout. A amostragem posterior obteve totais de atualização de 3.200 em 03/10, 2.044 em 12/10, 756 em 19/10 e 148 em 21/10. Interpolei linearmente os dias intermediários, descontei os 1.863 eventos já percorridos na consulta atual e acrescentei as varreduras por criação e o ciclo seguinte. Resultado aproximado: **35.796 + 2.719 = 38.515**. Essa interpolação pode superestimar ou subestimar o trabalho; não é uma contagem completa nem estabelece limites estatísticos.

Prazo matemático: `eventos restantes / eventos por minuto / 60`. A projeção de volume congelado não inclui pedidos e alterações que entrarão depois de 21/10, falhas futuras, novos históricos solicitados ou mudanças no ritmo. As faixas de planejamento de 2–3 e 6–10 dias acrescentam margem operacional a esse cenário; não são intervalos de confiança calculados. Se a lentidão recente da Olist 1 persistir, pode ultrapassar dez dias.

## Ficar atualizado depois do histórico

Concluir a fila atual não significa atualização instantânea dos pedidos novos. `enqueueIncremental` aguarda o incremental anterior terminar; a função SQL de agendamento também impede outro ciclo equivalente dentro de uma hora da conclusão. Além disso, cada ciclo precisa fazer suas consultas e gravar os resultados.

Assim, mesmo depois da recuperação do histórico, o desenho atual pode manter atraso de horas. Para atualizar pedidos recentes em minutos, é necessário rever a prioridade e o agendamento dessa fila; as mudanças anteriores de layout e status não alteraram esse mecanismo. Não foi feita essa alteração nesta consulta de estimativa.

O escopo é o histórico configurado e as filas existentes, com vendas armazenadas desde 23/07. Não foi auditada a existência de períodos anteriores a essa data no ERP, nem feita uma reconciliação de todos os IDs para afirmar igualdade integral entre os sistemas.

## Evidências e repetição

- [Contagens completas das Olist 2 e 3](evidencias/importacao-estimativa-20261021142132/counts.json).
- [Amostragem da Olist 1](evidencias/importacao-estimativa-20261021142412/counts.json).
- [Memória de cálculo](evidencias/importacao-estimativa-20261021142132/estimate.json).
- [Observação atual de três minutos](evidencias/importacao-ritmo-20261021142006/status.json).
- [Snapshot anterior para a janela de aproximadamente 32 minutos](evidencias/importacao-ritmo-20261021135120/status.json).
- [Snapshot de ontem para a janela de aproximadamente 18h36](evidencias/importacao-ritmo-20261020194712/status.json).

Consultas somente em leitura, sem iniciar importações, modificar filas, publicar código ou renovar OAuth. As consultas de contagem consomem cota Olist: são espaçadas em cinco segundos por conta e interrompidas em caso de erro ou saldo baixo.

Comandos: `node scripts/analytics-progress-readonly.cjs --observe=180` e `node scripts/analytics-eta-readonly.cjs`. Para uma amostragem limitada de uma conta: `node scripts/analytics-eta-readonly.cjs --connection=UUID --sample`.
