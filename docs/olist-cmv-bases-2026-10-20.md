# Curva ABC: custos médios zerados na Olist 1

Este documento registra o diagnóstico e a primeira correção. **Decisão posterior do responsável:** aceitar custos informados zero ou negativos, inclusive manter a Fita Seios em zero. A [migração v21](cmv-zero-negativo-v21-2026-10-20.md) substitui o bloqueio por custo zero descrito abaixo. Ausência de histórico continua distinta de zero informado.

O POST de 20/10/2026 às 13:02:23 (São Paulo) foi bloqueado porque a aplicação selecionava custo médio por padrão. Os 13 SKUs da mensagem possuem **custo médio vigente zero**, mas custo de compra histórico positivo anterior ao período. A mensagem anterior atribuía o caso a histórico pendente/permissões sem verificar essa causa.

## Verificação em produção, somente leitura

- Histórico: 119 produtos concluídos, zero pendentes, sem erro registrado.
- Os 13 produtos possuem eventos publicados no cache e tarefas concluídas. Não há lacuna de sincronização desses históricos.
- Três consultas diretas ao histórico da Olist 1, após conferir a identidade da conta, confirmaram os dados do cache. Nenhum token foi renovado e nenhuma fila, pedido ou configuração foi alterada.

| SKU | Vigência retornada pelo ERP | Custo de compra (R$) | Custo médio (R$) |
| --- | --- | ---: | ---: |
| ACTM001-K002 | 2000-01-01 | 3,60 | 0,00 |
| SBLL001-K001 | 2026-05-28 | 17,04 | 0,00 |
| DDCO00A-K001 | 2026-03-31 | 20,40 | 0,00 |

A data 2000-01-01 foi fornecida pela Olist no histórico de abertura; não foi criada a partir da data da sincronização.

Na RPC de relatório, repetindo 21/09 a 20/10/2026, base pedidos, situações 1/5/6, sem outros recortes, a base `average` reproduziu exatamente a lista dos 13 SKUs. Com `purchase`, a mesma consulta retornou 84 entidades, receita de R$ 539.671,49, `missingCostSkus: []`, `unallocatedLines: 0`. As consultas aconteceram enquanto a importação de vendas seguia ativa; esse total descreve o instante da evidência.

O sucesso do rateio **não significa CMV total completo**: essa resposta também apontou `costMissingLines: 50`, `periodCostCents: null` e dois SKUs com composição pendente. A interface continua mostrando o custo conhecido e as lacunas. Não atribuímos custo zero, atual ou futuro a essas linhas.

## Correção

- Padrão centralizado em `ABC_DEFAULTS.costBasis = purchase`, usado nos filtros da API, na seleção inicial da tela e na exportação. A escolha explícita `average` permanece disponível e não mistura bases por produto.
- Mantida a consulta ao evento vigente na data da operação, com cache local. Nenhuma chamada à Olist é adicionada ao fluxo do relatório.
- Ausência de custo para rateio passa a responder HTTP 422 com `code: HISTORICAL_COST_UNAVAILABLE`, `costBasis` e `missingCostSkus`. A mensagem identifica a base, contempla custo zerado e oferece a alternativa de compra quando a escolha é média, sem afirmar falha de permissão/sincronização.
- Respostas de erro usam `Cache-Control: no-store`.

Não requer nova migração. As migrações v18/v19 existentes permanecem necessárias. A correção do padrão depende da publicação do aplicativo; **na versão atual já é possível selecionar “Custo de compra por vigência” e clicar em “Analisar vendas”**.

## Evidências e reprodução

- [Cache e respostas de três produtos da Olist](evidencias/olist-cmv-20261020160538/diagnostico.json), 13:05 de São Paulo.
- [Comparação das duas bases no relatório](evidencias/olist-cmv-20261020160641/diagnostico.json), 13:06 de São Paulo.
- `node scripts/diagnose-olist-costs.cjs`: lê o cache e o estado da fila, sem dados de clientes ou credenciais na saída.
- `--provider`: consulta somente os três produtos acima, com intervalo mínimo de três segundos e sem renovar tokens.
- `--report`: executa somente a RPC de leitura do relatório nas duas bases, no período documentado. Usa POST por causa do tamanho do catálogo nos parâmetros, sem agendar sincronização.

Teste de regressão usa o histórico real de SBLL001-K001, verifica a mudança de 16,00 para 17,04 na data correta, impede um custo futuro de alterar setembro, conserva a receita e mantém o bloqueio da base média zerada.

Validação local: 32 testes de API, importação, vigência e interface passaram; `npm run typecheck` passou. ESLint dos arquivos alterados não encontrou erros e manteve os quatro avisos anteriores de variáveis não utilizadas no dashboard.
