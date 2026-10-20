# CMV histórico: pesquisa, decisão e implementação

Esta revisão substitui a política de custo atual da entrega v18. A Curva ABC usa **custo histórico da Olist 1, vigente no dia de cada operação**. Após validar os dados reais da operação, o padrão da aplicação é **custo de compra histórico**, com alternativa explícita de custo médio histórico. A data de sincronização não é a data de vigência. Consulte o [diagnóstico dos custos médios zerados](olist-cmv-bases-2026-10-20.md).

## O que as plataformas documentam

| Plataforma | Comportamento documentado | Consequência para este projeto |
| --- | --- | --- |
| Olist ERP | O CMV de pedidos usa o custo que o item possuía na data da venda. Para NF, o DRE usa a data de autorização. Permite escolher custo de compra ou médio. | Consultar o histórico, escolher a base de custo e respeitar a data da operação. |
| Microsoft Dynamics 365 | Oferece custo médio móvel, FIFO e métodos periódicos. O custo médio móvel não substitui o custo de saídas anteriores quando muda uma compra posterior. | Não existe um único método universal; custo médio por vigência é adequado ao estoque misturado sem rastreamento de lotes. |
| Odoo | O AVCO recalcula o custo médio ponderado nas entradas; saídas usam esse custo sem refazer a média. | Quantidades de estoque e custos de aquisição determinam a média, não a quantidade de alterações de preço. |
| Shopify | Relatórios de lucro dependem do custo registrado no momento da venda; o campo estático tem limitações para relatórios dinâmicos. | Um campo de custo atual não substitui uma série histórica para analisar meses anteriores. |

