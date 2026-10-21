# Importação por mês e semana — confiabilidade da Curva ABC

Conferência direta nas três contas da Olist em **21/10/2026, das 14h34 às 14h41 de São Paulo**. Foram percorridos 19.686 pedidos, incluindo cancelados, e comparados os IDs com a base analítica. Destes, 18.236 estavam não cancelados: **18.228 presentes e 8 ausentes**. Todos os ausentes encontrados foram criados hoje.

**Julho, agosto e setembro estão completos quanto à presença no histórico configurado. Outubro está em 99,84%, mas ainda tem situações desatualizadas que afetam os filtros. Presença de pedidos e exatidão financeira são verificações diferentes.**

## Percentual de pedidos presentes

Quatro faixas por mês: 1–7, 8–14, 15–21 e 22–fim. A quarta faixa inclui os dias 29, 30 e 31; não são semanas ISO. O histórico começa em 23/07 e o mês atual foi conferido somente até 21/10.

| Mês de 2026 | 1–7 | 8–14 | 15–21 | 22–fim | Total do período conferido |
| --- | ---: | ---: | ---: | ---: | ---: |
| Julho, somente 23–31 | Fora do escopo | Fora do escopo | Fora do escopo | 100% | **100% · 1.452/1.452** |
| Agosto | 100% | 100% | 100% | 100% | **100% · 5.859/5.859** |
| Setembro | 100% | 100% | 100% | 100% | **100% · 5.916/5.916** |
| Outubro, até 21/10 | 100% | 100% | **99,49%** | Futuro | **99,84% · 5.001/5.009** |

Na quarta faixa de julho, a leitura começa em 23/07, não em 22/07. Dias futuros e períodos não consultados não recebem 0% nem 100%.

Fórmula: `pedidos não cancelados presentes, identificados por conta + ID Olist / pedidos não cancelados na Olist × 100`. O total mensal usa a soma dos pedidos, sem fazer média simples das porcentagens semanais. Cancelados nunca importados não contam como vendas faltantes; cancelados ainda ativos localmente são uma pendência de atualização.

| Faixa conferida | Olist 1: presentes/esperados | Olist 2: presentes/esperados | Olist 3: presentes/esperados | Consolidado |
| --- | ---: | ---: | ---: | ---: |
| 23–31/07 | 693/693 | 555/555 | 204/204 | 1.452/1.452 · 100% |
| 01–07/08 | 765/765 | 371/371 | 250/250 | 1.386/1.386 · 100% |
| 08–14/08 | 760/760 | 249/249 | 229/229 | 1.238/1.238 · 100% |
| 15–21/08 | 758/758 | 324/324 | 272/272 | 1.354/1.354 · 100% |
| 22–31/08 | 851/851 | 436/436 | 594/594 | 1.881/1.881 · 100% |
| 01–07/09 | 700/700 | 299/299 | 458/458 | 1.457/1.457 · 100% |
| 08–14/09 | 745/745 | 242/242 | 417/417 | 1.404/1.404 · 100% |
| 15–21/09 | 719/719 | 265/265 | 339/339 | 1.323/1.323 · 100% |
| 22–30/09 | 855/855 | 382/382 | 495/495 | 1.732/1.732 · 100% |
| 01–07/10 | 864/864 | 343/343 | 429/429 | 1.636/1.636 · 100% |
| 08–14/10 | 991/991 | 329/329 | 471/471 | 1.791/1.791 · 100% |
| 15–21/10 | 826/832 · 99,28% | 337/339 · 99,41% | 411/411 · 100% | 1.574/1.582 · 99,49% |

## O que muda o resultado dos filtros

Foi comparada a situação de todos os IDs presentes, incluindo os cancelados que ainda existem localmente. Para medir a inclusão no filtro padrão, foram consideradas as situações **1/5/6: faturado, enviado e entregue**.

| Período | Ausentes | Situações diferentes nos presentes | Cancelados ainda ativos localmente | Pedidos com inclusão divergente no filtro padrão, incluindo ausentes |
| --- | ---: | ---: | ---: | ---: |
| 23–31/07 | 0 | 0 | 0 | 0 |
| Agosto | 0 | 0 | 0 | 0 |
| Setembro | 0 | 1 | 0 | 0 |
| Outubro, até 21/10 | 8 | 139 | 6 | **54** |

A divergência de setembro é um pedido da Olist 1 que está entregue na origem e enviado localmente. As duas situações entram no filtro padrão, portanto essa mudança de situação não altera o valor agregado desse filtro. Uma seleção apenas de enviados ou apenas de entregues pode mudar.

Em outubro, os 54 casos se dividem em **6 pedidos ausentes que deveriam entrar**, **25 presentes que deveriam entrar e estão excluídos pela situação local**, e **23 presentes que deveriam sair e continuam incluídos**. Os outros 2 ausentes são pedidos abertos da Olist 2, que não entram no filtro padrão.

| Faixa de outubro | Ausentes | Situações diferentes | Inclusões divergentes no filtro padrão |
| --- | ---: | ---: | ---: |
| 01–07 | 0 | 12 | 7 |
| 08–14 | 0 | 23 | 2 |
| 15–21 | 8 | 104 | 45 |

Os itens armazenados associados aos 25 pedidos que deveriam entrar somavam R$ 2.297,96; os dos 23 que deveriam sair, R$ 1.322,99. Esses valores ajudam a dimensionar o efeito das situações. Não são um fechamento corrigido: os seis ausentes ainda precisam de detalhe, itens podem ter mudado e o sincronizador continuou trabalhando durante a leitura. Não se deve aplicar esse saldo diretamente ao total atual da tela.

## Valores, itens e CMV

