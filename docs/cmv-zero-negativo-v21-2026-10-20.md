# CMV zero e negativo: setembro e migração v21

O responsável solicitou em 20/10/2026 manter **ACFS000-K001 (Fita Seios) em zero** e aceitar valores monetários zerados ou negativos no aplicativo. Esta decisão substitui o bloqueio anterior para custos não positivos; valores ausentes continuam desconhecidos.

## Causa confirmada

A Olist 1 retornou um único evento para ACFS000-K001: vigência 2000-01-01, `precoCusto: 0`, `custoMedio: 0`. O cache local coincide com a origem, com histórico concluído e sem erro de sincronização.

O filtro de 01/09 a 30/09/2026 inclui uma venda de ACTM011-K011 (Tapa-mamilo + Fita Seios), em **10/09/2026**, no valor de **R$ 28,38**, incluindo uma fita. A v19 rejeitava o custo informado zero como se estivesse ausente, bloqueando a consulta de receita inteira.

Consultas de diagnóstico foram somente leitura, sem renovação de token, agendamento, edição de custo ou alteração de pedido:

- [Histórico retornado pela Olist e reprodução do erro](evidencias/olist-cmv-20261020161446/diagnostico.json).
- [Kit, quantidade e data da venda afetada](evidencias/olist-cmv-20261020161528/diagnostico.json).
- Reprodução: `node scripts/diagnose-olist-costs.cjs --fita-seios --report`; `--provider` também consulta a origem desse único SKU, após verificar a identidade da conta.

## Comportamento resultante

| Caso | CMV das unidades vendidas | Rateio da receita do kit |
| --- | --- | --- |
| Um componente custa zero, outro é positivo | Soma com zero preservado | Componente de custo zero recebe peso zero; os demais dividem a receita |
| Um custo é negativo | Mantém o sinal negativo na soma | Pesos usam a magnitude dos custos, sem inverter o sinal da receita da venda |
| Todos os custos são zero | CMV conhecido igual a zero | Divide pela quantidade de cada componente; não divide por zero |
| Receita do item zero ou negativa | CMV depende da quantidade e do custo histórico, preservado | Conserva o valor e o sinal originais da receita |
| Custo ausente, sem vigência anterior ou com conflito | Continua desconhecido | Mantém a indicação de falta de dado para ratear receita; não inventa custo zero |

Centavos residuais continuam distribuídos pelos maiores restos, com desempate por SKU. A receita dos componentes soma exatamente a receita original. A vigência é resolvida por venda/emissão, sem aplicar custos futuros a vendas anteriores. O algoritmo usa o cache local; não acrescenta requests à Olist ao abrir o relatório.

O parser aceita custos e valores monetários negativos, preservando precisão decimal. Totais e descontos do pedido também aceitam sinal. Quantidades físicas e fatores continuam positivos; valores não numéricos continuam inválidos.

A interface e a exportação mostram a regra e contam itens com custo zero, negativo e kits rateados por quantidade. A indicação de CMV incompleto considera apenas custo desconhecido, e o custo conhecido inclui negativos e zero. Erros de falta de dado não mostram o atalho de verificar conexões.

## Ativação

1. Aplicar [migration_v21_analytics_zero_signed_costs.sql](../supabase/migration_v21_analytics_zero_signed_costs.sql) após v19. É idempotente e não muda nenhum valor de custo, data de histórico, pedido ou checkpoint. Remove somente as restrições antigas de sinal do custo atual e do total do pedido, e substitui as funções de cálculo existentes preservando permissões.
2. Manter aplicada a v20 para permitir preços e valores negativos dos itens de venda.
3. Publicar o aplicativo com os parsers, mensagens, interface e metadados atualizados.
4. Consultar setembro na base desejada. O custo zero já está no cache; não precisa editar a Olist nem refazer a importação de vendas para este caso.

Aplicar **o arquivo inteiro**, de `BEGIN` até `COMMIT`, no SQL Editor do mesmo projeto Supabase usado pelo aplicativo. Não basta publicar no Vercel nem remover apenas os `CHECK`: a rejeição do custo zero também estava nas funções de cálculo.

Após executar, conferir [audit_cmv_v21_readonly.sql](../supabase/audit_cmv_v21_readonly.sql): as duas entradas v21 devem existir, `allocation_policy` deve ser `signed_cost_magnitude_zero_quantity` e `fita_purchase_cents` deve retornar **0**, não `NULL`. O script não altera dados.

As entradas de relatório e detalhamento do aplicativo agora são `analytics_abc_components_v21` e `analytics_drilldown_components_v21`, restritas a `service_role`, com verificação de membro ativo e da política de cálculo. O relatório, a exportação e o detalhamento retornam `ANALYTICS_MIGRATION_REQUIRED` (HTTP 503) se a entrada não existir ou se uma reaplicação da v19 tiver substituído a política. Isso evita apresentar incompatibilidade de implantação como custo ausente da Olist.

### Conferência em produção às 13:32 de São Paulo

O [diagnóstico somente leitura](evidencias/olist-cmv-20261020163235/diagnostico.json) encontrou o histórico de ACFS000-K001 concluído, com compra e média iguais a zero desde 2000-01-01, mas `analytics_cost_at` retornou `NULL` para 10/09 e a política da v21 estava ausente. A consulta de setembro ainda reproduziu `CMV_REQUIRED:ACFS000-K001` na base de compra. Portanto, as definições ativas naquele banco ainda eram incompatíveis com a regra solicitada, independentemente da versão do aplicativo publicado.

Nenhuma migração foi executada remotamente nesta conferência. O ambiente fornece acesso HTTP ao Supabase, sem conexão SQL configurada para executar DDL. O arquivo de migração e a consulta de validação estão preparados para o SQL Editor.

Se algum custo negativo já havia sido importado como ausente pelo parser antigo, programar a atualização do CMV no Ninho após publicar; a importação substitui o histórico completo apenas ao concluir suas páginas. Nenhum histórico é automaticamente convertido de ausente para zero.

## Verificação

A suíte isolada aplica v21 duas vezes e reproduz o kit real com custo zero. Cobre custos negativos e zerados, kit todo zerado com fatores diferentes, valores positivos/zero/negativos de venda, resíduos de centavos, total de pedido negativo, vigência histórica, custo futuro, dados desconhecidos/conflitantes, exportação e permissões de acesso. Testes de interface cobrem CMV total zero e negativo sem alerta de erro.

Na execução da suíte analítica, 156 testes passaram e permaneceram as duas falhas anteriores de `analytics-ui.test.cjs`, de apresentação de progresso e aviso de escopo parcial. Após acrescentar a verificação de ingestão atômica do total negativo, os sete testes específicos da v21 passaram. Typecheck passou e o lint não encontrou erros; manteve os quatro avisos anteriores de variáveis não utilizadas no dashboard.

Na revisão de compatibilidade, 31 testes de API, cálculo e interface passaram, incluindo migração ausente, reaplicação da v19, exportação e detalhamento com erro de versão explícito.
