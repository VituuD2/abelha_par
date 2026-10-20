# Pedidos importados e pendências — 2026-10-20

Consulta de 2026-10-20T17:27:33.625Z a 2026-10-20T17:28:47.055Z (timestamps UTC; horário operacional São Paulo). Produção somente em leitura.

Período: **2026-08-01 a 2026-10-20**. Todas as situações, inclusive cancelados; não equivale ao total elegível da ABC.

Snapshot de pedidos: **14859**. Contagem global antes/depois: 14859 / 14859. Como o worker está ativo, consultas não compartilham snapshot transacional.

[Lista de pedidos e datas](pedidos-importados.json) · [Dados de cobertura, fonte e jobs](status.json)

## Resumo

| Empresa | Pedidos no snapshot, todas situações | Banco não cancelados | Fonte não cancelados | Saldo não cancelados | Última venda presente |
| --- | ---: | ---: | ---: | ---: | --- |
| Olist 1 | 8628 | 8618 | 8719 | 101 | 2026-10-20 |
| Olist 2 | 1923 | 1919 | 3500 | 1581 | 2026-10-20 |
| Olist 3 | 4308 | 4292 | 4307 | 15 | 2026-10-20 |

**Saldo por contagem não é reconciliação ID a ID.** O filtro Olist usa data de criação; a tabela diária usa data comercial persistida. Datas retroativas e bordas de períodos podem divergir. Situações ainda desatualizadas, reprocessamentos, exclusões e vínculos canônicos também afetam o saldo. Hoje é um dia em aberto. Não transformar esse saldo em previsão de horas sem medir o processamento restante.