Fontes primárias: [Olist — CMV no DRE](https://ajuda.olist.com/relatorios-de-financas/como-funciona-o-relatorio-dre), [Dynamics — média móvel](https://learn.microsoft.com/en-us/dynamics365/supply-chain/cost-management/moving-average), [Dynamics — custeio e fechamento](https://learn.microsoft.com/en-us/dynamics365/supply-chain/cost-management/inventory-costing-faq), [Odoo — AVCO](https://www.odoo.com/documentation/19.0/es/applications/finance/accounting/get_started/avg_price_valuation.html), [Shopify — relatórios de lucro](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/profit-reports).

## Método escolhido e exemplo

Quando a operação mantém o custo médio, a recomendação é importar o **custo médio já calculado pelo ERP**, preservando a data de cada mudança. Isso evita tentar reconstruir estoques e custos a partir de informações incompletas. Nesta operação, a inspeção de produção encontrou custos médios vigentes zerados para 13 componentes vendidos, com custos de compra históricos positivos. Por isso a aplicação inicia em custo de compra por vigência; custo médio continua sendo uma escolha explícita para quando seus dados estiverem disponíveis. A Olist documenta que a formação de preços pondera o saldo anterior e as entradas, considerando despesas da compra e os impostos configurados. Não subtraímos os impostos recuperáveis novamente do valor retornado. [Olist — formação de preços](https://ajuda.olist.com/pt_BR/precificacao/formacao-de-precos).

```text
novo custo médio = (saldo anterior × custo médio anterior
                   + quantidade recebida × custo de aquisição) / saldo final

custo das vendas do período = Σ(quantidade vendida × custo vigente na operação)
```

Exemplo: estoque inicial de 150 unidades a R$ 10. Uma venda de 50 deixa 100 em estoque. A entrada de outras 100 a R$ 14 resulta em custo médio de R$ 12. Depois são vendidas mais 50. O custo das duas vendas é **50 × R$ 10 + 50 × R$ 12 = R$ 1.100**. Aplicar o custo novo às 100 unidades vendidas daria R$ 1.200; tirar uma média simples dos preços também não é uma regra geral válida.

Para combos, primeiro encontra-se o custo de cada componente na data da venda. Após a solicitação do responsável em 20/10, a v21 aceita custos informados zero ou negativos: usa `quantidade do componente × magnitude do custo unitário vigente` como peso do rateio. Se todos os custos forem zero, usa a quantidade de componentes. Os pesos dividem a receita da linha, conservando todos os centavos e o sinal original da venda. O total de custo de referência soma as unidades vendidas pelos seus custos históricos **com sinal**, antes de qualquer comparação entre períodos. A base escolhida é usada para todos os componentes: não substituímos custo médio ausente por custo de compra ou pelo custo atual. Veja [a correção v21](cmv-zero-negativo-v21-2026-10-20.md).

FIFO/PEPS pode ser adequado quando a operação controla lotes e saídas de estoque. Não é possível reconstruí-lo corretamente apenas com uma lista de alterações de custo. Esta aplicação não inventa lotes nem muda a configuração de avaliação de estoque do ERP.

## Origem e sincronização

O endpoint oficial é [`GET /produtos/{idProduto}/custos`](https://api-docs.erp.olist.com/api-reference/produtos/listar-custos-do-produto). Retorna `data`, `precoCusto`, `custoMedio`, saldos e impostos, com paginação. São importados os históricos completos, incluindo o registro anterior ao início do filtro: um custo de agosto pode continuar vigente em setembro. Não é usada `dataAlteracao` do cadastro como se fosse a data de mudança do CMV.

O catálogo continua sendo consultado em páginas de 100 produtos, com novo ciclo após 30 minutos. Apenas SKUs base revisados recebem enriquecimento de histórico; não se consulta o detalhe histórico de todo o catálogo. O worker reserva uma conta e até três páginas de histórico por execução, com pacing, limite de tempo e a mesma reserva distribuída das vendas. A carga inicial é retomável e pode exigir várias execuções.

Mudanças de data de atualização/custos no catálogo antecipam a revisão dos históricos. Uma revisão completa a cada 24 horas recupera alterações retroativas que não mudem o preço atual. O botão no Ninho permite antecipar essa revisão. Filtros, detalhes e exportações leem somente o banco; não acionam a Olist.

As páginas são armazenadas em staging. O histórico publicado de um produto só muda depois de chegar à última página. Retentativas não duplicam eventos; versões corrigidas são retiradas da série vigente e preservadas para auditoria. O banco guarda tanto `effective_at`/`effective_day` do ERP quanto `observed_at` da importação.

## Regras temporais e limites

- Para cada SKU e dia de operação, é escolhido o último evento de custo anterior ou igual ao dia. Um custo futuro nunca preenche uma lacuna anterior.
- A base padrão da aplicação é `precoCusto`; o filtro **Base do CMV histórico** permite selecionar `custoMedio`. A aplicação envia a escolha explicitamente às RPCs v19; o padrão SQL legado dessas funções não muda nesta correção.
- O histórico pode conter horários, que são preservados. Os pedidos analíticos atuais armazenam a data comercial, sem horário; por isso a apuração usa o **último custo do dia**, em `America/Sao_Paulo`. Não representa ordenação intradiária. A tela e a exportação informam essa granularidade.
- A visão Pedidos usa a data da venda. A visão atual de NF da aplicação usa a data de emissão já armazenada, enquanto o DRE oficial da Olist usa autorização. Essa diferença deve ser considerada ao conciliar; esta mudança não transforma a Curva ABC em DRE fiscal.
- Um histórico ausente, custo não numérico ou conflito no mesmo instante fica pendente. Não é convertido em custo zero, nem preenchido por um registro posterior. A v21 aceita valores zero e negativos informados pelo ERP, preservando o sinal no total do CMV. Quantidades continuam disponíveis; o total de custo indica a parcela conhecida e os itens faltantes.
- A Olist permite lançar correções em datas passadas. A revisão dessas informações pode corrigir o período correspondente e deixa versões auditáveis. Não há fechamento contábil de períodos nesta aplicação. Não se deve declarar um mês contabilmente fechado apenas por ter exportado a Curva ABC.
- Usar a Olist 1 como referência das três empresas atende à política gerencial solicitada. Custos reais de compra de outros CNPJs podem ser diferentes. Fretes de venda, taxas, descontos globais, devoluções e impostos adicionais não são automaticamente lucro líquido deste relatório.

## Implantação e testes

1. Aplicar v18 e depois [migration_v19_analytics_cost_effective_dates.sql](../supabase/migration_v19_analytics_cost_effective_dates.sql), antes de publicar o código que chama as RPCs v19. A v19 é reaplicável e mantém as RPCs anteriores.
2. Conferir na Olist 1 o histórico na aba Custos e a disponibilidade do recurso DRE/histórico para a conta, além da autorização de leitura de Produtos/custos. [Olist — histórico de custos](https://ajuda.olist.com/produtos/consulta-e-precos).
3. Manter o cron analítico existente. Acompanhar no Ninho os históricos consultados, as pendências e os erros. Ao corrigir custos/permissões, programar uma atualização.
4. Consultar setembro e comparar uma venda antes e outra depois de uma mudança conhecida. O detalhe mostra a faixa de custo quando houve mudanças; não exibe o maior custo do período como se fosse uma referência fixa.

Os testes isolados cobrem abertura anterior ao filtro, fronteira de vigência, custo futuro sem efeito sobre setembro, bases média/compra, diferença entre data da venda e emissão, soma de custos históricos, conservação dos centavos, correções retroativas auditáveis, publicação atômica de várias páginas, dados faltantes, conflitos, retentativas, filas e controle de acesso. Não alteram nem validam dados de produção.

Build de produção e typecheck passaram. Os 11 testes específicos de vigência e importação de históricos passaram, assim como o teste de interface que alterna custo médio/compra e mostra o total histórico. A suíte completa permaneceu com apenas as duas falhas anteriores de interface já reproduzidas na versão original: apresentação do progresso de importação e do aviso de escopo parcial. O lint da build não teve erros; manteve os quatro avisos anteriores no dashboard.
