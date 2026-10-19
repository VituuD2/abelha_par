# Busca no Favos de Mel

A pesquisa encontra pedidos de lotes finalizados por nome do cliente, número do pedido ou código de rastreio. Consulta todo o histórico salvo da operação autorizada, inclusive lotes anteriores aos 50 mais recentes. Nomes aceitam diferenças de maiúsculas e acentos. A busca é literal: `%` e `_` não funcionam como curingas.

Os números pesquisáveis são as referências que existem no pedido salvo: `numeroPedido`, `nuvemshopNumber`, `yampiId`, `ecommerceOrderNumber` e `ecommerceChannelOrderNumber`. Um número ausente de um registro legado não é inventado a partir de um ID interno.

Os resultados são agrupados por lote e paginados em 20 lotes, mostrando os pedidos correspondentes ao abrir cada resultado. O primeiro lote encontrado abre automaticamente. A impressão continua sendo do lote completo e identifica isso no botão. Limpar o campo restaura a navegação do histórico, também paginada.

As requisições anteriores são canceladas quando a pesquisa muda; respostas antigas não substituem o resultado atual. Há atraso de 300 ms durante a digitação e pesquisa imediata pelo botão Buscar ou Enter.

## Instalação

Aplicar [migration_v17_batch_history_search.sql](../supabase/migration_v17_batch_history_search.sql) no SQL Editor e publicar o aplicativo atualizado. Essa migração de consulta depende das tabelas e permissões de workspace da v9; não depende das migrações de composição da Curva ABC.

A função usa a identidade da sessão autenticada, valida o vínculo ativo com o workspace e mantém RLS. Não usa o workspace informado pelo navegador. A migração é reaplicável e não modifica os pedidos ou os lotes existentes.

Sem a v17, a listagem sem pesquisa continua disponível; ao pesquisar, a aplicação informa a migração necessária. Não há retorno silencioso de resultados limitados aos últimos lotes.

## Escopo e validação

Somente busca e navegação do histórico. Nenhuma alteração nas regras de bipagem, visibilidade de rastreios, identificação de scanner, permissões operacionais, importação ou finalização de lotes.

Os testes cobrem pesquisa além dos 50 últimos lotes, referências das lojas e da Olist, nome sem acentos, códigos de rastreio, caracteres especiais, paginação, isolamento entre workspaces, usuários bloqueados, consultas não cacheadas, respostas atrasadas e recuperação de erros. O banco isolado executa a migração duas vezes para verificar reaplicação.

Nenhuma migração foi aplicada em produção nesta entrega.

Validação: 24 testes direcionados de busca, API, interface e regressão da bipagem aprovados. TypeScript e build aprovados; lint sem erros, com cinco avisos preexistentes em componentes fora desta feature. Os testes da interface usam DOM simulado. [Evidência do build](evidencias/favos-busca-build.json).
