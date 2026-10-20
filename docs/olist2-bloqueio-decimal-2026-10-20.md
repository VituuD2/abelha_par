# Olist 2: bloqueio por preço unitário negativo

Diagnóstico de produção em **20/10/2026, 11h55–12h00, America/Sao_Paulo**. O acesso foi somente leitura: consultas ao checkpoint no Supabase e dois GETs por observação na Olist (`/info` e o pedido pendente). Não houve refresh OAuth, migração, alteração no ERP/banco, execução de worker nem deploy.

## Causa confirmada

A conexão da Olist 2 respondeu e o CNPJ foi confirmado. O pedido **382643017**, de **10/08/2026**, tem o terceiro item **SBLL001-K001**, quantidade **1**, com `valorUnitario = -5.94`. O parser aceitava apenas valores sem sinal e lançava `Valor decimal inválido ou negativo.`. O banco também tinha restrições que rejeitavam preço e valor de linha negativos; corrigir apenas o parser não resolveria a gravação.

O checkpoint consultado era `1af1f19a-24cf-427e-b4bb-3fb317c051c0`: período 01/08–02/10, cursor 10/08, 10 páginas, **522 pedidos**, **28 tentativas**, índice pendente **43** em uma página com 51 IDs. A próxima tentativa estava marcada para 12h28 de São Paulo.

| Item | SKU | Quantidade | Preço unitário | Valor da linha |
| --- | --- | ---: | ---: | ---: |
| 1 | SBCC000-K001 | 1 | R$ 32,05 | R$ 32,05 |
| 2 | SBGF00M-K001S | 4 | R$ 350,77 | R$ 1.403,08 |
| 3 | SBLL001-K001 | 1 | −R$ 5,94 | −R$ 5,94 |
| Total | | 6 | | **R$ 1.429,19** |

A soma coincide com `valorTotalPedido = 1429.19`. A fonte informa `valorTotalProdutos = 1429.18`, uma diferença adicional de R$ 0,01 que é mantida como flag de divergência. Não há arredondamento arbitrário para forçar igualdade entre esses campos.

Não foi possível determinar apenas pelo payload se o preço negativo é uma composição comercial intencional ou um erro de cadastro/importação na Olist. Não o interpretamos automaticamente como desconto, devolução ou custo negativo. Preservar o sinal mantém os valores reais da fonte; a origem desse preço pode ser conferida no ERP.

## Correção local

- `signedDecimalUnits` é usado para preços/receitas com sinal. Quantidades permanecem positivas e o parser de custos continua rejeitando negativos. O arredondamento monetário de linhas é simétrico, inclusive nos meios centavos.
- A normalização preserva −594 centavos, quantidade 1 e SKU. O pedido recebe `item_com_preco_negativo` e mantém `total_itens_diverge_do_total_produtos`. Novos erros decimais identificam o pedido, campo e item, em vez de apresentar apenas uma mensagem genérica.
- A [migração v20](../supabase/migration_v20_analytics_signed_item_amounts.sql) remove exclusivamente as duas proibições monetárias de itens e exige sinais coerentes entre preço e valor da linha. Mantém quantidade positiva, precisão, RLS, FKs e ingestão atômica. Não altera dados existentes nem checkpoints.
- ABC e exportação preservam receitas negativas. A referência TS de ranking também as aceita. A formatação monetária passa a aceitar valores NUMERIC com casas decimais vindos do PostgreSQL, arredondando somente para exibição.
- O Ninho permite **Retomar este checkpoint** também para status `retry`, sem criar outro período. A API continua exigindo `analytics:manage`, workspace correto e ausência de erro de autorização; não aceita jobs `running` nem altera datas, contadores, IDs pendentes ou posição de leitura.
- Se o parser corrigido encontrar o schema antigo, a mensagem identifica a necessidade da v20 em vez de ocultar a falha de gravação.

## Ativação e retomada

O [patch isolado do hotfix](patches/olist2-valores-negativos.patch) contém somente os ajustes de valores com sinal, retomada, v20 e regressões necessárias, sem as mudanças de CMV v18/v19. Foi verificado com `git apply --cached --check` sobre um índice temporário do `HEAD`, sem alterar o índice nem os arquivos reais do usuário. Pode ser revisado/aplicado em um checkout limpo da versão atual antes da publicação do hotfix.

1. Aplicar a v20 e publicar o código corrigido. Essa migração é um hotfix independente sobre v13+ e não exige ativar o novo CMV. Se for publicado **todo o código atual**, que também contém as mudanças de CMV das entregas anteriores, aplicar v18/v19 conforme a documentação dessas mudanças.
2. No Ninho, usar **Retomar este checkpoint** para o histórico existente da Olist 2, ou aguardar sua próxima tentativa automática. Não apagar o job nem iniciar novamente o período de agosto.
3. Confirmar que o pedido 382643017 foi gravado uma vez e o contador avançou de 522 para 523. As importações seguintes continuam da mesma página/data. Se surgir outro dado inválido, a nova mensagem aponta o pedido e o campo.
4. Conferir o preço do SKU SBLL001-K001 na Olist se o valor negativo não tiver sido intencional. Não foi escrito nenhum preço novo no ERP.

## Evidências e validação

- [Antes: reprodução real do erro](evidencias/olist2-decimal-20261020145558/diagnostico.json).
- [Depois: mesmo pedido normalizado com sinal preservado](evidencias/olist2-decimal-20261020150056/diagnostico.json). O checkpoint de produção permanecia em 522; esse resultado é uma simulação local com o payload obtido por GET, não uma importação produtiva.
- [`scripts/diagnose-olist2-decimal.cjs`](../scripts/diagnose-olist2-decimal.cjs) reproduz a consulta restrita à Olist 2 e ao período informado, sem emitir credenciais ou dados de identificação do cliente.

Em PostgreSQL isolado, o teste reproduz a falha do schema antigo, aplica a v20 duas vezes, grava as três linhas com o valor negativo, reimporta sem duplicar e confere os totais/ranking. Também verifica que a migração não altera os 522 pedidos/índice 43 e mantém as restrições de quantidade e sinal. O teste do worker avança o checkpoint de 522 para 523 e para no pedido seguinte ao simular HTTP 429, preservando a retomada. Há testes de permissão da API e do botão de retomada. Build de produção e typecheck passaram.

A suíte analítica mais ampla manteve apenas as duas falhas anteriores de interface já identificadas: apresentação do progresso de importação e do aviso de escopo parcial. Os testes desta correção passaram. O lint da build não teve erros e manteve os quatro avisos anteriores no dashboard.
