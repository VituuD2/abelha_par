# Validação da correção de permissões do Ninho

Data: 19/10/2026. Windows/PowerShell, Node.js, Next.js 15, testes Node/React/JSDOM e PostgreSQL isolado da suíte existente. Nenhuma alteração de conta, papel, banco ou implantação em produção nesta correção.

| Comando | Resultado | Log |
| --- | --- | --- |
| `npm test` antes da alteração | 153 aprovados / 155; 2 falhas anteriores da interface ABC | [Baseline](baseline.log) |
| `node --test tests/ninho-access.test.cjs tests/session-access.test.cjs tests/sidebar-access.test.cjs tests/analytics-api.test.cjs tests/permissions-boundaries.test.cjs tests/app-shell-permissions.test.cjs` | **25 aprovados, 0 falhos** | [Permissões](focused.log) |
| `npm test` após a alteração | **159 aprovados / 161; as mesmas 2 falhas anteriores** | [Suíte completa](tests.log) |
| `npm run typecheck` | Exit 0, sem erro de tipos | [TypeScript](typecheck.log) |
| `npm run lint` | Exit 0, 0 erros, 6 avisos preexistentes: quatro do bloco removido na ABC e dois antigos em histórico/scanner | [Lint](lint.log) |
| `npm run build` | Exit 0; compilação/checagens/rotas concluídas | [Build](build.log) |

Os avisos `NativeCommandError` de captura do PowerShell associados a `npm notice` em stderr não são resultados de testes; considerar os sumários e exit codes acima.

As duas falhas de ABC esperam textos de cobertura/progresso removidos por uma edição local anterior desta conversa. O arquivo `abc-dashboard.tsx` permaneceu com essa edição; esta correção não restaurou o bloco, não mudou expectativas desses testes nem ignorou falhas.

Casos novos: política nega papéis/permissões desconhecidos; middleware nega operador/inativo/banco indisponível; página e layout negam acesso mesmo sem middleware; rebaixamento do mesmo usuário consulta vínculo novamente; role em metadados não concede administração; interface invalida confirmação da rota antes de receber resposta; respostas antigas não restauram administração; conteúdo privado não monta para operador com layout antigo; revogação com a tela aberta retira Ninho sem refazer propriedade dos estados operacionais.

O navegador integrado não estava disponível (descoberta retornou `[]`), portanto não houve Playwright real/screenshot nem validação com login produtivo. A UI foi exercitada em DOM e os limites do servidor por chamadas de handlers/middleware/componentes. A aprovação produtiva depende de publicar a aplicação e testar uma conta com vínculo `operator`.

Detalhes de arquitetura e ativação: [relatório de permissões](../../ninho-permissoes-2026-10-19.md).