Nos **18.181 pedidos não cancelados presentes com total disponível na listagem**, o total do pedido coincidiu com o armazenado. Outros 47 presentes tinham total ausente ou não interpretável na listagem; todos estavam zerados localmente, mas isso sozinho não confirma o zero na origem. Esses casos não foram tratados como divergência monetária comprovada nem como confirmação financeira.

Também foram consultados os detalhes de **72 pedidos**, dois por conta e faixa, escolhidos por ordenação determinística de hash dos IDs elegíveis presentes. Em todos coincidiram produtos por ID e posição, quantidade, preço, valor bruto dos itens e data comercial. Nas 72 amostras, o total da listagem também coincidiu com o total do detalhe. A amostra é uma conferência estratificada de diagnóstico; não é certificação de todos os itens, nem uma estimativa estatística da taxa de erros.

Uma segunda consulta, às **14h41**, executou as mesmas funções de cálculo da Curva ABC no banco, por data da venda, três contas e situações 1/5/6:

| Período | Pedidos no relatório atual | Valor bruto dos itens armazenados | Itens sem custo histórico válido | Valor sem rateio nos produtos base |
| --- | ---: | ---: | ---: | ---: |
| 23–31/07 | 1.424 | R$ 193.776,75 | 43 | R$ 0,00 |
| Agosto | 5.799 | R$ 533.060,91 | 70 | R$ 0,00 |
| Setembro | 5.908 | R$ 517.475,71 | 67 | R$ 0,00 |
| Outubro, até 21/10 | 4.700 | R$ 434.395,63 | 26 | R$ 0,00 |

Esses são valores calculados sobre a base atual, não totais integralmente reconciliados com os itens do ERP. O sincronizador avançou entre a conferência dos IDs e esta consulta; por isso os números não formam uma fotografia transacional simultânea.

O valor bruto original e a soma atribuída aos produtos base coincidiram em todos os meses; não houve valor aguardando rateio no recorte padrão. **O CMV total, porém, estava incompleto em todos os meses**, pois há linhas sem custo histórico. Custo ausente não foi interpretado como zero. Em setembro também havia um SKU com composição pendente, preservado separadamente no ranking. Esses indicadores dependem dos filtros: uma seleção de produtos pode remover ou concentrar as pendências.

O total do pedido pode incluir descontos e outros componentes. A Curva ABC apresenta o **valor bruto dos itens**; comparar esse número diretamente com o total geral dos pedidos da Olist não comprova divergência na importação.

## Como usar a métrica na prática

- **Julho dentro de 23–31 e agosto:** presença completa e nenhuma diferença de situação identificada. Os dados passaram pela conferência dos totais disponíveis e das amostras; são períodos mais estáveis para análise, sem uma certificação financeira integral.
- **Setembro:** presença completa; no filtro padrão, a única situação divergente mantém o pedido incluído. Atenção ao selecionar uma situação isolada e ao SKU com composição pendente.
- **Outubro:** tratar os valores como provisórios enquanto as divergências de inclusão persistirem, inclusive nas semanas com 100% dos pedidos presentes.
- **CMV:** considerar o custo total incompleto enquanto o filtro selecionado contiver itens sem histórico válido.

Para afirmar que um filtro específico retorna o valor exato, a reconciliação precisa usar as mesmas contas, data comercial ou emissão de NF, situações, produtos, integrações e critério monetário, além de conferir os itens relevantes na origem. A porcentagem desta tabela mede presença, não uma porcentagem do faturamento correto.

A listagem da Olist filtra `dataInicial`/`dataFinal` por **criação**; a aplicação usa `raw.data` para a data comercial, com criação como alternativa, e emissão da nota na base faturada. Nesta leitura, todos os IDs presentes tiveram data comercial igual à criação. Isso ajuda a interpretar a tabela para a base de vendas, mas não comprova a abrangência de um filtro por emissão de NF, que pode incluir pedidos criados fora do período. [Contrato oficial da Olist](https://api-docs.erp.olist.com/api-reference/pedidos/listar-pedidos).

## Repetição e evidências

Executar a auditoria sem alterar pedidos ou filas:

```powershell
node scripts/analytics-period-quality-readonly.cjs
# Opcional: --from=2026-09-01 --to=2026-09-30 --samples=2

node scripts/analytics-period-filter-check-readonly.cjs docs/evidencias/importacao-qualidade-periodos-20261021173423
```

O primeiro comando imprime o diretório novo; usar esse diretório no segundo. Os GETs respeitam o controlador compartilhado da Olist e registram reservas/telemetria. Foram 293 tentativas de chamada, incluindo validação de identidade e um retry transitório na Olist 3. Houve duas mensagens de falha ao finalizar telemetria no banco; as leituras correspondentes não foram repetidas por esse motivo. Todas as 36 faixas por conta terminaram com paginação completa e sem erro pendente. Nenhum token foi renovado, pedido importado, checkpoint modificado, SQL aplicado ou deploy realizado por esta auditoria.

- [Conferência por ID, mês e faixa, com amostras](evidencias/importacao-qualidade-periodos-20261021173423/quality.json).
- [Cálculos atuais da ABC, CMV e efeito das situações](evidencias/importacao-qualidade-periodos-20261021173423/filter-check.json).
- [Script de reconciliação](../scripts/analytics-period-quality-readonly.cjs).
- [Script de verificação dos filtros](../scripts/analytics-period-filter-check-readonly.cjs).

Validação: seis testes da métrica aprovados, incluindo meses parciais, dias 29–31, pesos mensais, arredondamento que não mascara faltas, situações divergentes e valores decimais. Sintaxe dos dois scripts conferida e consultas executadas com sucesso.
