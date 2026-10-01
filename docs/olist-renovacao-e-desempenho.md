# Olist: renovação automática e redução de consultas

Implementação local de 01/10/2026. A migração v8, a publicação e o agendamento precisam ser ativados no ambiente de produção. O código não configura esses serviços remotamente.

## Diagnóstico confirmado

- A [documentação OAuth da Olist](https://api-docs.erp.olist.com/documentacao/comecando/autenticacao) informa acesso por 4 horas e refresh token por 1 dia. Esses prazos também foram observados nos metadados da conexão desta operação.
- A renovação anterior dependia de alguém usar o aplicativo. O cron diário não oferece margem suficiente para um refresh de 24 horas. Duas instâncias também podiam trocar o mesmo refresh simultaneamente.
- A preparação buscava a lista e depois consultava todos os detalhes, com intervalo de 2,1 segundos. Na amostra real, uma listagem trouxe 84 pedidos em 492 ms; os campos necessários já estavam nela. Esta é uma medição de uma requisição, não uma promessa de tempo total nem um benchmark de produção da versão nova.
- O cabeçalho da conta informou limite de 60 leituras por minuto. O limite é [compartilhado entre aplicativos da mesma conta](https://api-docs.erp.olist.com/documentacao/comecando/limites-de-consulta). A correção economiza chamadas; não aumenta artificialmente a concorrência.

## Mudanças

- A listagem é salva no cache pelo servidor. No caso normal, 100 pedidos passam de 1 consulta de lista + 100 consultas de detalhe para apenas 1 consulta de lista. Outros canais ainda contam na paginação do ERP.
- Campos realmente ausentes usam a consulta de detalhe como alternativa. Rastreio explicitamente vazio continua sendo um pedido válido aguardando etiqueta; sua atualização durante a bipagem continua ativa.
- A descoberta incremental também aproveita a lista e só enfileira detalhes incompletos. Webhooks continuam buscando os pedidos alterados individualmente.
- A consulta normal de status deixa de acessar `/pedidos`. O diagnóstico explícito continua disponível em `/api/auth/status?verify=1` para um usuário autenticado.
- A renovação reúne requisições simultâneas na mesma instância e usa uma reserva no banco entre instâncias. A gravação compara o token anterior e a reserva, para não sobrescrever uma reconexão mais recente.
- Falhas de banco, rede, limite da API e `invalid_client` não são tratadas como autorização expirada. Após uma troca bem-sucedida, a aplicação tenta gravar o mesmo par até três vezes, sem repetir a troca OAuth.
- O agendador verifica a conexão a cada hora e renova quando o acesso vencerá nos próximos 65 minutos ou o refresh nas próximas 6 horas. As novas credenciais e os prazos retornados pela Olist são persistidos criptografados.

## Ativar na Vercel Hobby

O cron nativo da [Vercel Hobby é limitado a uma execução diária](https://vercel.com/docs/cron-jobs/usage-and-pricing). Por isso o agendamento horário usa [Supabase Cron + pg_net + Vault](https://supabase.com/docs/guides/functions/schedule-functions), chamando o endpoint da aplicação. O cron diário de sincronização de pedidos permanece separado.

1. No SQL Editor do Supabase, execute `supabase/migration_v8_olist_token_refresh.sql` **antes de publicar**. Ela preserva os tokens e adiciona as duas colunas da reserva. Pode ser executada novamente.
2. Configure `CRON_SECRET` no ambiente **Production** da Vercel. Use o valor gerado no `.env` local, mantendo o mesmo valor nos dois lugares. Não use prefixo `NEXT_PUBLIC_`. Preserve `TINY_CLIENT_ID`, `TINY_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` e, especialmente, `TOKEN_ENCRYPTION_KEY`.
3. Publique o código. Variáveis novas da Vercel só entram no próximo deployment.
4. No Vault do Supabase, crie ou atualize os segredos:

   | Nome | Valor |
   | --- | --- |
   | `abelha_par_app_url` | `https://abelha-par.vercel.app` (URL de produção) |
   | `abelha_par_cron_secret` | Mesmo `CRON_SECRET` da Vercel e do `.env` |

   Esses valores não são o token OAuth da Olist. Não altere as credenciais armazenadas em `tiny_integrations` manualmente.
5. Execute `supabase/setup_olist_token_cron.sql`. Ele ativa `pg_cron` e `pg_net`, agenda a chamada a cada hora no minuto 15 e faz uma chamada imediata. Caso o projeto exija habilitar as extensões pelo painel, habilite-as e repita o script. O Vault deve estar disponível.
6. Aguarde alguns segundos e confira o resultado HTTP no SQL Editor:

   ```sql
   select id, status_code, timed_out, error_msg, content
   from net._http_response
   order by created desc
   limit 5;
   ```

   Identifique o `request_id` retornado pelo script. Esperado: HTTP **200**, `ok: true`. `renewed: 0` é normal quando o token ainda não precisa ser renovado. O cron mostrar “succeeded” sozinho confirma apenas o enfileiramento da chamada HTTP.
7. Se o resultado indicar `reconnect > 0`, conecte a Olist mais uma vez pelo app: um refresh que já expirou não pode ser recuperado. Nas execuções seguintes, observe a atualização automática de `updated_at`, `expires_at` e `refresh_expires_at` em `tiny_integrations`, sem copiar as colunas dos tokens.

HTTP 401 indica divergência/ausência de `CRON_SECRET` (ou proteção de acesso na hospedagem). HTTP 404 indica código ainda não publicado. HTTP 503 e `failed > 0` exigem conferir a migração, variáveis e disponibilidade da Olist/banco. A resposta e os logs do endpoint mostram contagens, nunca os tokens.

## Validação e limites

Os testes locais verificam concorrência entre instâncias, falha e repetição da gravação, reconexão durante uma troca, expiração, erros temporários, autorização do cron, uso da listagem, persistência no servidor e permissões SQL. Execute `npm.cmd test`, `npm.cmd run typecheck` e `npm.cmd run build`.

Nesta implementação, os **50 testes**, a verificação TypeScript e o build de produção passaram. O primeiro build encontrou um erro transitório de acesso a um arquivo gerado no Windows; a repetição terminou com sucesso.

A renovação continua dependendo de a Olist aceitar o refresh e fornecer credenciais válidas. Revogação pelo usuário/ERP, políticas de sessão e indisponibilidade prolongada ainda podem exigir reconexão. Não foi solicitado `offline_access`, pois a documentação da integração orienta `scope=openid`.

O banco/agendador precisa continuar ativo, inclusive nos fins de semana. Verifique os resultados HTTP após ativar e no dia seguinte. O endpoint atende até dez conexões vencendo por execução; retorna `morePending: true` e HTTP 503 se for necessário ampliar esse processamento. Essa instalação usa uma conta.

Nenhuma renovação real foi forçada durante a análise e os testes locais. A operação contínua em produção só pode ser confirmada após aplicar o SQL, publicar e observar o agendamento.
