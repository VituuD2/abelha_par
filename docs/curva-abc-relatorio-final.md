# IMPLEMENTAÇÃO CURVA ABC — RELATÓRIO FINAL

Referência: 02/10/2026. Entrega em código local, sem migração, publicação ou importação em produção. Menu **Néctar**, título interno **Curva ABC**, rota `/analytics/abc`. Relacionados: [auditoria e matriz de campos](curva-abc-auditoria.md), [implantação e operação](curva-abc-implantacao.md).

## 1. Arquitetura encontrada

Next.js 15/React 19/TypeScript, App Router, Tailwind 4, Framer Motion, Lucide, Supabase Auth/PostgreSQL. Workspace compartilhado com membros ativos admin/operator. O cache operacional é centrado em pedido/rastreio e não contém itens suficientes para ABC. A conferência atual usa uma origem Nuvemshop. O módulo analítico usa o mesmo aplicativo, autenticação, workspace e layout, com armazenamento separado.

## 2. Integrações encontradas

Uma autorização Olist em `tiny_integrations`, com unicidade por workspace, OAuth, tokens criptografados e renovação protegida por lease; uma infraestrutura Nuvemshop de pedidos/reconciliação. Há caches, webhook Olist, fila e cron operacional. A Olist analítica consulta todos os pedidos do ERP sem reutilizar o filtro de conferência e suporta N conexões próprias adicionais por workspace.

## 3. Empresas encontradas

O responsável confirmou que as três empresas pertencem ao mesmo grupo autorizado. A conexão atual retornou `/info` HTTP 200 com CNPJ correspondente a **36.965.322/0001-12**. Os CNPJs informados para 1 e 3 são **13.397.731/0001-64** e **37.201.039/0001-87**. Nenhuma autorização dessas duas contas foi encontrada. A migração mantém genérica a empresa inicial; o administrador identifica o grupo no Ninho, sem cadastrar empresas deste grupo indiscriminadamente em outros workspaces.

## 4. Canais encontrados

Leitura do cache atual encontrou 946 registros e origens reais nomeadas ML FULL 2, Mercado Livre 2, Ecommerce Nuvemshop, WooCommerce, TikTok Shop e registros sem origem. Esses nomes são evidência de integrações existentes, não garantia de contas/canais normalizados ou de abrangência de toda a operação. `ecommerce.canalVenda` é preservado quando fornecido. Filtros são derivados dos dados, não de uma lista fixa de plataformas.

## 5. Marketplaces encontrados

Nomes de integrações indicam operações em Mercado Livre e TikTok, mas não provam seller/loja/conta canônica. O Ninho permite classificar cada origem como marketplace/site/direta/outra e informar marketplace/loja/conta comprovada. Classificações desconhecidas permanecem identificadas. Os presets filtram tipos reais classificados, mantendo o escopo explícito.

## 6. Situação Olist 1

Arquitetura, cadastro de empresa, aplicativo e OAuth individual disponíveis. Conexão real pendente de criação/configuração de aplicativo na empresa de CNPJ 13.397.731/0001-64. **REQUER VALIDAÇÃO EXTERNA** de permissões, conta autorizada e histórico.

## 7. Situação Olist 2

Autorização operacional existente preservada, CNPJ confirmado em consulta somente de leitura. A camada analítica a referencia sem copiar tokens. Ativação analítica requer aplicar v11, identificar/validar a empresa no Ninho e iniciar backfill. A consulta de listagem de pedidos apresentou timeout nesta auditoria; não há afirmação de histórico analítico já importado.

## 8. Situação Olist 3

Suporte completo ao cadastro de conexão adicional, credenciais próprias e OAuth; autorização real pendente para CNPJ 37.201.039/0001-87. **REQUER VALIDAÇÃO EXTERNA** de aplicativo, acesso e histórico.

## 9. Necessidade de novos apps OAuth

