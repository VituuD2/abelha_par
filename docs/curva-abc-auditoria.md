# Curva ABC — auditoria de dados e decisões

Referência: 02/10/2026. O módulo analítico será separado da conferência e usará o mesmo workspace, autenticação e identidade visual. A conferência atual seleciona uma integração Nuvemshop; a ingestão analítica deve consultar todos os pedidos da conta Olist, sem esse filtro.

## Arquitetura encontrada

- `tiny_integrations` tem índice único por workspace; OAuth, renovação, cache e cron operacional assumem uma conexão Olist por workspace.
- `olist_order_cache` contém identificadores, cliente, situação, integração e rastreio, mas não contém itens/SKUs/quantidades/preços suficientes para ABC.
- `nuvemshop_order_cache` é usado na seleção e reconciliação; não deve ser somado à Olist como outra venda.
- Há workspaces e membros ativos com os perfis administrador/operador. O módulo deve consolidar empresas dentro do workspace autorizado, nunca workspaces diferentes.
- Uma consulta somente de leitura encontrou uma conexão Olist e 946 registros no cache. Origens observadas: ML FULL 2, Mercado Livre 2, Ecommerce Nuvemshop, WooCommerce, TikTok Shop e registros sem origem identificada. São nomes reais de integrações; não demonstram, sozinhos, a identidade de uma empresa ou de uma conta de marketplace.
- A tentativa inicial de obter um pedido atual diretamente na API terminou em indisponibilidade/timeout. Não se considera nenhum campo de detalhe confirmado por essa tentativa. A implementação deve validar cada resposta e registrar falhas de sincronização.
- Na validação posterior, `/info` respondeu HTTP 200 e seu `cpfCnpj` correspondeu a **36965322000112**, confirmando o CNPJ da conexão atual. A resposta trouxe os campos documentados razão social, CNPJ, fantasia e cadastro da empresa; nenhum segredo ou dado de contato foi publicado. A nova consulta de listagem de pedidos ainda terminou em timeout. A validação não gravou novas configurações, não renovou OAuth e não importou vendas em produção.
- Um detalhe de pedido identificado pelo cache respondeu HTTP 200. A amostra real confirmou `itens[].produto.id/sku/descricao/tipo`, `quantidade`, `valorUnitario`, totais/desconto, datas/situação e os campos `ecommerce.id/nome/numeroPedidoEcommerce/numeroPedidoCanalVenda/canalVenda`, coerentes com o OpenAPI. A amostra tinha um item; não demonstra completude do histórico de todas as origens. Foram registrados somente nomes de campos/contagem, sem divulgar dados pessoais ou identificadores da venda.

## Identificação fornecida pelo responsável

| Identificação operacional | CNPJ informado | Situação encontrada |
| --- | --- | --- |
| Olist/Allist 1 | 13.397.731/0001-64 | Empresa do mesmo grupo; credenciais e autorização não disponíveis no projeto. |
| Olist/Allist 2 | 36.965.322/0001-12 | Conexão atual; CNPJ confirmado por `/info` HTTP 200. |
| Olist/Allist 3 | 37.201.039/0001-87 | Empresa do mesmo grupo; credenciais e autorização não disponíveis no projeto. |

