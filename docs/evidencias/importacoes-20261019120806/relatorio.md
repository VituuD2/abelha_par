# Pedidos importados e pendências — 2026-10-19

Consulta de 2026-10-19T15:08:06.949Z a 2026-10-19T15:08:54.649Z (timestamps UTC; horário operacional São Paulo). Produção somente em leitura.

Período: **2026-08-01 a 2026-10-19**. Todas as situações, inclusive cancelados; não equivale ao total elegível da ABC.

Snapshot de pedidos: **7428**. Contagem global antes/depois: 7428 / 7436. Como o worker está ativo, consultas não compartilham snapshot transacional.

[Lista de pedidos e datas](pedidos-importados.json) · [Dados de cobertura, fonte e jobs](status.json)

## Resumo

| Empresa | Pedidos no snapshot, todas situações | Banco não cancelados | Fonte não cancelados | Saldo não cancelados | Última venda presente |
| --- | ---: | ---: | ---: | ---: | --- |
| Olist 1 | 3335 | 3335 | 8590 | 5255 | 2026-10-08 |
| Olist 2 | 653 | 653 | 3433 | 2780 | 2026-10-08 |
| Olist 3 | 3440 | 3434 | 4233 | 799 | 2026-10-08 |

**Saldo por contagem não é reconciliação ID a ID.** O filtro Olist usa data de criação; a tabela diária usa data comercial persistida. Datas retroativas e bordas de períodos podem divergir. Situações ainda desatualizadas, reprocessamentos, exclusões e vínculos canônicos também afetam o saldo. Hoje é um dia em aberto. Não transformar esse saldo em previsão de horas sem medir o processamento restante.

