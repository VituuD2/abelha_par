# Composições pendentes

Atualização: 19/10/2026. Catálogo 2026-10-19.6. Fonte: produtos_2026-10-19-14-00-16.xls; aba Produtos; coluna L (Preço de custo); SHA-256 64d7283d0d7e1ddcddeed097659ecbacc12a46752851cb5f8fbf19c71782b74c.

Os 41 combos documentados com componentes diferentes agora são desmembrados nos produtos simples. Os três Corega foram confirmados em bisnagas, e os três kits de garrafa foram confirmados com garrafas SoulBM e raspador premium. Restam **1 cadastros para revisão**, dos quais 0 aparecem no snapshot de 2026-10-19T17:03:32.006Z.

| SKU | Produto | O que falta | No snapshot |
| --- | --- | --- | --- |
| 00000 | TESTE | Cadastro simples nomeado TESTE: confirmar se e venda valida ou cadastro de teste; permanece individual, sem exclusao automatica das vendas. | Não |

## Custo mantido zerado

| SKU | Produto | Custo na coluna L | Linha | Combos afetados |
| --- | --- | --- | --- | --- |
| ACFS000-K001 | Fita Seios | Mantido zerado por decisão do responsável | 53 | ACTM011-K011, TSTM-1 |

Em 20/10/2026, a consulta de produção confirmou uma venda do combo ACTM011-K011 em 10/09/2026, de R$ 28,38, incluindo uma Fita Seios. O responsável reafirmou: **“deixa 0 por hora”** e solicitou aceitar valores monetários zerados ou negativos. A migração v21 mantém o custo informado zero, inclui a quantidade da fita e permite ratear o kit. Custo zero contribui com peso zero quando há outros componentes com custo; se todos forem zero, a receita é dividida pela quantidade de componentes. Não atribuir um custo positivo por suposição. Veja [a correção v21](cmv-zero-negativo-v21-2026-10-20.md).

## Unidades confirmadas

- ACTM001-K052 → 1 × ACBF000-K050 + 1 × ACTM001-K002. O silicone é um par de estoque; não multiplicar novamente por dois.
- CMPO0BC-K002 → 1 × CMPO00B-K001 + 1 × CMPO00C-K001.
- HBCOMAX-K003/K004/K006 → respectivamente 3, 4 e 6 bisnagas de HBCOMAX-K001. A caixa do fornecedor contém duas bisnagas; a unidade da análise é a bisnaga.
- EBBF001-001 continua excluída como embalagem auxiliar nos kits aprovados; os SKUs de origem são preservados.
- KITGR-M001S e AKGMR-R001 → 1 × SBGF00M-K001 (Garrafa SoulBM Martelada) + 1 × SBLL001-K001 (Raspador PREMIUM).
- KITGR-G001S → 1 × SBGF00G-K001 (Garrafa SoulBM Grafias) + 1 × SBLL001-K001 (Raspador PREMIUM).
- CMNV150-K002 → 2 × CMNV150-K001 (Nivea 150g), inclusive nos itens sem vínculo de catálogo explicitamente confirmados pelo responsável.
- 2165 → 1 × DDCO00N-K001 (Colbert Noir), inclusive nos itens sem vínculo de catálogo explicitamente confirmados pelo responsável.

## Alerta histórico separado

- ACESG15-K001: Componente da planilha antiga ausente da exportacao atual de produtos simples; manter referencia historica e solicitar confirmacao do cadastro. Afeta ACESG15-K001S. Sem substituir por outro modelo.

7 registros sem vínculo ao catálogo no snapshot mantêm a identidade original por pedido/posição; não representam necessariamente produtos físicos distintos. Na visão Produtos base, apenas SKUs com allowUnlinked=true, confirmados pelo responsável, podem contribuir para o produto padrão. Os demais continuam separados.

Detalhes: [componentes e CMV](curva-abc-componentes-cmv-2026-10-19.md).
