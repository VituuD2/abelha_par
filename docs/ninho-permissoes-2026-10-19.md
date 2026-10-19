# Permissões do Ninho — correção de 19/10/2026

O Ninho exige autorização de administrador no workspace ativo. O controle foi centralizado em permissões por ação (RBAC), com decisões obrigatórias no servidor e proteção adicional contra estado antigo no navegador. Nenhuma migração, alteração de perfil real, credencial ou publicação foi executada nesta correção.

## Diagnóstico

O código inicial já negava operadores na página e nas APIs administrativas. Portanto, não foi demonstrado um bypass produtivo dessas APIs. Foi reproduzida uma janela na interface: a sessão mantinha o papel de administrador durante uma nova consulta de permissões, sem vincular a confirmação à rota atual. Um layout reutilizado podia confiar nessa confirmação anterior. O middleware verificava somente login.

Sem uma sessão real do operador afetado e a versão publicada, não é possível atribuir todos os casos relatados a essa janela: publicação antiga ou divergência entre o perfil esperado e `workspace_members.role` também precisam ser consideradas. O novo controle não usa `user_metadata.role`, localStorage ou dados enviados pelo cliente para autorizar operações.

## Política e camadas de proteção

`src/lib/permissions.ts` define a política compartilhada. Papel desconhecido ou permissão desconhecida são negados.

| Permissão | Operador | Administrador |
| --- | --- | --- |
| `app:access` | Sim | Sim |
| `analytics:read` | Sim | Sim |
| `analytics:export` | Sim | Sim |
| `ninho:access` | Não | Sim |
| `members:manage` | Não | Sim |
| `integrations:manage` | Não | Sim |
| `analytics:manage` | Não | Sim |

- **Servidor/API:** `authorize(permission)` autentica a sessão e lê novamente o vínculo ativo no banco em cada requisição. Workspace e papel vêm dessa leitura. Rotas administrativas especificam a permissão da ação; a antiga assinatura booleana `authorize(true)` foi removida. Respostas de negação são privadas e não armazenáveis.
- **Página e subárvore:** `/ninho/page.tsx` e `/ninho/layout.tsx` chamam `requirePagePermission`. A checagem na página permanece mesmo com layout reutilizável. A página é dinâmica. Contornar middleware ou esconder/alterar o menu não concede acesso.
- **Middleware:** `/ninho` e seus descendentes consultam o vínculo via cliente Supabase do próprio usuário, sujeito a RLS. Falha, timeout, vínculo ausente, inativo ou papel sem permissão impedem a entrega normal da página. Não utiliza a chave service role.
- **Navegação:** desktop, mobile e o link de configuração em Pedidos usam a mesma política. O contexto da aplicação disponibiliza `can(permission)`, substituindo o booleano global `isAdmin`. O booleano ainda usado como apresentação dentro do dashboard ABC não autoriza APIs nem a página do Ninho.
- **Sessão/cache:** a confirmação da interface fica vinculada à identidade e à visita atual da rota. A inicialização aproveita a permissão validada pelo servidor. Troca de usuário/logout limpa os privilégios imediatamente. Cada nova entrada no Ninho, inclusive ao voltar ao mesmo endereço, exige nova confirmação antes de montar seu conteúdo. Foco e eventos repetidos da mesma identidade reutilizam a confirmação enquanto válida; ao expirar, uma única consulta em segundo plano mantém o menu estável até a resposta. Respostas antigas não podem restaurar privilégios. Ver [revisão de desempenho do acesso](acesso-desempenho-2026-10-19.md).
- **Revogação com a tela aberta:** a página administrativa revalida a cada 15 segundos; nas demais páginas o prazo é de 60 segundos. O polling fica suspenso em abas ocultas. Foco/retorno de aba revalidam se o prazo expirou e compartilham consultas simultâneas. Uma resposta de negação, falha de verificação ou mudança de identidade remove os privilégios. O servidor nega a próxima requisição após a revogação, independentemente desses intervalos. Não se promete apagamento instantâneo de dados já entregues ou eventos Realtime inexistentes.
- **Banco:** permanecem as proteções existentes da v9: cliente autenticado lê somente seu vínculo; não altera o próprio papel; operações administrativas críticas usam RPCs que verificam administrador/workspace. Não foi adicionado um novo mecanismo de papéis em JWT nem uma tabela duplicada.

Essas separações seguem as recomendações de [autorização do Next.js 15](https://nextjs.org/docs/15/app/guides/authentication) e de [negação por padrão/verificação por requisição da OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html). A política do cliente serve à apresentação; a decisão efetiva continua próxima do acesso aos dados, no servidor.

## Testes

Os testes de limite verificam operador/inativo/papel desconhecido, metadados forjados, ausência de vínculo, banco indisponível, preservação de cookies e cache privado. As chamadas diretas à página/layout continuam negadas mesmo sem executar middleware; o mesmo usuário anteriormente admin é consultado novamente após rebaixamento.

O teste de DOM monta `AppShell` e `Sidebar` reais em React/JSDOM. Simula layout de administrador em cache, entrada no Ninho com validação pendente e posterior resposta de operador; o componente privado não monta. Também abre como admin, revoga a permissão e verifica retirada das configurações e links. Revalidação de papel não refaz o vínculo de propriedade dos estados de preparação/bipagem. Testes existentes continuam cobrindo troca de usuário, logout, respostas fora de ordem e permissões das APIs operacionais.

Comandos e resultados finais estão em [evidências de permissões](evidencias/ninho-permissoes-2026-10-19/README.md).

Antes da alteração, `npm test` tinha **153 aprovados e 2 falhos em 155**. As duas falhas são de `analytics-ui.test.cjs`: os testes esperam progresso/cobertura que foram removidos do dashboard em uma edição local anterior. Essa edição foi preservada; testes não foram removidos, ignorados ou adaptados para esconder a falha. A suíte após esta correção tem seis testes adicionais de sessão/fronteiras/DOM.

Navegador real indisponível: a descoberta retornou lista vazia. Não houve teste visual nem sessão real de operador em produção; os testes de DOM/handlers não são apresentados como E2E produtivo.

## Ativação e verificação

Não exige nova migration. Publicar a aplicação completa para levar política, middleware, páginas, endpoint de sessão e cliente juntos. Depois, com uma conta realmente `operator` em `workspace_members`, confirmar menu desktop/mobile sem Ninho, acesso direto `/ninho` redirecionado e chamadas administrativas retornando 403. Repetir com admin e depois rebaixar o mesmo usuário com a tela aberta. A leitura/exportação ABC e o trabalho operacional do operador devem continuar disponíveis.

Se o comportamento produtivo divergir, verificar primeiro qual release foi publicada e o vínculo ativo do usuário; editar metadados do Auth não substitui o papel do workspace. Não promover/rebaixar usuários reais por SQL como parte de um teste sem autorização específica.
