# Padronização leve do aplicativo — 21/10/2026

Base: `cd8c5902`, após o redesign da Curva ABC.

- Páginas autenticadas compartilham agora o contêiner de até 1600 px, padding responsivo de 16/24/32 px e cabeçalho com espaçamento compacto. Sidebar, autenticação e tipografia mantidas.
- Preparação, pedidos, histórico e bipagem receberam pequenos ajustes de alinhamento, espaçamento, quebra de ações em telas pequenas e contenção das tabelas. A lista de pedidos tem cabeçalho fixo na rolagem interna. Nenhum fluxo operacional foi alterado.
- Ninho usa abas no padrão visual da ABC, com navegação por setas, Home e End. Perfis e permissões, Equipe da colmeia e Adicionar à colmeia começam recolhidos. Nomes, e-mails, matriz de acessos e formulário aparecem ao expandir o bloco correspondente. As edições são preservadas ao recolher, e abrir/recolher não salva alterações.
- Cards A, B e C têm o fundo inteiro nas cores anteriormente usadas nos títulos: âmbar claro, amarelo claro e cinza claro. O gráfico permanece intacto.

Validação: **344 testes passaram**, lint, TypeScript, build de produção e `git diff --check`. O build foi executado em worktree temporário para preservar os artefatos `.next` do workspace principal. Os testes de permissões e de revogação de acesso continuam passando.

A verificação em Chromium usou o AppShell e componentes reais com autenticação/APIs simuladas exclusivamente no harness temporário local. Foram conferidas seis rotas (`/`, `/orders`, `/history`, `/scanner`, `/ninho` e `/analytics/abc`) em 320, 390, 768, 1440 e 1920 px: 30 combinações sem overflow horizontal da página ou erros JavaScript. Essas capturas usam dados de teste e não representam uma sessão autenticada em produção.

Evidências:

- [Usuários recolhidos — desktop](evidencias/padronizacao-app/usuarios-recolhidos-1440.png)
- [Usuários recolhidos — celular](evidencias/padronizacao-app/usuarios-recolhidos-390.png)
- [Equipe expandida — celular](evidencias/padronizacao-app/equipe-expandida-390.png)
- [Cards ABC](evidencias/padronizacao-app/cards-abc.png)
- [Medições](evidencias/padronizacao-app/verificacao.json)

Sem mudanças em SQL, APIs, integrações, fonte global ou cálculos ABC. Alterações locais, ainda sem publicação na Vercel.
