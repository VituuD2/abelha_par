# Timeouts intermitentes — 22/10/2026

Horários abaixo em Brasília (UTC−03). Investigação remota somente de leitura, no projeto `mijtkzdubslabcwjjfoc`. Não houve alteração de banco ou publicação do aplicativo durante a investigação.

## Evidências

O navegador limitava `/api/auth/access` e `/api/analytics/api-usage` a 10 segundos. As duas rotas verificam primeiro a sessão no Supabase Auth e depois o vínculo em `workspace_members`. Portanto, o erro variar conforme a página é compatível com uma dependência comum de autenticação lenta.

Foram consultados os logs de 09h50 a 10h10. Uma amostra detalhada de 09h54 a 09h57 contém 405 chamadas ao gateway, todas com HTTP 2xx. HTTP 200 não significa que o navegador recebeu a resposta antes do seu próprio timeout.

| Início registrado no gateway | Chamada | Resposta | Duração de origem |
| --- | --- | --- | --- |
| 09:54:03.659 | `/auth/v1/user` | 200 | 7.141 ms |
| 09:55:03.731 | `/auth/v1/user` | 200 | 13.585 ms |
| 09:55:14.421 | `/auth/v1/user` | 200 | 11.126 ms |
| 09:55:17.333 | `/rest/v1/workspace_members` | 200 | 9.304 ms |
| 09:55:26.656 | `/rest/v1/analytics_companies` | 200 | 6.522 ms |
| 09:56:08.434 | `/rest/v1/analytics_connections` | 200 | 6.254 ms |

Essas chamadas não foram correlacionadas individualmente aos requests do navegador: os headers enviados não contêm status de resposta, duração ou identificador de rastreio. A evidência confirma picos de latência superiores ao prazo do frontend, mas não permite atribuir a origem da lentidão a CPU, memória, rede ou incidente do fornecedor.

Não apareceram mensagens contendo `error`, `timeout` ou `fatal` nos logs de Postgres, Auth e PgBouncer pesquisados entre 09h50 e 10h10. Isso não exclui lentidão: chamadas bem-sucedidas também podem ultrapassar o prazo do cliente.

O histórico `analytics_cron_runs` associado a `net._http_response` mostrou erros intermitentes do worker: controle de consultas Olist indisponível, leitura da conexão analítica indisponível e falha de gravação. Às 09h55, houve HTTP 503 com retomada prevista do checkpoint. Às 10h00, o chamador pg_net registrou timeout de 55.000 ms. Esses registros pertencem ao processamento em segundo plano; não provam que o worker causou a latência da autenticação.

## Correções no código

- Prazo do navegador para acesso e monitor de consumo: 35 segundos, cobrindo autenticação de até 20 segundos, vínculo de até 10 segundos e leitura de consumo de até 3 segundos.
- Prazo das consultas da tela analítica: 50 segundos. Status usa leituras paralelas com limite de 8 segundos e uma eventual leitura posterior dos metadados da integração legada, também limitada a 8 segundos.
- Prazo total de autenticação de 20 segundos, incluindo inicialização e novas tentativas do SDK. Chamadas HTTP da autenticação também recebem sinal de cancelamento.
- Falha temporária de Auth retorna indisponibilidade (503); sessão ausente ou inválida continua sem autorização. O middleware deixa de interpretar falha temporária como necessidade de login.
- Falha na verificação de acesso continua removendo privilégios até nova confirmação. A tela oferece “Tentar novamente” sem exigir logout e mantém a recuperação automática existente.
- Logs estruturados `supabase_request` registram chamadas lentas (a partir de 3 segundos), falhas, caminho, método, status, duração e identificador de requisição quando disponível. Não registram query string, tokens, cookies ou payloads.
- `/api/auth/access` e `/api/analytics/api-usage` declaram duração máxima de 60 segundos na Vercel; os prazos internos continuam menores.

Os novos prazos toleram os picos observados e limitam esperas. Não tornam a infraestrutura mais rápida nem garantem disponibilidade durante uma falha prolongada. A validação em produção depende da publicação dessas mudanças.

## Onde consultar

1. **Vercel → projeto abelha-par → Logs**: filtrar pela rota e pelo intervalo de horário. Depois da publicação, procurar também `supabase_request`; `requestId` ajuda a localizar a chamada correspondente no gateway.
2. **[Supabase → Logs](https://supabase.com/dashboard/project/mijtkzdubslabcwjjfoc/logs/explorer)**: API Gateway mostra a duração e o status de Auth e REST. Procurar `/auth/v1/user` e `/rest/v1/workspace_members`, além das RPCs da página. Conferir o fuso usado no painel.
3. **Supabase → SQL Editor**: o histórico do cron pode ser consultado sem executar novamente os workers:

```sql
select
  r.requested_at at time zone 'America/Sao_Paulo' as horario_brasilia,
  h.status_code,
  h.timed_out,
  h.error_msg,
  h.content::jsonb -> 'renewal' as renewal,
  h.content::jsonb -> 'costs' as costs,
  h.content::jsonb ->> 'error' as error
from public.analytics_cron_runs r
join net._http_response h on h.id = r.request_id
where r.requested_at >= '2026-10-22T12:50:00Z'
  and r.requested_at < '2026-10-22T13:10:00Z'
order by r.requested_at;
```

O histórico tem retenção limitada: ausência futura desses registros não significa ausência de incidentes. Para o SDK, a opção de transporte `global.fetch` está descrita na [documentação oficial](https://supabase.com/docs/reference/javascript/initializing).