Os CNPJs identificam as empresas, mas não substituem `client_id`, `client_secret` e OAuth. A documentação oficial de aplicativos v3 informa que cada seller usa um aplicativo privado criado na própria conta. Para contas distintas, a arquitetura é um aplicativo/credenciais por conta e autorização independente. A documentação não garante que a autorização atual alcance outras contas. [Configurações de aplicativos](https://ajuda.olist.com/hubs-e-plataformas-via-api/aplicativos-api-v3-configuracoes-e-utilizacao), [criação do aplicativo](https://api-docs.erp.olist.com/documentacao/comecando/criando-um-aplicativo), [OAuth](https://api-docs.erp.olist.com/documentacao/comecando/autenticacao).

Se 1/2/3 forem filiais dentro de uma única conta, a abrangência e distinção devem ser confirmadas externamente. O `/info` documentado retorna dados cadastrais da empresa; não foi encontrado parâmetro documentado para enumerar três contas a partir de um token.

## Inventário de campos

`D` = documentado no OpenAPI oficial, com validação de presença em cada resposta; `P` = persistido no fluxo atual. Ausência de campo não será preenchida com uma identidade inventada.

| Campo | Olist API / fonte canônica | Cache atual | Nuvemshop atual | Uso e confiabilidade / nova consulta |
| --- | --- | --- | --- | --- |
| order_id | `pedidos.id` (D) | P | ID independente | Identidade por conexão + ID Olist; listagem. |
| external_order_id | `ecommerce.numeroPedidoEcommerce` / `numeroPedidoCanalVenda` (D) | P | ID/número próprios | Somente deduplicar entre fontes com conta de origem explicitamente identificada. |
| company_id | Cadastro autorizado + `/info.cpfCnpj` (D) | Não | Loja, sem empresa fiscal | CNPJ não é ID de tenant/conta da API; consultar `/info` e validar vínculo. |
| integration_id | `ecommerce.id` (D) | P | Mapeamento configurado | ID escopado à conexão Olist. |
| channel | `ecommerce.canalVenda` (D) | Não | Somente site conectado | Detalhe; conservar nome original e normalizado. |
| marketplace | Classificação da origem pelo administrador | Não | Não | Não inferir conta de marketplace apenas de um nome de integração. |
| store / external_account | Metadados explícitos da origem | Não | `storeId` | Configuração autorizada; usados quando conhecidos. |
| customer_id / name | `cliente.id`, `cliente.nome` (D) | Só nome | ID não normalizado no fluxo | Detalhe. Não unir pessoas só por nome; ID escopado à conexão. |
| product_id / sku / name | `itens[].produto.id/sku/descricao` (D) | Não | Itens não usados | Detalhe do pedido, necessário para ABC por produto. |
| parent_product_id | `produtos.produtoPai.id` (D) | Não | Não | Consulta de produto; relação não será inferida do SKU. |
| variant_id | ID do produto/variação e `variacoes` (D) | Não | Não | Catálogo Olist; ID escopado à conexão. |
| GTIN/EAN | `produtos.gtin` (D) | Não | Não | Enriquecimento de catálogo; não une empresas automaticamente. |
| category / brand | `produtos.categoria`, `produtos.marca` (D) | Não | Não | Enriquecimento, exige leitura de produtos. |
| quantity / unit_price | `itens.quantidade`, `itens.valorUnitario` (D) | Não | Não | Obrigatórios; aritmética decimal exata. |
| gross_value | Quantidade × preço dos itens | Não | Total do pedido, outra entidade | Derivado sem frete/outras despesas; guardar divergências com total informado. |
| discount | `valorDesconto` do pedido (D) | Não | Não | Desconto comercial global; não equivale a estorno/devolução. |
| net_value | Valor de produtos menos desconto comercial | Não | Não | Não apresentar como líquido após devoluções sem ledger de devoluções validado. |
| status | `situacao` (D) | P | Pagamento/envio separados | Cancelamentos excluídos da ABC; estados selecionáveis. |
| created_at | Listagem `dataCriacao`, detalhe `data` (D) | P | P | Data comercial em São Paulo; parser estrito. |
| approved_at | Sem campo confirmado no detalhe auditado | Não | Não | Indisponível; não usar data de criação como aprovação. |
| invoice_date | `dataFaturamento`; nota `dataEmissao` (D) | Não | Não | Enriquecimento de nota; distinguir pedidos faturados de notas autônomas. |
| cancelled_at | Sem campo confirmado no detalhe auditado | Não | Não | Situação atual exclui cancelamento; não inventar horário do evento. |
| invoice_id/status/finality | `idNotaFiscal`, `/notas/:id` (D) | Não | Não | Consulta adicional; notas de devolução não são novas vendas. |
| tags | `/pedidos/:id/marcadores`, array com `descricao` (D) | Não | Não | Consulta adicional opcional; exibir disponibilidade real. |
| operation_nature | `naturezaOperacao.id/nome` (D) | Não | Não | Detalhe do pedido. |
| seller | `vendedor.id/nome` (D) | Não | Não | Detalhe do pedido. |
| state/region | `enderecoEntrega.uf` / `cliente.endereco.uf` (D) | Não | Não | Guardar somente UF necessária ao filtro, sem endereço completo. |

Fontes dos campos: [pedido](https://api-docs.erp.olist.com/api-reference/pedidos/obter-pedido), [listagem](https://api-docs.erp.olist.com/api-reference/pedidos/listar-pedidos), [produto](https://api-docs.erp.olist.com/api-reference/produtos/obter-produto), [nota fiscal](https://api-docs.erp.olist.com/api-reference/notas/obter-nota-fiscal), [marcadores](https://api-docs.erp.olist.com/api-reference/pedidos/obter-marcadores-do-pedido), OpenAPI publicado pela Olist em `https://erp.olist.com/public-api/v3/swagger/swagger-mintlify.json`.

## Decisões antes da implementação

1. Olist é a fonte canônica de pedidos/itens/valores na V1. Não somar caches, notificações e Nuvemshop como vendas adicionais.
2. Criar camada analítica própria porque o cache operacional não contém itens. Preservar tabelas, OAuth e consultas do scanner.
3. A conexão existente será referenciada, sem copiar tokens. Conexões adicionais terão credenciais criptografadas e OAuth próprio.
4. Produto/cliente são identificados por conexão + ID. Consolidação entre empresas exige vínculo explícito; SKU ou nome igual não basta.
5. Reimportação substitui os itens do pedido em uma transação. A identidade canônica da venda usa conexão + pedido; entre fontes, exige conta de origem declarada e referência externa comprovável.
6. O dashboard consultará agregações PostgreSQL, com ranking ABC calculado no servidor, paginação, Pareto e exportação do resultado completo.
7. Ingestão e backfill serão trabalhos persistentes com checkpoint, lease, retry e progresso. Dados incompletos serão indicados como parciais.
8. V1 medirá valor dos produtos e quantidade, excluindo cancelamentos. CMV, lucro, estoque e líquido após devoluções não serão inventados.
