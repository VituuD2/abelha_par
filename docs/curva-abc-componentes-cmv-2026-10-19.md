# Componentes e rateio pelo CMV — 19/10/2026

Catálogo 2026-10-19.5: 41 combos com vários componentes; 39 com todos os custos válidos.

Fonte: produtos_2026-10-19-14-00-16.xls; aba Produtos; coluna L (Preço de custo); SHA-256 64d7283d0d7e1ddcddeed097659ecbacc12a46752851cb5f8fbf19c71782b74c.

## Regra aplicada

Peso de cada produto = quantidade na composição × CMV unitário do produto simples. Valor atribuído = valor bruto vendido do kit × peso do produto ÷ soma dos pesos. A quantidade vendida do kit multiplica a quantidade de cada componente.

Cada linha original é rateada separadamente com aritmética decimal exata. Os centavos restantes vão para os maiores restos, com desempate pelo SKU. Com custos completos, a soma reproduz integralmente o valor vendido.

Exemplo: um kit de fita (CMV R$ 5,00) + um par de silicone (CMV R$ 3,60), vendido por R$ 100,00, atribui R$ 58,14 à fita e R$ 41,86 ao silicone. Gera uma unidade de estoque de cada SKU.

É um rateio gerencial pelo custo de referência da exportação, não o CMV histórico de cada pedido nem cálculo de margem. Vendas com destino único preservam integralmente o valor e dispensam CMV para o rateio.

Sem custo válido de todos os componentes, o valor inteiro da linha fica sinalizado como não rateado. A Curva por valor pede o CMV faltante; a Curva por quantidade mantém as unidades completas, informa o valor original/sem rateio e mostra apenas o valor já atribuído aos produtos. Zero não é interpretado como custo gratuito.

## CMV pendente

| SKU | Produto | Custo na coluna L | Linha | Combos afetados |
| --- | --- | --- | --- | --- |
| ACFS000-K001 | Fita Seios | Mantido zerado por decisão do responsável | 53 | ACTM011-K011, TSTM-1 |

## Unidades de estoque

- ACTM001-K052 → 1 × ACBF000-K050 + 1 × ACTM001-K002. O silicone é um par de estoque; não multiplicar novamente por dois.
- CMPO0BC-K002 → 1 × CMPO00B-K001 + 1 × CMPO00C-K001.
- HBCOMAX-K003/K004/K006 → respectivamente 3, 4 e 6 bisnagas de HBCOMAX-K001. A caixa do fornecedor contém duas bisnagas; a unidade da análise é a bisnaga.
- EBBF001-001 continua excluída como embalagem auxiliar nos kits aprovados; os SKUs de origem são preservados.
- KITGR-M001S e AKGMR-R001 → 1 × SBGF00M-K001 (Garrafa SoulBM Martelada) + 1 × SBLL001-K001 (Raspador PREMIUM).
- KITGR-G001S → 1 × SBGF00G-K001 (Garrafa SoulBM Grafias) + 1 × SBLL001-K001 (Raspador PREMIUM).

## Composições resolvidas