A documentação oficial atual descreve aplicativos v3 privados criados na própria conta de cada seller. Para contas ERP distintas, **aplicativo/credenciais próprios e OAuth separado por conta**. Não foi encontrada garantia de que um token atual enumeraria as três empresas. A confirmação de `/info` identifica somente a conta atual; os CNPJs não são credenciais. [Configurações oficiais de aplicativos](https://ajuda.olist.com/hubs-e-plataformas-via-api/aplicativos-api-v3-configuracoes-e-utilizacao), [OAuth](https://api-docs.erp.olist.com/documentacao/comecando/autenticacao).

## 10. Fonte canônica

Pedidos, itens, clientes, preços e situações: Olist. Categorias, marcas, GTIN e produto pai: detalhe de produto Olist. Nota vinculada: detalhe de nota Olist. Marketplace/loja/conta externa: classificação administrativa explícita quando esses conceitos não são retornados de modo confiável. Nuvemshop não gera uma segunda venda na camada ABC.

## 11. Estratégia de deduplicação

Unicidade de venda por workspace + conexão + ID Olist, aliases e substituição transacional dos itens. Reimportar não soma o registro anterior. Conta externa comprovada + referência externa permite reconciliar cópias entre conexões, mediante confirmação administrativa, sem concatenar valores de identidade de forma ambígua. Aliases são mantidos; vence a conexão com menor UUID, regra estável. Nunca deduplicar por nome, valor, cliente/data nem agrupar produtos entre empresas só pelo SKU.

## 12. Schema analítico

Oito tabelas: empresas, conexões, origens, produtos, pedidos, aliases, itens e trabalhos persistentes. Pedidos preservam origem, cliente escopado, data, situação, total/desconto global, nota e qualidade; itens preservam produto, quantidade, preço e valor bruto. Dimensões continuam disponíveis para matriz por empresa/canal e futuros relatórios. Valores monetários/quantidades são `numeric`, com centavos inteiros para receita e strings no JSON.

## 13. Migrations

`supabase/migration_v11_analytics_abc.sql`: schema, índices, ligação da conexão antiga, RLS, RPCs de ingestão, cancelamento, reconciliação, cobertura, agregação, drilldown e opções. Reaplicação testada. `setup_analytics_cron.sql`: rotina separada. `setup_analytics_grupo_multiempresas.sql`: prepara??o opcional das empresas/conex?es informadas, somente no workspace escolhido, com reaplica??o e aus?ncia de credenciais fict?cias testadas. `rollback_v11_analytics_abc.sql`: remoção isolada do novo schema; preservação operacional testada. Nenhum destes scripts foi aplicado em produção nesta entrega.

## 14. Sincronização

Worker server-side com um lease por conexão, lote limitado, timeout, espaçamento de chamadas, paginação, checkpoints e retry. Atualizações consultam `dataAtualizacao` por dia com sobreposição; watermark é persistente. A primeira atualização considera a data em que o backfill começou, incluindo alterações durante sua execução. Credenciais adicionais renovam com Client ID/Secret próprios, coalescência local, lease distribuído e persistência do mesmo par em caso de retry. Renovação antiga reutilizada.

## 15. Backfill

Importação por conexão/período/dia/página/pedido, programada no Ninho e executada fora da consulta do dashboard. Progresso, erros, pausa da conexão, continuação manual e retomada do mesmo checkpoint após falha. Produtos enriquecidos são reaproveitados por sete dias. Trabalho concluído define cobertura histórica; intervalos adjacentes são unidos no SQL sem esconder lacunas ou depender dos últimos 200 trabalhos exibidos na tela.

## 16. Motor ABC

Agregação e ranking executados no PostgreSQL, antes da paginação. Motor TypeScript exato usado para normalização e testes de paridade. Agrupamentos por produto, produto pai documentado e cliente. Métricas valor bruto dos itens/quantidade. Empates por métrica DESC, quantidade DESC, identidade ASC. Classes, participações, acumulados e rankings pertencem ao conjunto filtrado inteiro. Ordenação visual posterior não altera essa classificação.

## 17. Tiny Legacy

Padrão `TINY_LEGACY`, limites 80/95: a classe usa o acumulado **anterior** à linha. `STRICT_CUMULATIVE` usa o acumulado **após** a linha. Comparação estrita `<`; igualdade com limite avança de classe. Exemplo 80/15/5 → A/B/C no histórico e B/C/C no estrito. Uma entidade que representa 99,68% permanece A no modo histórico. Conjunto com métrica zero não inventa percentuais.

## 18. Filtros

Período inclusivo, presets, pedidos/NF vinculada autorizada, métrica, limites, modo e agrupamento. Multiseleção por empresa, conexão, integração/origem, tipo de origem, canal, marketplace, loja, conta, situação, produto, SKU, pai, categoria, marca, cliente, marcador, natureza, vendedor e UF. Valores vêm de dados persistidos; ausências são explicadas. Opções limitadas a 200 por dimensão com pesquisa no servidor; identidades de produto/pai e cliente permanecem escopadas. Aplicação dos filtros ocorre antes de somar e classificar.

## 19. Multiempresa

Todas, uma empresa ou qualquer combinação (incluindo 1 + 3) no mesmo workspace. A soma dos valores das vendas elegíveis é consolidada, enquanto entidades permanecem identificadas corretamente. Mesmo SKU em empresas diferentes fica separado. Consolidação de produtos efetivamente equivalentes por vínculo explícito é extensão futura; não há união automática por nome/SKU/GTIN. Empresas cadastradas sem conexão/histórico fazem o escopo aparecer como parcial.

## 20. Omnichannel

Pedidos de todas as integrações da conta Olist entram na camada analítica. Não se filtra Nuvemshop na ingestão. Novas origens aparecem pelos dados importados. Integrações diretas futuras precisam de adaptador que respeite a mesma identidade canônica, antes de entrar na soma. Presets de site/marketplaces funcionam sobre a classificação real. Comparação matricial entre plataformas é preparação arquitetural, não uma tela adicional nesta V1.

## 21. Segurança

Mesma autenticação/workspace da aplicação. Operador ativo consulta/exporta; somente administrador cadastra/configura empresas, aplicativos, origens e importações. Nenhum segredo em código, resposta ou URL de callback. AES-256-GCM para credenciais novas. Estado OAuth assinado e vinculado ao usuário, workspace, conexão, versão e fluxo de uso único, com validade de dez minutos. CNPJ validado antes de vincular a nova autorização. Tokens de refresh são protegidos por lease e comparação de versão/token anterior. Planilhas tratam valores importados como texto e CSV neutraliza fórmulas.

## 22. RLS

Todas as tabelas analíticas têm RLS. Quando há SELECT direto, exige membro ativo no workspace do registro. Tabela de credenciais não é legível no navegador. Escritas/RPCs são exclusivas de service role; relatórios validam novamente o membro recebido do servidor autenticado, e reconciliação exige admin. FKs compostas impedem mistura de empresas/conexões/origens entre workspaces. Dados enviados pelo cliente não podem escolher outro workspace/usuário para os relatórios.

## 23. Testes

**111 testes passaram na verificação completa.** Testes novos de matemática e limites, 99,68%, zero/vazio/uma/muitas entidades, empates, valores grandes e decimais, produto pai/cliente, modos/métricas, filtros combinados, multiconexão, origens, idempotência, deduplicação explícita, cancelamento sem itens, cobertura, leases, retomada/429 e enriquecimento sem permissão. Testes de API negam leitura/mutação não autorizada e ignoram workspace forjado. Testes de OAuth adicional verificam credenciais independentes, uma troca para chamadas simultâneas, retry do mesmo par e bloqueio de troca de CNPJ na reconexão. Testes de DOM verificam página limitada, filtros, ordenação, drilldown e estados parciais/erro. Testes antigos continuam na suíte.

Também foi exercitada consulta com **50 mil pedidos/itens e 5 mil produtos** no PGlite local: página de 100 registros, Pareto de 60 pontos e resposta de aproximadamente **45,7 KB**. A consulta isolada levou aproximadamente **870 ms** nesse ensaio. A carga sintética foi gerada sem custo de triggers FK; regras de integridade foram verificadas em testes separados com constraints normais. Não representa ingestão via API nem SLA de Supabase/produção.

## 24. Build

Typecheck sem erros. Lint configurado conforme o padrão Next.js, sem erros e sem avisos novos; foram identificados dois imports antigos não utilizados em `history/batch-table.tsx` e `scanner/success-popup.tsx`, preservados para não alterar a conferência/histórico por causa desta entrega. Build de produção compilou as novas rotas; a página ABC acrescentou aproximadamente 8,57 KB de página/115 KB de primeiro carregamento no primeiro build validado. [Configuração oficial de lint do Next.js 15](https://nextjs.org/docs/15/app/api-reference/config/eslint).

## 25. Limitações

- Olist 1/3 ainda não autorizadas e nenhum backfill executado em produção. Uma amostra real de detalhe de pedido respondeu HTTP 200 e confirmou os campos de pedido/itens/origem. A listagem sem recorte teve timeout; notas, catálogo, marcadores, permissões e abrangência completa do histórico **REQUEREM VALIDAÇÃO EXTERNA**.
- NF é base de pedidos com nota vinculada validada, não todas as notas autônomas. Receita é bruta dos itens; não há líquido após devoluções, CMV, lucro, estoque ou ajuste arbitrário de valores.
- Marketplaces/lojas/contas precisam de classificação quando a API não os identifica de modo confiável. Produto equivalente entre empresas requer vínculo explícito futuro.
- Cobertura histórica indica períodos concluídos; erros e última importação continuam visíveis. Incremental está sujeito à disponibilidade da API e do cron, não é processamento instantâneo de webhook. O webhook operacional antigo foi preservado.
- CSV retorna todas as entidades de um snapshot SQL, mas materializa o agregado no servidor; XLSX tem limite explícito de 50 mil entidades. Milhões de entidades distintas exigem exportação assíncrona/Storage e agregados adicionais. Paginação de origem por offset não oferece snapshot documentado; conciliar períodos recentes quando necessário.
- Navegador integrado indisponível nesta sessão. Interações foram verificadas em DOM; inspeção visual em navegador real, responsividade fina e latência no ambiente publicado permanecem validações de ativação. Sem demonstração fictícia de dados reais.

## 26. Próximas etapas

Seguir o guia de implantação: aplicar v11, publicar, cadastrar/identificar as três empresas, criar aplicativos privados e autorizar Olist 1/3, confirmar permissões/CNPJs, importar um período conhecido e comparar totais com cada ERP, depois ampliar histórico e ativar a rotina com Vault. Medir volume real antes de grandes importações; revisar períodos/origens e confirmar deduplicações por conta comprovada. Evoluções posteriores: vínculo explícito entre produtos equivalentes, ledger de devoluções, notas autônomas, matriz empresa/canal e exportação assíncrona de grandes agregados.

## MULTI-OLIST STATUS

| Instância | Empresa | Situação |
| --- | --- | --- |
| Olist 1 | 13.397.731/0001-64 | Suporte implementado; criar aplicativo e concluir autorização independente. |
| Olist 2 | 36.965.322/0001-12 | OAuth existente preservado; CNPJ confirmado por `/info`; migração/backfill analítico pendentes. |
| Olist 3 | 37.201.039/0001-87 | Suporte implementado; criar aplicativo e concluir autorização independente. |

**Necessita aplicativo separado? SIM para contas ERP distintas, conforme a documentação de aplicativos privados.**

**Necessita OAuth separado? SIM por conta adicional.**

Se houver estrutura de filiais acessível dentro da mesma conta, sua abrangência e identidade requerem confirmação da Olist; não foi presumida como solução para acessar outras contas.

**O FLUXO DE CONFERÊNCIA EXISTENTE FOI ALTERADO? NÃO.** A navegação recebeu a nova seção e o Ninho ganhou controles analíticos. Scanner, regras de bipagem, cache/reconciliação operacional, OAuth atual, webhooks e cron antigos foram preservados. As mudanças são aditivas; credenciais e histórico operacional foram testados quanto à preservação na migração/rollback.