Cancelamentos: o worker atualiza cancelamento de vendas já conhecidas; quando encontra um pedido cancelado que nunca foi importado, pode não criar uma venda analítica. Portanto, o total bruto de pedidos do ERP não é uma meta de linhas a importar. A conta principal abaixo exclui situação 2 de ambos os lados, mas ainda precisa reconciliar estados atuais. [Contrato de data de criação/situação da API Olist](https://api-docs.erp.olist.com/api-reference/pedidos/listar-pedidos).

## Cobertura de varredura confirmada

### Olist 1
Importados: 2026-08-01 a 2026-09-27; 2026-10-03 a 2026-10-08; 2026-10-20 a 2026-10-20.
Sem cobertura integral: 2026-09-28 a 2026-10-02; 2026-10-09 a 2026-10-19.

### Olist 2
Importados: 2026-08-01 a 2026-08-16; 2026-10-01 a 2026-10-08; 2026-10-20 a 2026-10-20.
Sem cobertura integral: 2026-08-17 a 2026-09-30; 2026-10-09 a 2026-10-19.

### Olist 3
Importados: 2026-08-01 a 2026-10-08; 2026-10-20 a 2026-10-20.
Sem cobertura integral: 2026-10-09 a 2026-10-19.

A cobertura significa que a varredura passou por todas as páginas do dia. Não comprova reconciliação com a fonte atual. Pedidos podem existir em dias sem cobertura integral.

## Quantidades por janela na fonte

| Empresa | De | Até | Olist total | Cancelados Olist | Não cancelados Olist | Banco não cancelados | Saldo não cancelados |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| Olist 1 | 2026-08-01 | 2026-08-15 | 1718 | 113 | 1605 | 1605 | 0 |
| Olist 1 | 2026-08-16 | 2026-08-31 | 1634 | 105 | 1529 | 1529 | 0 |
| Olist 1 | 2026-09-01 | 2026-09-30 | 3275 | 256 | 3019 | 3016 | 3 |
| Olist 1 | 2026-10-01 | 2026-10-19 | 2647 | 131 | 2516 | 2437 | 79 |
| Olist 1 | 2026-10-20 | 2026-10-20 | 51 | 1 | 50 | 31 | 19 |
| Olist 2 | 2026-08-01 | 2026-08-31 | 1471 | 91 | 1380 | 759 | 621 |
| Olist 2 | 2026-09-01 | 2026-09-30 | 1262 | 74 | 1188 | 237 | 951 |
| Olist 2 | 2026-10-01 | 2026-10-19 | 978 | 80 | 898 | 898 | 0 |
| Olist 2 | 2026-10-20 | 2026-10-20 | 35 | 1 | 34 | 25 | 9 |
| Olist 3 | 2026-08-01 | 2026-08-31 | 1502 | 157 | 1345 | 1345 | 0 |
| Olist 3 | 2026-09-01 | 2026-09-30 | 1880 | 171 | 1709 | 1709 | 0 |
| Olist 3 | 2026-10-01 | 2026-10-19 | 1339 | 117 | 1222 | 1223 | -1 |
| Olist 3 | 2026-10-20 | 2026-10-20 | 31 | 0 | 31 | 15 | 16 |

## Pedidos por dia

| Data da venda | Olist 1 | Olist 2 | Olist 3 | Cobertura de varredura |
| --- | ---: | ---: | ---: | --- |
| 2026-08-01 | 83 | 59 | 30 | Olist 1, Olist 2, Olist 3 |
| 2026-08-02 | 100 | 58 | 34 | Olist 1, Olist 2, Olist 3 |
| 2026-08-03 | 123 | 76 | 40 | Olist 1, Olist 2, Olist 3 |
| 2026-08-04 | 115 | 51 | 45 | Olist 1, Olist 2, Olist 3 |
| 2026-08-05 | 127 | 42 | 34 | Olist 1, Olist 2, Olist 3 |
| 2026-08-06 | 117 | 50 | 34 | Olist 1, Olist 2, Olist 3 |
| 2026-08-07 | 100 | 36 | 33 | Olist 1, Olist 2, Olist 3 |
| 2026-08-08 | 108 | 37 | 41 | Olist 1, Olist 2, Olist 3 |
| 2026-08-09 | 108 | 41 | 24 | Olist 1, Olist 2, Olist 3 |
| 2026-08-10 | 98 | 46 | 35 | Olist 1, Olist 2, Olist 3 |
| 2026-08-11 | 117 | 34 | 30 | Olist 1, Olist 2, Olist 3 |
| 2026-08-12 | 118 | 38 | 34 | Olist 1, Olist 2, Olist 3 |
| 2026-08-13 | 99 | 22 | 33 | Olist 1, Olist 2, Olist 3 |
| 2026-08-14 | 112 | 31 | 32 | Olist 1, Olist 2, Olist 3 |
| 2026-08-15 | 80 | 30 | 22 | Olist 1, Olist 2, Olist 3 |
| 2026-08-16 | 99 | 52 | 26 | Olist 1, Olist 2, Olist 3 |
| 2026-08-17 | 122 | 57 | 40 | Olist 1, Olist 3 |
| 2026-08-18 | 125 | 0 | 45 | Olist 1, Olist 3 |
| 2026-08-19 | 135 | 0 | 47 | Olist 1, Olist 3 |
| 2026-08-20 | 113 | 0 | 53 | Olist 1, Olist 3 |
| 2026-08-21 | 84 | 0 | 39 | Olist 1, Olist 3 |
| 2026-08-22 | 95 | 0 | 36 | Olist 1, Olist 3 |
| 2026-08-23 | 90 | 0 | 43 | Olist 1, Olist 3 |
| 2026-08-24 | 85 | 0 | 46 | Olist 1, Olist 3 |
| 2026-08-25 | 74 | 0 | 63 | Olist 1, Olist 3 |
| 2026-08-26 | 94 | 0 | 84 | Olist 1, Olist 3 |
| 2026-08-27 | 78 | 0 | 49 | Olist 1, Olist 3 |
| 2026-08-28 | 89 | 0 | 52 | Olist 1, Olist 3 |
| 2026-08-29 | 62 | 0 | 68 | Olist 1, Olist 3 |
| 2026-08-30 | 87 | 0 | 72 | Olist 1, Olist 3 |
| 2026-08-31 | 97 | 0 | 81 | Olist 1, Olist 3 |
| 2026-09-01 | 122 | 0 | 83 | Olist 1, Olist 3 |
| 2026-09-02 | 111 | 0 | 73 | Olist 1, Olist 3 |
| 2026-09-03 | 116 | 0 | 64 | Olist 1, Olist 3 |
| 2026-09-04 | 103 | 0 | 63 | Olist 1, Olist 3 |
| 2026-09-05 | 89 | 0 | 63 | Olist 1, Olist 3 |
| 2026-09-06 | 66 | 0 | 49 | Olist 1, Olist 3 |
| 2026-09-07 | 93 | 0 | 63 | Olist 1, Olist 3 |
| 2026-09-08 | 108 | 0 | 65 | Olist 1, Olist 3 |
| 2026-09-09 | 180 | 0 | 103 | Olist 1, Olist 3 |
| 2026-09-10 | 109 | 0 | 62 | Olist 1, Olist 3 |
| 2026-09-11 | 72 | 0 | 46 | Olist 1, Olist 3 |
| 2026-09-12 | 89 | 0 | 53 | Olist 1, Olist 3 |
| 2026-09-13 | 81 | 0 | 42 | Olist 1, Olist 3 |
| 2026-09-14 | 106 | 0 | 47 | Olist 1, Olist 3 |
| 2026-09-15 | 119 | 1 | 60 | Olist 1, Olist 3 |
| 2026-09-16 | 111 | 2 | 59 | Olist 1, Olist 3 |
| 2026-09-17 | 107 | 3 | 52 | Olist 1, Olist 3 |
| 2026-09-18 | 85 | 1 | 41 | Olist 1, Olist 3 |
| 2026-09-19 | 91 | 0 | 31 | Olist 1, Olist 3 |
| 2026-09-20 | 110 | 0 | 41 | Olist 1, Olist 3 |
| 2026-09-21 | 96 | 1 | 58 | Olist 1, Olist 3 |
| 2026-09-22 | 100 | 3 | 50 | Olist 1, Olist 3 |
| 2026-09-23 | 76 | 4 | 50 | Olist 1, Olist 3 |
| 2026-09-24 | 91 | 7 | 59 | Olist 1, Olist 3 |
| 2026-09-25 | 88 | 19 | 37 | Olist 1, Olist 3 |
| 2026-09-26 | 68 | 17 | 41 | Olist 1, Olist 3 |
| 2026-09-27 | 97 | 25 | 49 | Olist 1, Olist 3 |
| 2026-09-28 | 118 | 53 | 82 | Olist 3 |
| 2026-09-29 | 97 | 46 | 67 | Olist 3 |
| 2026-09-30 | 117 | 55 | 63 | Olist 3 |
| 2026-10-01 | 137 | 45 | 69 | Olist 2, Olist 3 |
| 2026-10-02 | 110 | 49 | 68 | Olist 2, Olist 3 |
| 2026-10-03 | 96 | 44 | 55 | Olist 1, Olist 2, Olist 3 |
| 2026-10-04 | 89 | 42 | 39 | Olist 1, Olist 2, Olist 3 |
| 2026-10-05 | 124 | 53 | 53 | Olist 1, Olist 2, Olist 3 |
| 2026-10-06 | 151 | 45 | 72 | Olist 1, Olist 2, Olist 3 |
| 2026-10-07 | 171 | 67 | 80 | Olist 1, Olist 2, Olist 3 |
| 2026-10-08 | 143 | 46 | 50 | Olist 1, Olist 2, Olist 3 |
| 2026-10-09 | 101 | 35 | 66 | Nenhuma conta integral |
| 2026-10-10 | 140 | 47 | 97 | Nenhuma conta integral |
| 2026-10-11 | 134 | 55 | 54 | Nenhuma conta integral |
| 2026-10-12 | 165 | 45 | 65 | Nenhuma conta integral |
| 2026-10-13 | 158 | 50 | 63 | Nenhuma conta integral |
| 2026-10-14 | 153 | 52 | 80 | Nenhuma conta integral |
| 2026-10-15 | 150 | 49 | 58 | Nenhuma conta integral |
| 2026-10-16 | 146 | 36 | 71 | Nenhuma conta integral |
| 2026-10-17 | 102 | 44 | 56 | Nenhuma conta integral |
| 2026-10-18 | 127 | 43 | 73 | Nenhuma conta integral |
| 2026-10-19 | 50 | 54 | 63 | Nenhuma conta integral |
| 2026-10-20 | 31 | 25 | 15 | Olist 1, Olist 2, Olist 3 |

## Continuidade automática

Cron observado com requisições por minuto; o código agenda incrementais e retoma checkpoints persistentes. Não foi disparado processamento manual. Queued é continuação normal do lote; running é reserva ativa; retry aguarda next_at; failed exige revisão. Incrementais fazem vendas e depois atualizações por dia. O cursor não representa a data da venda mais recente do banco.

| Empresa | Modo | Estado final | Cursor antes → depois | Eventos processados antes → depois |
| --- | --- | --- | --- | --- |
| Olist 3 | incremental | queued | 2026-10-05 → 2026-10-05 | 7457 → 7462 |
| Olist 2 | backfill | queued | 2026-08-17 → 2026-08-17 | 808 → 808 |
| Olist 1 | incremental | retry | 2026-10-01 → 2026-10-01 | 3343 → 3343 |
| Olist 1 | backfill | queued | 2026-09-28 → 2026-09-28 | 6377 → 6382 |
| Olist 2 | incremental | queued | 2026-10-06 → 2026-10-06 | 6579 → 6583 |

O contador processed inclui reprocessamentos e as duas fases incrementais; não é o número de novas vendas. O agendamento de novas atualizações do mesmo dia tem intervalo mínimo de uma hora após concluir o job. Uma fila longa pode manter a data final atrás de hoje; novos intervalos serão agendados após concluir o incremental ativo. Falhas de autorização, API, cron e quota podem interromper a continuidade.

## Repetir a consulta

`node scripts/analytics-import-status.cjs --from=2026-08-01 --to=2026-10-20`

O comando grava outro snapshot local e consulta somente GETs. Não renova OAuth nem modifica filas. A tabela pública analytics_orders permite conferir pedidos individuais pelo número/ID; analytics_coverage indica varredura; analytics_sync_jobs mostra cursores e pendências. Os schemas cron/net exigem editor SQL autorizado para conferir status HTTP final.