Cancelamentos: o worker atualiza cancelamento de vendas já conhecidas; quando encontra um pedido cancelado que nunca foi importado, pode não criar uma venda analítica. Portanto, o total bruto de pedidos do ERP não é uma meta de linhas a importar. A conta principal abaixo exclui situação 2 de ambos os lados, mas ainda precisa reconciliar estados atuais. [Contrato de data de criação/situação da API Olist](https://api-docs.erp.olist.com/api-reference/pedidos/listar-pedidos).

## Cobertura de varredura confirmada

### Olist 1
Importados: 2026-08-01 a 2026-08-23; 2026-10-03 a 2026-10-08.
Sem cobertura integral: 2026-08-24 a 2026-10-02; 2026-10-09 a 2026-10-19.

### Olist 2
Importados: 2026-08-01 a 2026-08-03; 2026-10-03 a 2026-10-08.
Sem cobertura integral: 2026-08-04 a 2026-10-02; 2026-10-09 a 2026-10-19.

### Olist 3
Importados: 2026-08-01 a 2026-10-05; 2026-10-07 a 2026-10-08.
Sem cobertura integral: 2026-10-06 a 2026-10-06; 2026-10-09 a 2026-10-19.

A cobertura significa que a varredura passou por todas as páginas do dia. Não comprova reconciliação com a fonte atual. Pedidos podem existir em dias sem cobertura integral.

## Quantidades por janela na fonte

| Empresa | De | Até | Olist total | Cancelados Olist | Não cancelados Olist | Banco não cancelados | Saldo não cancelados |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| Olist 1 | 2026-08-01 | 2026-08-31 | 3352 | 218 | 3134 | 2531 | 603 |
| Olist 1 | 2026-09-01 | 2026-09-30 | 3275 | 255 | 3020 | 73 | 2947 |
| Olist 1 | 2026-10-01 | 2026-10-18 | 2515 | 125 | 2390 | 731 | 1659 |
| Olist 1 | 2026-10-19 | 2026-10-19 | 47 | 1 | 46 | 0 | 46 |
| Olist 2 | 2026-08-01 | 2026-08-31 | 1471 | 91 | 1380 | 237 | 1143 |
| Olist 2 | 2026-09-01 | 2026-09-30 | 1262 | 74 | 1188 | 138 | 1050 |
| Olist 2 | 2026-10-01 | 2026-10-18 | 920 | 73 | 847 | 278 | 569 |
| Olist 2 | 2026-10-19 | 2026-10-19 | 21 | 3 | 18 | 0 | 18 |
| Olist 3 | 2026-08-01 | 2026-08-31 | 1502 | 157 | 1345 | 1345 | 0 |
| Olist 3 | 2026-09-01 | 2026-09-30 | 1880 | 171 | 1709 | 1710 | -1 |
| Olist 3 | 2026-10-01 | 2026-10-18 | 1273 | 107 | 1166 | 379 | 787 |
| Olist 3 | 2026-10-19 | 2026-10-19 | 13 | 0 | 13 | 0 | 13 |

## Pedidos por dia

| Data da venda | Olist 1 | Olist 2 | Olist 3 | Cobertura de varredura |
| --- | ---: | ---: | ---: | --- |
| 2026-08-01 | 83 | 59 | 30 | Olist 1, Olist 2, Olist 3 |
| 2026-08-02 | 100 | 58 | 34 | Olist 1, Olist 2, Olist 3 |
| 2026-08-03 | 123 | 76 | 40 | Olist 1, Olist 2, Olist 3 |
| 2026-08-04 | 115 | 43 | 45 | Olist 1, Olist 3 |
| 2026-08-05 | 127 | 0 | 34 | Olist 1, Olist 3 |
| 2026-08-06 | 117 | 0 | 34 | Olist 1, Olist 3 |
| 2026-08-07 | 100 | 0 | 33 | Olist 1, Olist 3 |
| 2026-08-08 | 108 | 0 | 41 | Olist 1, Olist 3 |
| 2026-08-09 | 108 | 0 | 24 | Olist 1, Olist 3 |
| 2026-08-10 | 98 | 0 | 35 | Olist 1, Olist 3 |
| 2026-08-11 | 117 | 0 | 30 | Olist 1, Olist 3 |
| 2026-08-12 | 118 | 0 | 34 | Olist 1, Olist 3 |
| 2026-08-13 | 99 | 0 | 33 | Olist 1, Olist 3 |
| 2026-08-14 | 112 | 0 | 32 | Olist 1, Olist 3 |
| 2026-08-15 | 80 | 0 | 22 | Olist 1, Olist 3 |
| 2026-08-16 | 99 | 0 | 26 | Olist 1, Olist 3 |
| 2026-08-17 | 122 | 1 | 40 | Olist 1, Olist 3 |
| 2026-08-18 | 125 | 0 | 45 | Olist 1, Olist 3 |
| 2026-08-19 | 135 | 0 | 47 | Olist 1, Olist 3 |
| 2026-08-20 | 113 | 0 | 53 | Olist 1, Olist 3 |
| 2026-08-21 | 84 | 0 | 39 | Olist 1, Olist 3 |
| 2026-08-22 | 95 | 0 | 36 | Olist 1, Olist 3 |
| 2026-08-23 | 90 | 0 | 43 | Olist 1, Olist 3 |
| 2026-08-24 | 63 | 0 | 46 | Olist 3 |
| 2026-08-25 | 0 | 0 | 63 | Olist 3 |
| 2026-08-26 | 0 | 0 | 84 | Olist 3 |
| 2026-08-27 | 0 | 0 | 49 | Olist 3 |
| 2026-08-28 | 0 | 0 | 52 | Olist 3 |
| 2026-08-29 | 0 | 0 | 68 | Olist 3 |
| 2026-08-30 | 0 | 0 | 72 | Olist 3 |
| 2026-08-31 | 0 | 0 | 81 | Olist 3 |
| 2026-09-01 | 0 | 0 | 83 | Olist 3 |
| 2026-09-02 | 1 | 0 | 73 | Olist 3 |
| 2026-09-03 | 0 | 0 | 64 | Olist 3 |
| 2026-09-04 | 0 | 0 | 63 | Olist 3 |
| 2026-09-05 | 0 | 0 | 63 | Olist 3 |
| 2026-09-06 | 0 | 0 | 49 | Olist 3 |
| 2026-09-07 | 0 | 0 | 63 | Olist 3 |
| 2026-09-08 | 0 | 0 | 65 | Olist 3 |
| 2026-09-09 | 1 | 0 | 103 | Olist 3 |
| 2026-09-10 | 0 | 0 | 62 | Olist 3 |
| 2026-09-11 | 0 | 0 | 46 | Olist 3 |
| 2026-09-12 | 1 | 0 | 53 | Olist 3 |
| 2026-09-13 | 0 | 0 | 42 | Olist 3 |
| 2026-09-14 | 1 | 0 | 47 | Olist 3 |
| 2026-09-15 | 2 | 1 | 60 | Olist 3 |
| 2026-09-16 | 3 | 2 | 59 | Olist 3 |
| 2026-09-17 | 8 | 3 | 52 | Olist 3 |
| 2026-09-18 | 11 | 1 | 41 | Olist 3 |
| 2026-09-19 | 17 | 0 | 31 | Olist 3 |
| 2026-09-20 | 20 | 0 | 41 | Olist 3 |
| 2026-09-21 | 8 | 1 | 58 | Olist 3 |
| 2026-09-22 | 0 | 3 | 50 | Olist 3 |
| 2026-09-23 | 0 | 4 | 50 | Olist 3 |
| 2026-09-24 | 0 | 7 | 59 | Olist 3 |
| 2026-09-25 | 0 | 19 | 37 | Olist 3 |
| 2026-09-26 | 0 | 17 | 41 | Olist 3 |
| 2026-09-27 | 0 | 25 | 49 | Olist 3 |
| 2026-09-28 | 0 | 53 | 82 | Olist 3 |
| 2026-09-29 | 0 | 2 | 67 | Olist 3 |
| 2026-09-30 | 0 | 0 | 63 | Olist 3 |
| 2026-10-01 | 137 | 45 | 69 | Olist 3 |
| 2026-10-02 | 0 | 0 | 68 | Olist 3 |
| 2026-10-03 | 96 | 44 | 55 | Olist 1, Olist 2, Olist 3 |
| 2026-10-04 | 89 | 42 | 39 | Olist 1, Olist 2, Olist 3 |
| 2026-10-05 | 124 | 53 | 53 | Olist 1, Olist 2, Olist 3 |
| 2026-10-06 | 151 | 45 | 37 | Olist 1, Olist 2 |
| 2026-10-07 | 80 | 33 | 39 | Olist 1, Olist 2, Olist 3 |
| 2026-10-08 | 54 | 16 | 19 | Olist 1, Olist 2, Olist 3 |
| 2026-10-09 | 0 | 0 | 0 | Nenhuma conta integral |
| 2026-10-10 | 0 | 0 | 0 | Nenhuma conta integral |
| 2026-10-11 | 0 | 0 | 0 | Nenhuma conta integral |
| 2026-10-12 | 0 | 0 | 0 | Nenhuma conta integral |
| 2026-10-13 | 0 | 0 | 0 | Nenhuma conta integral |
| 2026-10-14 | 0 | 0 | 0 | Nenhuma conta integral |
| 2026-10-15 | 0 | 0 | 0 | Nenhuma conta integral |
| 2026-10-16 | 0 | 0 | 0 | Nenhuma conta integral |
| 2026-10-17 | 0 | 0 | 0 | Nenhuma conta integral |
| 2026-10-18 | 0 | 0 | 0 | Nenhuma conta integral |
| 2026-10-19 | 0 | 0 | 0 | Nenhuma conta integral |

## Continuidade automática

Cron observado com requisições por minuto; o código agenda incrementais e retoma checkpoints persistentes. Não foi disparado processamento manual. Queued é continuação normal do lote; running é reserva ativa; retry aguarda next_at; failed exige revisão. Incrementais fazem vendas e depois atualizações por dia. O cursor não representa a data da venda mais recente do banco.

| Empresa | Modo | Estado final | Cursor antes → depois | Eventos processados antes → depois |
| --- | --- | --- | --- | --- |
| Olist 2 | backfill | queued | 2026-08-04 → 2026-08-04 | 251 → 254 |
| Olist 1 | backfill | queued | 2026-08-24 → 2026-08-24 | 2704 → 2706 |
| Olist 3 | backfill | queued | 2026-10-06 → 2026-10-06 | 205 → 208 |
| Olist 3 | incremental | running | 2026-10-01 → 2026-10-01 | 254 → 254 |
| Olist 2 | incremental | running | 2026-10-01 → 2026-10-01 | 202 → 202 |
| Olist 1 | incremental | running | 2026-10-01 → 2026-10-01 | 236 → 236 |

O contador processed inclui reprocessamentos e as duas fases incrementais; não é o número de novas vendas. O agendamento de novas atualizações do mesmo dia tem intervalo mínimo de uma hora após concluir o job. Uma fila longa pode manter a data final atrás de hoje; novos intervalos serão agendados após concluir o incremental ativo. Falhas de autorização, API, cron e quota podem interromper a continuidade.

## Repetir a consulta

`node scripts/analytics-import-status.cjs --from=2026-08-01 --to=2026-10-19`

O comando grava outro snapshot local e consulta somente GETs. Não renova OAuth nem modifica filas. A tabela pública analytics_orders permite conferir pedidos individuais pelo número/ID; analytics_coverage indica varredura; analytics_sync_jobs mostra cursores e pendências. Os schemas cron/net exigem editor SQL autorizado para conferir status HTTP final.
