# Evidências da auditoria de 16/10/2026

Relatório principal: [auditoria do Néctar](../../curva-abc-auditoria-2026-10-16.md).

Ambiente local Windows/PowerShell, Node v24.18.1; Next 15.5.27, React 19.2.8, TypeScript 5.9.3. PostgreSQL isolado via PGlite em memória. Banco/ERP publicado consultados apenas em leitura usando configuração local existente, sem imprimir tokens ou payloads pessoais.

## Comandos executados e resultados

| Comando | Resultado | Evidência |
| --- | --- | --- |
| `npm test` antes de editar | 144 aprovados, 0 falhos, 0 ignorados | [Baseline](audit-baseline-tests.log) |
| `node --test tests/analytics-audit.test.cjs` | 2 aprovados; oráculo independente e integração com SQL/CSV/XLSX | [Integração](audit-integration-tests.log) |
| `node --test tests/analytics-ui.test.cjs` | 8 aprovados, incluindo resposta obsoleta e falha de exportação | [DOM](audit-ui-tests.log) |
| `node --test tests/analytics-sync.test.cjs tests/analytics-provider.test.cjs` | 12 aprovados, 0 falhos | [Falhas/worker](audit-sync-errors.log) |
| `npm test` final | **155 aprovados, 0 falhos, 0 ignorados**; 11 testes a mais que baseline | [Suíte final](audit-final-tests.log) |
| `npm run typecheck` | Exit 0, sem erro de tipos | [Typecheck](audit-final-typecheck.log) |
| `npm run lint` | Exit 0, 0 erros; 2 warnings anteriores em history/scanner | [Lint](audit-final-lint.log) |
| `npm run build` após patch de dependência | Exit 0, rotas compiladas; ABC 10,2 kB / 117 kB first load | [Build](audit-final-build.log) |
| `npm audit --json` | Exit 1, 6 alertas altos | [Antes](audit-dependencies.json) |
| `npm update source-map-js --ignore-scripts` | Exit 0; 1.2.1 → 1.2.2, somente um pacote | [Atualização](audit-dependency-update.log) |
| `npm audit --json` após atualização | Exit 1, **5 alertas altos restantes**, cadeia de lint | [Depois](audit-dependencies-after.json) |
| `node scripts/audit-analytics-readonly.cjs` | GETs de schema/dados/RPCs permitidas e HTTP público; sem agendar/importar | [Ambiente](ambiente-readonly.json) |
| `node scripts/audit-analytics-source.cjs` | `/info` três contas e cinco detalhes bloqueados; normalização original falhou em produto zero | [Causa raiz](fonte-bloqueios.json) |
| `node scripts/audit-analytics-reconcile.cjs` | 252 detalhes + 4 páginas; 2,1s por conta; dados pessoais/IDs comerciais não registrados | [Reconciliação](reconciliacao-2026-10-08.json) |
| `node scripts/audit-analytics-reconcile.cjs 2026-10-08 --database-only` | Reconta banco com situações 1/5/6 independentes da fonte; nenhuma nova chamada Olist | Mesmo JSON, `databaseComparedAt` |
| `node scripts/benchmark-analytics.cjs` | Seeds 10k/50k/100k e EXPLAIN ANALYZE apenas no PGlite; nenhum acesso remoto | [Benchmark](benchmark-isolado.json) |
| `git diff --check -- src tests scripts supabase docs package-lock.json` | Sem erro de whitespace; avisos de normalização CRLF do Git | Conferido no terminal |

Os logs npm capturados no PowerShell contêm invólucros `NativeCommandError` para mensagens `npm notice` em stderr. O êxito é determinado pelo exit code/resultado dos comandos e pelo sumário do teste/build, não pela presença dessa palavra no log.

## Reprodução segura

Os testes e o benchmark não carregam `.env`, não acessam ERP/Supabase remoto e não persistem o banco de teste. O fixture cria schema/roles e aplica as migrations no PGlite em memória; testa o SQL de produção sem executar SQL no servidor publicado.

Os três scripts de auditoria remota requerem configuração `.env` já autorizada (`SUPABASE_SERVICE_ROLE_KEY`, configuração pública do projeto, `TOKEN_ENCRYPTION_KEY` e `APP_URL`). Não copie valores para comandos ou relatórios. Eles usam GET e não chamam refresh, enqueue, ingest, `ensure_coverage` ou claim. `audit-analytics-readonly` usa exclusivamente as RPCs STABLE allowlisted `analytics_abc`/`analytics_coverage` via GET, nunca rotinas que alteram estado. A reconciliação fonte pode levar vários minutos e consome limite da API compartilhado por conta. Reexecutar substitui os snapshots locais e os valores podem mudar na fonte; preservar esta evidência se houver necessidade de histórico.

Para uma nova reconciliação completa, executar os dois comandos (fonte e `--database-only`) na sequência. O segundo aplica os estados elegíveis persistidos independentemente dos estados atuais da fonte; sem ele o subtotal pareado da primeira etapa não representa necessariamente o valor exibido pelo dashboard. Isso foi mantido explícito no JSON em `comparison` e `dbGrossMatchedCurrentEligibleCents`.

O SQL [audit_analytics_readonly.sql](../../../supabase/audit_analytics_readonly.sql) foi preparado, mas **não executado** no projeto remoto; precisa de editor SQL/acesso aos schemas cron/net. Não usar migrations/setup de cron como “consulta”, pois eles alteram estado e o setup de cron dispara trabalho.

## Limitações

- Navegador indisponível após tentativa de conexão e troubleshooting; nenhuma screenshot e nenhum E2E Playwright real executado.
- Testes DOM usam React/JSDOM; integração de handlers usa Requests/Responses e banco SQL isolado, sem login HTTP/browser real. OAuth e APIs de worker são simulados nesses testes.
- Comparação produtiva foi leitura atual de um dia fechado e snapshots em horários diferentes. Não comprova todo o histórico, notas/devoluções ou ausência de duplicidade comercial entre fontes não mapeadas.
- PGlite serializa consultas em uma conexão; não certifica concorrência PostgreSQL, latência Vercel ou memória de produção. Não houve seed de 500k.
- Cron/net não estão expostos via REST (PGRST106); não se inferiu status HTTP final de um registro de requisição.
- Correções locais não foram publicadas; banco real continua sem os recursos v13. As migrations v13/progresso já estavam no diretório antes da auditoria e foram preservadas.
