# Acesso: abertura e retorno de janela

A revisão remove a consulta redundante de permissões na abertura quando o servidor já confirmou o acesso e evita que o Ninho desapareça durante revalidações da mesma sessão. Não exige migração. Publicação não executada nesta alteração.

## Causa encontrada

O `AppShell` ignorava a permissão disponível no servidor e começava sem papel confirmado. Depois, eventos de foco, visibilidade, `pageshow`, autenticação e mudança de rota chamavam `/api/auth/access`; várias dessas chamadas invalidavam o papel antes da resposta. Havia dois timers simultâneos no Ninho, de 15 e 60 segundos. O monitor não compartilhava consultas em andamento.

Uma troca de janela podia provocar eventos de foco/visibilidade e uma nova notificação `SIGNED_IN` para o mesmo usuário. Isso iniciava consultas redundantes e retirava o link do Ninho enquanto elas respondiam. O SDK Supabase instalado trata a volta à aba em `_onVisibilityChanged`, recupera a sessão em `_recoverAndRefresh` e pode publicar `SIGNED_IN` novamente. O evento não representa necessariamente troca de identidade. [Referência dos eventos](https://supabase.com/docs/reference/javascript/auth-onauthstatechange).

## Comportamento implementado

- O layout obtém o papel a partir da participação ativa no banco e entrega ao navegador apenas `userId` e `role`. A tela inicial utiliza essa confirmação, sem uma consulta adicional a `/api/auth/access`. Se essa confirmação não puder ser obtida, o cliente verifica o acesso antes de liberar a aplicação.
- Autenticação e leitura de participação são compartilhadas por `React.cache` entre componentes durante a mesma renderização no servidor. Esse cache não persiste entre requisições nem usuários; APIs continuam verificando a participação em cada operação. [Escopo do cache do React](https://react.dev/reference/react/cache).
- O navegador guarda a confirmação somente em memória, vinculada ao usuário. O prazo normal é de 60 segundos; dentro do Ninho, 15 segundos. Não há persistência do papel em localStorage, autorização via metadados do usuário ou cache HTTP público.
- Foco, `pageshow`, visibilidade e eventos repetidos da mesma identidade reutilizam uma confirmação ainda válida. Eventos simultâneos compartilham uma única requisição. Durante a consulta normal em segundo plano, não se apaga o papel nem se desmonta a tela. Uma resposta idêntica não publica um novo estado da aplicação.
- Há um timer por rota. O polling e a revalidação por foco/visibilidade só consultam quando a aba está visível. Ao retornar após o vencimento, a consulta ocorre em segundo plano.
- Nova visita ao Ninho exige confirmação específica antes de montar seu conteúdo, mesmo se o usuário acabou de sair do mesmo endereço. A identidade de cada visita impede reutilizar uma autorização de uma visita anterior. Uma consulta antiga não pode confirmar outra rota.
- Troca de usuário, logout e desmontagem cancelam requisições anteriores e descartam suas respostas. Negação, identidade divergente, papel desconhecido e falha na verificação removem os privilégios; nenhuma falha concede acesso. Preparação e bipagem não são reinicializadas por revalidações de papel.
- Middleware, guardas de página/subárvore, APIs e RLS continuam protegendo operações no servidor. A confirmação em memória serve à apresentação; não substitui a autorização das operações administrativas.

Em uma aba visível, isso permite que a apresentação reflita uma revogação na próxima revalidação, sujeita à duração da consulta. A próxima operação no servidor já exige a participação atual. Não há promessa de revogação visual instantânea sem resposta do servidor.

## Verificação

Os testes de DOM montam o `AppShell` e a navegação, simulam foco/visibilidade/`SIGNED_IN`, verificam o número de requisições e preservação dos mesmos elementos da página. A abertura com confirmação do servidor e dez retornos de janela dentro do prazo fazem **zero consultas ao endpoint de acesso**. Depois de 60 segundos, eventos simultâneos geram uma consulta e mantêm o mesmo link do Ninho e o componente operacional montado. Aba oculta não executa o polling; logout remove os links.

Os testes também exercitam entrada e reentrada no Ninho com resposta de rebaixamento pendente, revogação com a tela aberta, papel desconhecido, falha de rede, identidade divergente, cancelamento e respostas antigas. A reentrada não chega a montar o componente privado antes da resposta.

Comando: `node --test tests/session-access.test.cjs tests/app-shell-permissions.test.cjs tests/sidebar-access.test.cjs tests/ninho-access.test.cjs tests/permissions-boundaries.test.cjs tests/session-api.test.cjs` — **31 testes aprovados**. Typecheck, lint e build de produção passaram; o lint mantém quatro avisos anteriores no dashboard analítico. Evidência do build em [producao.json](evidencias/acesso-revalidacao-2026-10-19/producao.json). Não foi medida a latência de abertura com sessão autenticada em navegador real; os testes de DOM não equivalem a um teste físico de Alt+Tab em produção.