| Kit/variação | Componentes | CMV unitário | Rateio |
| --- | --- | --- | --- |
| ACTM001-K052 | 1 × ACBF000-K050 (Fita Beleza Fix); 1 × ACTM001-K002 (Par Tapa-mamilo SILICONE) | ACBF000-K050: R$ 5,00; ACTM001-K002: R$ 3,60 | Por CMV × quantidade |
| ACTM011-K011 | 1 × ACFS000-K001 (Fita Seios); 1 × ACTM000-K010 (Tapa Mamilo) | ACFS000-K001: CMV pendente; ACTM000-K010: R$ 1,65 | CMV pendente: ACFS000-K001 |
| ACTM070-K070 | 1 × ACBF000-K050 (Fita Beleza Fix); 2 × ACTM000-K010 (Tapa Mamilo) | ACBF000-K050: R$ 5,00; ACTM000-K010: R$ 1,65 | Por CMV × quantidade |
| ACTM070-K070S | 1 × ACBF000-K050 (Fita Beleza Fix); 2 × ACTM000-K010 (Tapa Mamilo) | ACBF000-K050: R$ 5,00; ACTM000-K010: R$ 1,65 | Por CMV × quantidade |
| AKGMR-R001 | 1 × SBGF00M-K001 (Garrafa SoulBM Martelada); 1 × SBLL001-K001 (Raspador de Lingua PREMIUM) | SBGF00M-K001: R$ 120,00; SBLL001-K001: R$ 17,04 | Por CMV × quantidade |
| CCMO222-K002 | 1 × CCMO001-K001 (Garrafa MOR Preta); 1 × CCMO002-K001 (Garrafa MOR Branca) | CCMO001-K001: R$ 46,74; CCMO002-K001: R$ 46,74 | Por CMV × quantidade |
| CMPO0BC-K002 | 1 × CMPO00B-K001 (Pond's Bio); 1 × CMPO00C-K001 (Pond's C) | CMPO00B-K001: R$ 23,45; CMPO00C-K001: R$ 23,45 | Por CMV × quantidade |
| CMPO0CN-K002 | 1 × CMPO00C-K001 (Pond's C); 1 × CMPO00N-K001 (Pond's Noite) | CMPO00C-K001: R$ 23,45; CMPO00N-K001: R$ 27,25 | Por CMV × quantidade |
| CMPO0CN-K002S | 1 × CMPO00C-K001 (Pond's C); 1 × CMPO00N-K001 (Pond's Noite) | CMPO00C-K001: R$ 23,45; CMPO00N-K001: R$ 27,25 | Por CMV × quantidade |
| CMPO0CS-K002 | 1 × CMPO00C-K001 (Pond's C); 1 × CMPO00S-K001 (Pond's S) | CMPO00C-K001: R$ 23,45; CMPO00S-K001: R$ 23,45 | Por CMV × quantidade |
| CMPO0DN-K002 | 1 × CMPO00D-K001 (Pond's Dia); 1 × CMPO00N-K001 (Pond's Noite) | CMPO00D-K001: R$ 27,25; CMPO00N-K001: R$ 27,25 | Por CMV × quantidade |
| CMPO0DN-K002S | 1 × CMPO00D-K001 (Pond's Dia); 1 × CMPO00N-K001 (Pond's Noite) | CMPO00D-K001: R$ 27,25; CMPO00N-K001: R$ 27,25 | Por CMV × quantidade |
| CMPO0DS-K002 | 1 × CMPO00D-K001 (Pond's Dia); 1 × CMPO00S-K001 (Pond's S) | CMPO00D-K001: R$ 27,25; CMPO00S-K001: R$ 23,45 | Por CMV × quantidade |
| CMPO2CN-K003 | 2 × CMPO00C-K001 (Pond's C); 1 × CMPO00N-K001 (Pond's Noite) | CMPO00C-K001: R$ 23,45; CMPO00N-K001: R$ 27,25 | Por CMV × quantidade |
| CMPO2DN-K004 | 2 × CMPO00D-K001 (Pond's Dia); 2 × CMPO00N-K001 (Pond's Noite) | CMPO00D-K001: R$ 27,25; CMPO00N-K001: R$ 27,25 | Por CMV × quantidade |
| CMPO2DS-K004 | 2 × CMPO00D-K001 (Pond's Dia); 2 × CMPO00S-K001 (Pond's S) | CMPO00D-K001: R$ 27,25; CMPO00S-K001: R$ 23,45 | Por CMV × quantidade |
| CMPO2NS-K004 | 2 × CMPO00N-K001 (Pond's Noite); 2 × CMPO00S-K001 (Pond's S) | CMPO00N-K001: R$ 27,25; CMPO00S-K001: R$ 23,45 | Por CMV × quantidade |
| CMPOB2S-K004 | 2 × CMPO00B-K001 (Pond's Bio); 2 × CMPO00S-K001 (Pond's S) | CMPO00B-K001: R$ 23,45; CMPO00S-K001: R$ 23,45 | Por CMV × quantidade |
| CMPOCB3-K002 | 1 × CMPO00C-K001 (Pond's C); 1 × CMPO0B3-K001 (Pond's B3) | CMPO00C-K001: R$ 23,45; CMPO0B3-K001: R$ 27,25 | Por CMV × quantidade |
| CMPOCDN-K003 | 1 × CMPO00C-K001 (Pond's C); 1 × CMPO00D-K001 (Pond's Dia); 1 × CMPO00N-K001 (Pond's Noite) | CMPO00C-K001: R$ 23,45; CMPO00D-K001: R$ 27,25; CMPO00N-K001: R$ 27,25 | Por CMV × quantidade |
| CMPOCDS-K003 | 1 × CMPO00C-K001 (Pond's C); 1 × CMPO00D-K001 (Pond's Dia); 1 × CMPO00S-K001 (Pond's S) | CMPO00C-K001: R$ 23,45; CMPO00D-K001: R$ 27,25; CMPO00S-K001: R$ 23,45 | Por CMV × quantidade |
| CMPOCDS-K003S | 1 × CMPO00C-K001 (Pond's C); 1 × CMPO00D-K001 (Pond's Dia); 1 × CMPO00S-K001 (Pond's S) | CMPO00C-K001: R$ 23,45; CMPO00D-K001: R$ 27,25; CMPO00S-K001: R$ 23,45 | Por CMV × quantidade |
| CMPOCN3-K003 | 1 × CMPO00C-K001 (Pond's C); 1 × CMPO00N-K001 (Pond's Noite); 1 × CMPO0B3-K001 (Pond's B3) | CMPO00C-K001: R$ 23,45; CMPO00N-K001: R$ 27,25; CMPO0B3-K001: R$ 27,25 | Por CMV × quantidade |
| CMPODB3-K002 | 1 × CMPO00D-K001 (Pond's Dia); 1 × CMPO0B3-K001 (Pond's B3) | CMPO00D-K001: R$ 27,25; CMPO0B3-K001: R$ 27,25 | Por CMV × quantidade |
| CMPODN3-K003 | 1 × CMPO00D-K001 (Pond's Dia); 1 × CMPO00N-K001 (Pond's Noite); 1 × CMPO0B3-K001 (Pond's B3) | CMPO00D-K001: R$ 27,25; CMPO00N-K001: R$ 27,25; CMPO0B3-K001: R$ 27,25 | Por CMV × quantidade |
| CMPODS3-K003 | 1 × CMPO00D-K001 (Pond's Dia); 1 × CMPO00S-K001 (Pond's S); 1 × CMPO0B3-K001 (Pond's B3) | CMPO00D-K001: R$ 27,25; CMPO00S-K001: R$ 23,45; CMPO0B3-K001: R$ 27,25 | Por CMV × quantidade |
| CMPOSB3-K002 | 1 × CMPO00S-K001 (Pond's S); 1 × CMPO0B3-K001 (Pond's B3) | CMPO00S-K001: R$ 23,45; CMPO0B3-K001: R$ 27,25 | Por CMV × quantidade |
| DDCO0NV-K002 | 1 × DDCO00N-K001 (Colbert Noir); 1 × DDCO00V-K001 (Colbert Verde) | DDCO00N-K001: R$ 20,40; DDCO00V-K001: R$ 20,40 | Por CMV × quantidade |
| DDCO0UA-K002 | 1 × DDCO00A-K001 (Colbert Acqua); 1 × DDCO00U-K001 (Colbert US) | DDCO00A-K001: R$ 20,40; DDCO00U-K001: R$ 20,40 | Por CMV × quantidade |
| DDCOUCA-K003 | 1 × DDCO00A-K001 (Colbert Acqua); 1 × DDCO00C-K001 (Colbert Code); 1 × DDCO00U-K001 (Colbert US) | DDCO00A-K001: R$ 20,40; DDCO00C-K001: R$ 20,40; DDCO00U-K001: R$ 20,40 | Por CMV × quantidade |
| DDFASPC-K006 | 3 × DDFA00C-K001 (Fa Caribbean); 3 × DDFA0SP-K001 (Fa Sport) | DDFA00C-K001: R$ 11,78; DDFA0SP-K001: R$ 11,78 | Por CMV × quantidade |
| HBCO70X-K002 | 1 × HBCO70M-K001 (Corega 70g Menta); 1 × HBCOMAX-K001 (Corega 70g MAX Combo) | HBCO70M-K001: R$ 55,69; HBCOMAX-K001: R$ 82,06 | Por CMV × quantidade |
| HBCO70X-K002S | 1 × HBCO70M-K001 (Corega 70g Menta); 1 × HBCOMAX-K001 (Corega 70g MAX Combo) | HBCO70M-K001: R$ 55,69; HBCOMAX-K001: R$ 82,06 | Por CMV × quantidade |
| KITGR-G001S | 1 × SBGF00G-K001 (Garrafa SoulBM Grafias); 1 × SBLL001-K001 (Raspador de Lingua PREMIUM) | SBGF00G-K001: R$ 90,08; SBLL001-K001: R$ 17,04 | Por CMV × quantidade |
| KITGR-M001S | 1 × SBGF00M-K001 (Garrafa SoulBM Martelada); 1 × SBLL001-K001 (Raspador de Lingua PREMIUM) | SBGF00M-K001: R$ 120,00; SBLL001-K001: R$ 17,04 | Por CMV × quantidade |
| PDCO00N-K002 | 1 × DDCO00N-K001 (Colbert Noir); 1 × PFCO00N-K001 (Perfume Colbert Noir Preto Argentino Eau de Toilette 90ml) | DDCO00N-K001: R$ 20,40; PFCO00N-K001: R$ 50,00 | Por CMV × quantidade |
| PDCO00N-K003 | 2 × DDCO00N-K001 (Colbert Noir); 1 × PFCO00N-K001 (Perfume Colbert Noir Preto Argentino Eau de Toilette 90ml) | DDCO00N-K001: R$ 20,40; PFCO00N-K001: R$ 50,00 | Por CMV × quantidade |
| PDCO00U-K002 | 1 × DDCO00U-K001 (Colbert US); 1 × PFCO00U-K001 (Perfume Colbert US Branco Argentino Eau de Toilette 60ml) | DDCO00U-K001: R$ 20,40; PFCO00U-K001: R$ 50,00 | Por CMV × quantidade |
| PDCO00U-K003 | 2 × DDCO00U-K001 (Colbert US); 1 × PFCO00U-K001 (Perfume Colbert US Branco Argentino Eau de Toilette 60ml) | DDCO00U-K001: R$ 20,40; PFCO00U-K001: R$ 50,00 | Por CMV × quantidade |
| TESTE-123 | 1 × ACBF000-K050 (Fita Beleza Fix); 2 × ACTM000-K010 (Tapa Mamilo) | ACBF000-K050: R$ 5,00; ACTM000-K010: R$ 1,65 | Por CMV × quantidade |
| TSTM-1 | 1 × ACFS000-K001 (Fita Seios); 2 × ACTM000-K010 (Tapa Mamilo) | ACFS000-K001: CMV pendente; ACTM000-K010: R$ 1,65 | CMV pendente: ACFS000-K001 |

## Aplicação

Para o projeto cuja última migração aplicada é a v13, executar somente [migration_v14_v15_analytics_complete.sql](../supabase/migration_v14_v15_analytics_complete.sql), inteiro, no SQL Editor do Supabase. Ele reúne v14 + v15 em uma única transação e solicita atualização do cache da API após concluir. Não executar os dois arquivos individuais além do consolidado. Depois, publicar a versão correspondente do aplicativo. As funções v14 são preservadas para compatibilidade; tela, detalhamento e exportação atuais usam as funções novas. Nenhuma migração ou publicação foi executada em produção nesta entrega.

Os filtros continuam incidindo sobre os itens originais antes do desmembramento. O total usa pedidos distintos. Produtos sem composição confirmada continuam separados, com seu valor original; essa pendência difere da falta de CMV de uma composição conhecida.
