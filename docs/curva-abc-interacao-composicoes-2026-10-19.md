# Curva ABC: interação e produtos base — 19/10/2026

O gráfico agora apresenta informações imediatamente e coordena o destaque com a tabela. A nova análise **Produtos base** consolida kits e variações no produto padrão comprovado pela composição, preservando os registros originais da Olist.

O catálogo foi ampliado após a análise dos 120 produtos simples fornecidos pelo responsável. A versão atual é 2026-10-19.6; os critérios e as evidências adicionais estão no [relatório de classificação](curva-abc-classificacao-produtos-2026-10-19.md). As decisões posteriores sobre combos e custos estão em [componentes e CMV](curva-abc-componentes-cmv-2026-10-19.md).

O padrão de interação se baseia em [highlight actions do Tableau](https://help.tableau.com/current/pro/desktop/en-us/actions_highlight.htm) e [tooltips compartilhados do Highcharts](https://www.highcharts.com/docs/chart-concepts/tooltip): informar o ponto sob o mouse, manter o contexto e destacar as representações relacionadas. A implementação usa React e SVG existentes no projeto, sem adicionar uma biblioteca de gráficos.

| Ação | Resultado |
| --- | --- |
| Hover sobre uma barra | Tooltip próprio imediato, barra, ponto da curva e linha do produto destacados |
| Hover sobre a curva | Produto nessa posição e prefixo do ranking destacados, inclusive na tabela |
| Hover sobre uma linha da tabela | Barra e ponto correspondentes destacados no gráfico |
| Hover sobre percentuais ou eixo percentual | Seleção dos produtos necessários até atingir o percentual; inclui o produto que cruza o corte |
| Teclado | Setas navegam; Home/End vão aos extremos; Shift seleciona acumulado; Enter abre pedidos; Escape limpa |
| Toque | Seleção permanece; no cartão existem ações para ver pedidos e limpar |

Os hovers não fazem chamadas ao servidor. O tooltip distingue o percentual solicitado do acumulado realmente atingido, pois um produto não é dividido para fechar um corte. A curva continua limitada aos primeiros 60 registros; a interface informa quando o corte pede produtos além dos exibidos. O ranking e os percentuais são calculados no conjunto completo. Produtos fora da página atual são identificados no cartão, sem trocar a página automaticamente.

## Consolidação pelo produto padrão

A fonte é a planilha `composicao.xls` anexada pelo responsável: 474 linhas, 425 SKUs de kits, com hash de origem no catálogo versionado. Foram extraídos apenas os dados de composição e os três vínculos manuais do aplicativo anterior; seu código e suas heurísticas não foram reutilizados.

| Origem | Destino | Conversão |
| --- | --- | --- |
| `HBCOMAX-K001S` | `HBCOMAX-K001` | 1 kit = 1 unidade base |
| `HBCOMAX-K003S` | `HBCOMAX-K001` | 1 kit = 3 unidades base |
| Venda direta de `HBCOMAX-K001` | `HBCOMAX-K001` | 1 unidade = 1 unidade base |
| `ACBF000-K100ES` | `ACBF000-K050` | 1 kit = 2 unidades base de fita; embalagem auxiliar desconsiderada |

O valor bruto de uma composição com destino único é atribuído integralmente ao produto base. Kits mistos geram unidades de cada produto simples e dividem o valor pelo CMV de referência × quantidade do componente. Os centavos residuais são atribuídos pelos maiores restos, com desempate por SKU, conservando a soma do valor vendido. As quantidades usam o fator declarado, com aritmética decimal exata. Pedidos são contados por identidade distinta. As classes ABC são recalculadas depois da consolidação.

As regras só consolidam os SKUs explicitamente identificados e somente no workspace da operação. Dois SKUs semelhantes, nomes parecidos, um sufixo `S` ou o número após `K` não autorizam conversão. Produtos sem regra mantêm a identidade por conta Olist. Itens sem vínculo ao catálogo continuam separados por pedido/posição, exceto os SKUs explicitamente confirmados com `allowUnlinked=true`: `CMNV150-K002` → 2 × `CMNV150-K001` e `2165` → 1 × `DDCO00N-K001`. Essa permissão não se propaga para o produto base nem para outros aliases. Os dados originais permanecem identificados por pedido/posição; os vínculos afetam somente a leitura consolidada. Composições circulares, conflitantes ou sem quantidade válida ficam pendentes.

Há **448 vínculos de kits/variações aceitos**, incluindo os 41 combos com vários produtos simples. As três referências Corega foram confirmadas como 3/4/6 bisnagas e voltaram à consolidação. Os três kits de garrafa foram confirmados com uma garrafa SoulBM do respectivo modelo e um raspador premium. O catálogo compilado tem 527 regras com destino único e 41 combos com múltiplos destinos, incluindo identidades diretas. Resta apenas o cadastro TESTE para revisão da composição/identidade. O CMV de ACFS000-K001 (Fita Seios) foi mantido zerado a pedido do responsável e impede o rateio por valor de dois combos caso tenham vendas; suas quantidades continuam disponíveis com aviso.

### Embalagem

O responsável confirmou que `EBBF001-001` é um produto para controle de estoque, mas pode ser desconsiderado como componente nesta Curva ABC. Essa exclusão é explícita pelo SKU. Não foi criada uma regra genérica por nome ou prefixo para ignorar outras embalagens.

Os vínculos aprovados para embalagem, incluindo o novo ACBF000-K050E, e os casos ainda incertos estão em [composições pendentes](curva-abc-composicoes-pendentes.md). O detalhamento retém os SKUs com/sem embalagem, quantidades originais, fatores e componentes auxiliares desconsiderados. Assim, uma futura visão separada não exige reconstruir vendas perdidas. O estoque e os dados originais importados não são alterados.

### Filtros, exportação e conferência

Os filtros existentes, inclusive empresa, conexão, período, nota fiscal, origem, produto, SKU e produto pai, selecionam as vendas originais antes da consolidação. Ao filtrar somente um SKU de kit, o resultado mostra a contribuição desse SKU ao produto base, e não todas as vendas de outros kits relacionados.

Tabela, Pareto, contadores e exportações usam a mesma consulta de ranking. O detalhamento apresenta os SKUs de origem, quantidades, fatores, valor atribuído e valor original para conferência. As exportações incluem versão, fonte do CMV, valores originais/atribuídos/sem rateio, filtros e política de embalagem. O relatório mostra somente as pendências das vendas filtradas, que podem diferir das pendências do catálogo completo.

O campo produto pai da Olist continua disponível na análise anterior. Ele pode representar uma família comercial de kits, em vez do produto físico padrão da composição. Por isso, esse parentesco não substitui automaticamente o vínculo de composição.

## Ativação

A página passa a abrir em **Produtos base** quando o workspace tem catálogo de composição revisado, para administradores e operadores. A visão dos cadastros originais fica identificada como **Produtos Olist**, com explicação de que os registros são separados por conta. Workspaces sem catálogo revisado continuam abrindo os produtos originais. Esta mudança de padrão depende da publicação do aplicativo; a migração sozinha não escolhe a aba da tela.

Na verificação somente leitura de 19/10/2026, a função `analytics_abc_components` já estava disponível no banco configurado. Para 20/09/2026 a 19/10/2026, usando o catálogo local 2026-10-19.5, a consulta reduziu 318 entidades originais para 79, preservando 2.617 pedidos e R$ 235.692,82 de valor bruto, sem valor pendente de rateio. SBGF00G-K001 apareceu uma única vez com 166 unidades e R$ 57.008,42. Essa consulta confirma o funcionamento do banco com as regras atuais; não comprova qual versão do aplicativo estava publicada. Os testes direcionados da correção do padrão de entrada e das funções de composição totalizaram 32 aprovados; TypeScript também aprovado.

Se a última migração aplicada ainda é a v13, executar primeiro [migration_v14_v15_analytics_complete.sql](../supabase/migration_v14_v15_analytics_complete.sql), inteiro, no SQL Editor do Supabase. Se a v15 já foi aplicada, não precisa reaplicar o consolidado. Em seguida, aplicar [migration_v16_analytics_confirmed_unlinked.sql](../supabase/migration_v16_analytics_confirmed_unlinked.sql) e publicar o aplicativo correspondente. A v16 permite as exceções explícitas de itens sem catálogo e cria pontos de entrada versionados para que a aplicação informe sua ausência. As consultas continuam `STABLE`, restritas ao `service_role`, com validação de vínculo ativo no workspace. Não modifica tabelas, workers, cron, estoque ou vendas importadas.

O hover depende da publicação do aplicativo. A versão atual de **Produtos base** precisa também da v16. Se faltar CMV em combos do período, a análise por valor pede o custo; a análise por quantidade mostra as unidades e sinaliza o valor ainda não rateado. As consultas de produto, pai e cliente continuam usando suas funções anteriores.

O catálogo está em [composition-catalog.json](../src/lib/analytics/data/composition-catalog.json). Para acrescentar um SKU ainda ausente da planilha, adicionar uma entrada em `manual`, com SKU de origem e componente padrão/quantidade, e incrementar `version`. Para confirmar ou corrigir um SKU já existente, revisar sua entrada em `kits`: uma segunda declaração conflitante não sobrepõe silenciosamente a primeira e mantém o caso pendente. O workspace é vinculado explicitamente em `workspaceIds`. A configuração de componentes auxiliares é explícita em `ignoredComponentSkus`; remover uma exclusão não inventa uma nova regra para kits com vários produtos.

A lista simples extraída está em `base-products.json`; as 15 inferências revisadas e os bloqueios adicionais estão em `composition-classification.json`. Ao resolver um bloqueio nesse último arquivo, é necessário retirar sua entrada de `pending` após confirmar o destino/fator; ele tem prioridade sobre uma composição antiga conflitante.

## Verificação

Testes isolados verificam receita e pedidos conservados, unidades convertidas, embalagem, origem preservada, filtros, identidade de itens sem vínculo, classificação após consolidação, exportação, paginação, isolamento de workspace e permissões SQL. Os testes de DOM verificam tooltip imediato, ligação nos dois sentidos, seleção acumulada, mudança de percentual dentro do mesmo produto, teclado, toque e ausência de requisições durante hover. O build é executado em uma cópia temporária para preservar os artefatos `.next` já versionados no projeto.

O navegador real não estava disponível: seleção falhou e a lista de navegadores conectados estava vazia. Portanto, a validação de DOM não é apresentada como inspeção visual ou E2E real. A suíte geral já apresentava duas falhas de progresso/cobertura antes desta tarefa, registradas em [ninho-permissoes-2026-10-19.md](ninho-permissoes-2026-10-19.md); a edição anterior que retirou esses elementos foi preservada.

Na atualização de componentes/CMV, build e TypeScript foram aprovados; lint sem erros e com os seis avisos anteriores. A suíte completa registrou **192 aprovados e as mesmas duas falhas anteriores em 194 testes**, sem testes ignorados. Os dez testes novos dessa atualização passaram. Evidências: [testes-componentes-cmv.json](evidencias/curva-abc-2026-10-19/testes-componentes-cmv.json) e [build-componentes-cmv.json](evidencias/curva-abc-2026-10-19/build-componentes-cmv.json). As evidências anteriores de interação e classificação foram mantidas como histórico.

Não foram executados DDL nem alterações de produção. A leitura de produtos em produção gerou [composicoes-revisao.json](evidencias/curva-abc-2026-10-19/composicoes-revisao.json), sem dados de clientes ou credenciais. Ela ajuda a localizar pendências no cadastro já importado e não representa uma varredura completa do catálogo Olist.

A remoção das duas cópias temporárias de build foi rejeitada pela revisão automática com a mensagem `blocked by policy`. As cópias foram mantidas em `C:\Users\User\AppData\Local\Temp\abelha-par-abc-build-Ssor79` e `E:\Users\User\Documents\ESTUDOS\abelha-par-abc-build-9OrfrY`; nenhuma remoção foi executada. Os artefatos `.next` do workspace foram preservados.
