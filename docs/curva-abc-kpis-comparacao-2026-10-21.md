# KPIs integrados e comparação temporal da Curva ABC

## Interface e escopo

Os quatro indicadores agora compartilham um painel com quatro colunas no desktop (1280 px), duas no tablet (640 px) e uma no celular. Cada indicador tem ícone em uma superfície suave: barras laranja, pacote verde, carrinho azul e rosca violeta. Os títulos e valores continuam usando os dados do relatório e seus formatadores originais. Os valores podem quebrar linha em vez de serem truncados.

As classes compartilham um segundo painel com letras A/B/C em quadrados suaves, separadores, valor, quantidade de entidades, participação e unidades. A barra representa proporcionalmente as participações da métrica aplicada, recebidas do servidor. Classes ausentes aparecem com zero. A barra permanece vazia quando não há participação e não tenta representar participações negativas ou inválidas como segmentos positivos.

Nenhuma fonte ou estilo global foi modificado. Gráfico, filtros, classificação, consolidação, importações, sincronização e avisos de cobertura existentes permanecem intactos.

## Comparação real

- O período anterior termina no dia anterior ao início selecionado e tem o mesmo número inclusivo de dias. O cálculo usa dias UTC para não depender de horário de verão. Exemplo: 01–21/10 compara com 10–30/09.
- `POST /api/analytics/comparison` exige `analytics:read`, valida os filtros e deriva as datas no servidor. Reutiliza `report` e o SQL canônico, incluindo o catálogo de composição e o CMV histórico. A resposta contém somente os cinco agregados e a indicação de custos incompletos. Não agenda importações nem consulta a Olist.
- Todos os filtros aplicados são mantidos. Paginação, ordenação, busca local e rascunhos não modificam o período nem disparam outra consulta anterior. Trocar filtros aplicados, atualizar manualmente ou receber progresso relevante invalida a comparação.
- A consulta só é feita quando a cobertura existente confirma os dois períodos e não há sincronizações pendentes nesses intervalos ou CMV incompleto. Histórico anterior ausente não dispara uma nova importação. O motivo da indisponibilidade aparece no próprio painel.
- A fórmula é `((atual - anterior) / anterior) * 100`, calculada com inteiros decimais e arredondada apenas na apresentação para uma casa decimal. Variações menores que 0,1% são indicadas explicitamente. Base anterior zero não gera percentual. Uma ausência confirmada de vendas atuais pode produzir queda de 100% quando havia base anterior.
- Pedidos e entidades recebem variações separadas porque são medidas distintas. Top 10 mantém semântica neutra nas duas direções. Bases negativas também usam semântica neutra: a seta mostra a direção numérica e o percentual preserva o sinal da fórmula, com explicação acessível.
- Falhas da comparação não removem os indicadores atuais. Requisições obsoletas são abortadas e suas respostas ignoradas. Durante carregamento ou atualização não se exibem variações antigas como se fossem atuais.

## Arquivos

- `src/components/analytics/abc-dashboard.tsx`: integração dos dois painéis e do hook; substituição do skeleton dessa área.
- `src/components/analytics/abc-overview.tsx`: apresentação, ícones, badges de variação, distribuição e skeleton.
- `src/components/analytics/use-abc-comparison.ts`: consulta independente de paginação, invalidação e cancelamento.
- `src/lib/analytics/comparison.ts`: datas, cobertura, extração dos agregados e percentuais com precisão decimal.
- `src/app/api/analytics/comparison/route.ts`: leitura autorizada do período anterior.
- `tests/analytics-comparison.test.cjs` e `tests/analytics-overview-ui.test.cjs`: cálculos, contrato da API e comportamento da interface.

## Validação

- Suíte completa: **368 testes aprovados**. Os 12 testes novos cobrem datas inclusivas, viradas de mês/ano, ano bissexto, horário de verão, precisão, valores negativos, divisão por zero, cobertura e CMV, isolamento de acesso e filtros, tags, distribuição, reaproveitamento de consultas, loading, erro, recuperação e respostas obsoletas.
- TypeScript e ESLint aprovados.
- Build de produção aprovado em cópia isolada no mesmo volume, sem modificar os arquivos `.next` do projeto. O bundle da página ficou em 20,5 kB, com 246 kB no primeiro carregamento.
- Os testes existentes do gráfico, interação com a tabela, filtros, detalhamento, permissões, exportação e cálculos SQL também passaram.
- Preservação verificada por SHA-256: `pareto-chart.tsx`, `globals.css`, `app/layout.tsx`, `engine.ts`, `filters.ts` e `sync.ts` mantêm os hashes anteriores à alteração.

Limitação: a referência visual mencionada não veio anexada à mensagem. O Browser disponível na sessão não encontrou um navegador conectado, portanto não foi possível conferir screenshots reais ou medir overflow nos breakpoints. Foram verificados renderização e comportamento em DOM; a conferência visual em navegador permanece pendente.

Não há migração de banco ou nova dependência. A consulta anterior reutiliza o relatório existente: embora a resposta HTTP contenha apenas agregados, a função SQL atual ainda monta internamente seu Pareto. Essa leitura adicional ocorre somente nas invalidações descritas acima, nunca na navegação da tabela.
