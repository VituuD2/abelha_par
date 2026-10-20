# Curva ABC: filtros compactos e gráfico completo

## Interface

- O formulário inicia apenas com De, Até, Últimos 7/30/90 dias, Analisar vendas e o botão Mais filtros.
- Mais filtros abre as demais opções existentes, incluindo métrica, base, base histórica do CMV, períodos extras, empresas, conexões, origens, situações e atalhos de seleção.
- Filtros e regras adicionais continua fechado dentro da área expandida e abre somente por ação do usuário. Recolher a área principal fecha essa seção interna, mantendo os valores escolhidos.
- Regras da consolidação aparece apenas para administradores, pelo perfil informado pelo servidor. Operadores continuam acessando o gráfico, a tabela e o detalhamento permitidos pela aplicação.
- Os subtítulos das telas foram removidos, incluindo cabeçalhos compartilhados, apresentação das abas da Curva ABC, login e recuperação de senha.
- As instruções visíveis de mouse/teclado, o texto das referências A/B e o aviso de corte nos primeiros 60 produtos foram retirados do gráfico. As interações de mouse, toque e teclado continuam funcionando.

## Gráfico completo

A consulta anterior limitava `pareto` aos primeiros 60 registros, mesmo quando a tabela informava um total maior. A [migração v22](../supabase/migration_v22_analytics_full_pareto.sql) remove esse corte nas funções de relatório original e consolidado, preservando o cálculo e as permissões atualmente instalados.

O gráfico recebe todas as entidades classificadas do filtro atual em ordem de ranking, independentemente da página ou ordenação da tabela. A tabela mantém sua paginação. O Pareto e os totais saem da mesma instrução SQL e do mesmo conjunto de dados; não é necessário baixar pedidos individuais nem consultar a Olist ao interagir.

A largura do gráfico cresce com o número de entidades, com espaço mínimo por produto e rolagem horizontal quando necessário. O eixo final acompanha o último registro. O traçado da curva percorre os pontos uma vez, evitando a busca repetida do índice de cada produto.

## Ativação

1. Manter aplicada a v21 e executar o arquivo inteiro [migration_v22_analytics_full_pareto.sql](../supabase/migration_v22_analytics_full_pareto.sql) no mesmo Supabase usado pelo aplicativo.
2. Publicar o aplicativo com a nova interface.
3. Refazer a consulta. Para um filtro com 82 produtos, a resposta deve conter `total: 82` e 82 pontos em `pareto`, mesmo que `rows` tenha apenas a página de 25 ou 50 linhas.

A migração é idempotente, valida as definições antes de alterar o trecho conhecido e preserva a política de CMV da v21. Não altera pedidos, custos, históricos, estoque, filas ou critérios ABC. Esta revisão não executou a migração em produção.

## Validação

- Banco isolado com 164 produtos/clientes e 82 produtos pai: todos aparecem no gráfico, com a tabela paginada; filtros, ordenação, receitas, política de CMV e permissões preservados. A v22 foi aplicada duas vezes.
- Testes de interface com 82 e 164 produtos: barras e pontos completos, largura proporcional, seleção além da posição 60, detalhamento por teclado e ausência de requests durante hover.
- Testes de interação: formulário compacto, expansão independente, preservação dos valores e regras da consolidação restritas a administradores.

Os 25 testes direcionados de interface, SQL, permissões do layout e histórico passaram. Typecheck passou. A suíte anterior de interface manteve as duas falhas já conhecidas de apresentação de progresso e aviso de escopo parcial; os outros oito testes desse arquivo passaram com os novos controles.
