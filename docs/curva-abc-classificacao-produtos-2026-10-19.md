# Classificação dos produtos — 19/10/2026

Catálogo 2026-10-19.5. Cruzamento de 120 produtos simples, 425 kits antigos, três vínculos manuais, 18 aliases revisados e 489 registros do snapshot de leitura 2026-10-19T17:03:32.006Z.

Resultado: 119 produtos base comerciais, 446 vínculos de kits/variações aceitos, 525 regras com destino único e 41 combos com vários destinos. Restam 1 cadastros para revisão e 1 produto simples sem CMV positivo necessário aos combos.

Camel Toe K002 converte em duas unidades de ACAI000-K001. Os fatores respeitam unidade de estoque, modelo, tamanho e sabor. Nenhum sufixo é removido globalmente. Os vínculos revisados e suas evidências permanecem em composition-classification.json. Os kits de garrafa foram confirmados pelo responsável como uma garrafa SoulBM do respectivo modelo e um raspador premium.

As decisões do usuário confirmam desmembramento de kits mistos, silicone por par, Corega por bisnaga e rateio pelo CMV × quantidade. Os três Corega anteriormente suspensos voltam à consolidação com fatores 3/4/6. Ter vários produtos na composição já não é motivo de pendência.

## Pendências restantes

| SKU | Produto | O que falta | No snapshot |
| --- | --- | --- | --- |
| 00000 | TESTE | Cadastro simples nomeado TESTE: confirmar se e venda valida ou cadastro de teste; permanece individual, sem exclusao automatica das vendas. | Não |

| SKU | Produto | Custo na coluna L | Linha | Combos afetados |
| --- | --- | --- | --- | --- |
| ACFS000-K001 | Fita Seios | Mantido zerado por decisão do responsável | 53 | ACTM011-K011, TSTM-1 |

ACESG15-K001 segue como referência histórica ausente da exportação atual, sem substituir pelo espelho de outro tamanho.

## Rastreabilidade e aplicação

Fonte: produtos_2026-10-19-14-00-16.xls; aba Produtos; coluna L (Preço de custo); SHA-256 64d7283d0d7e1ddcddeed097659ecbacc12a46752851cb5f8fbf19c71782b74c.

As linhas de origem e custos inteiros em centavos estão em base-products.json. As regras são compiladas no servidor e limitadas ao workspace revisado; regras enviadas pelo navegador não são aceitas. Quantidades, rateio e ranking são calculados em SQL; a exportação usa o ranking completo.

Para o projeto cuja última migração aplicada é a v13, executar somente [migration_v14_v15_analytics_complete.sql](../supabase/migration_v14_v15_analytics_complete.sql), inteiro, no SQL Editor do Supabase. Ele reúne v14 + v15 em uma única transação e solicita atualização do cache da API após concluir. Não executar os dois arquivos individuais além do consolidado. Depois, publicar a versão correspondente do aplicativo. As funções v14 são preservadas para compatibilidade; tela, detalhamento e exportação atuais usam as funções novas. Nenhuma migração ou publicação foi executada em produção nesta entrega.

Ver [produtos base](curva-abc-produtos-base.md), [pendências](curva-abc-composicoes-pendentes.md), [componentes e CMV](curva-abc-componentes-cmv-2026-10-19.md) e [evidência estruturada](evidencias/curva-abc-2026-10-19/classificacao-produtos.json).

## Validação desta atualização

Build e TypeScript aprovados. Lint sem erros, com os seis avisos anteriores. Suíte completa: 192 aprovados em 194; permanecem as duas falhas anteriores de progresso/cobertura da importação. Os dez testes novos passaram, cobrindo kits mistos, fatores por unidade de estoque, centavos, linhas repetidas, CMV ausente/zerado, erro acionável e apresentação do valor atribuído/original. A v15 foi aplicada duas vezes no banco isolado de testes, e as funções foram consultadas em transação somente leitura.

Evidências: [testes-componentes-cmv.json](evidencias/curva-abc-2026-10-19/testes-componentes-cmv.json), [saída TAP](evidencias/curva-abc-2026-10-19/testes-componentes-cmv.tap) e [build-componentes-cmv.json](evidencias/curva-abc-2026-10-19/build-componentes-cmv.json). A validação de interface usa DOM simulado; não houve inspeção visual em navegador real nesta atualização.

Atualização do catálogo 2026-10-19.5: os três kits de garrafa passaram a apontar para uma garrafa SoulBM e um raspador premium. Os 23 testes direcionados de classificação/composição passaram com esse catálogo, incluindo a aplicação/reaplicação da migração consolidada. Essa alteração de catálogo não exige novo SQL; o arquivo consolidado v14 + v15 continua sendo o mesmo.
