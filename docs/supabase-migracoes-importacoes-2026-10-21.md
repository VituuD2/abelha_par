# Supabase: SQL necessário para as importações — 21/10/2026

**Não foi identificada uma migração ausente nos contratos usados pelo aplicativo. Não há indicação, nesta verificação, para reaplicar os SQLs existentes ou executar o rollback da v23.** Os gargalos de varredura e a classificação incorreta de espera como HTTP 503 continuam sendo problemas do processamento descritos na [análise de importações](importacoes-requisicoes-gargalos-2026-10-21.md).

**Atualização posterior:** a solução implementada depois desta auditoria acrescentou uma nova migração, a v24. Ela foi executada pelo responsável, confirmada no banco às 12h24 e publicada com o novo worker às 12h45. A [implantação da solução](implantacao-importacoes-v24-2026-10-21.md) registra as mudanças e sua observação. A conclusão abaixo descreve o estado anterior a essa implementação; não é indicação de que recursos novos dispensem sua própria migração.

Consulta ao projeto configurado no `.env`, exclusivamente por GET/HEAD, entre aproximadamente **11h57m40s e 11h57m46s**, horário de São Paulo. Sem executar migrações, workers, reservas de cota ou renovação OAuth. Leituras não compartilham snapshot transacional. Evidências: [schema e verificações funcionais](evidencias/supabase-schema-20261021145740/status.json) e [filas, contas e disparos](evidencias/importacao-ritmo-20261021145740/status.json).

## O que está disponível

| Área / SQL | Verificação em produção | Ação indicada agora |
| --- | --- | --- |
| v8: renovação operacional | Colunas `refresh_lock`, `refresh_locked_until` e `refresh_expires_at` acessíveis sem ler credenciais | Nenhuma reaplicação indicada |
| v13: importação paralela | Funções de reserva/agendamento presentes; `last_claimed_at`, `query_phase` e `covers_sales` acessíveis | Nenhuma reaplicação indicada |
| v18/v19: CMV e histórico | Tabelas e funções esperadas presentes; consulta de status retornou 119 históricos com sincronização registrada, zero pendentes vencidos e sem erro | Nenhuma reaplicação indicada |
| v21: cálculo histórico | `analytics_abc_components_v21` executou em leitura sem erro; guardas da política de cálculo foram aceitas | Nenhuma reaplicação indicada |
| v22: Pareto completo | Tanto `analytics_abc` como `analytics_abc_components_v21` retornaram **582 pontos**, com 582 entidades e tabela limitada a uma linha | Comportamento da v22 confirmado nos dois caminhos testados |
| v23: consumo e controle | Cinco tabelas e quatro funções presentes; `olist_api_usage` executou sem erro e trouxe as três contas | Nenhuma reaplicação indicada |
| Cron analítico | Quinze registros recentes de disparo, um por minuto; último às 11h57 | Sem indicação de reinstalar o agendamento |
| Limpeza de registros | Nenhum registro de cron, minutos ou amostras anterior a 48 horas; nenhuma reserva anterior a uma hora | Sem necessidade de limpeza manual demonstrada |

Os relatórios foram consultados de 01/08 a 21/10, por quantidade e situações 1/5/6. Para testar o caminho composto foi usado um mapa vazio: isso verifica a presença, as guardas e o Pareto da função, **não** reconcilia as regras reais de composição ou todos os valores de CMV. As duas leituras levaram aproximadamente 1,23 e 1,39 segundo, incluindo rede; não constituem teste de capacidade.

O status de histórico de CMV define `completed` como registros com `last_synced_at` preenchido e `pending` como os que já venceram seu próximo horário. Portanto, 119/119 e zero pendentes não significam que não existam revisões futuras agendadas.

O monitor retornou os limites atualmente configurados: Olist 1, plano 120/min e app 60/min; Olist 2 e 3, plano 60/min e app 36/min. Os limites efetivos coincidiram com os limites do app. Não há necessidade identificada de executar um `UPDATE` nas políticas para que o sistema continue funcionando.

## O que ainda precisa de inspeção pelo SQL Editor

Os schemas `cron`, `net` e `supabase_migrations` não estão expostos pela API REST: as consultas retornaram `PGRST106`. Isso não indica que estejam ausentes ou quebrados. Não é necessário expor esses schemas para realizar esta verificação.

Por esse acesso, não foi possível confirmar as definições completas das funções, constraints de valores negativos da v20/v21, índices, RLS/grants no catálogo, configuração atual do cron de renovação operacional ou suas respostas HTTP. A presença das funções `invoke_analytics_sync` e `invoke_olist_token_refresh` não prova, isoladamente, que ambos os schedules estejam ativos. Os registros por minuto comprovam disparos recentes do analítico, e os processamentos recentes acrescentam evidência de execução; não provam sucesso integral de cada ciclo.

Deixei [audit_importacoes_schema_readonly.sql](../supabase/audit_importacoes_schema_readonly.sql) para essa conferência complementar no SQL Editor. É **diagnóstico opcional, não uma migração**: usa transação somente leitura e encerra com `ROLLBACK`. Não chama as funções que disparam cron, não mostra valores do Vault e não altera dados. Ele foi validado em PostgreSQL local embarcado com estruturas simuladas; **não foi executado no Supabase de produção**.

Ao conferir os resultados:

- As funções esperadas devem estar presentes. Funções exclusivas do servidor não devem permitir execução por `anon` ou `authenticated`; os dois disparadores de cron também não concedem execução ao `service_role` no SQL original.
- As duas definições da v22 devem indicar Pareto completo e ausência do limite antigo de sessenta pontos.
- A v20 preserva quantidade positiva e coerência do sinal, permitindo preço e valor de item negativos. A v21 retira as restrições que impediam custo cadastral e total de pedido negativos. Conferir as definições antes de recomendar reaplicação; o teste de leitura não valida constraints de escrita.
- O cron analítico deve estar ativo em `* * * * *`; o operacional, em `15 * * * *`. Os dois nomes de Vault devem ter uma entrada cada. Se o cron operacional estiver realmente ausente, o arquivo correspondente é `setup_olist_token_cron.sql`; se o analítico estiver ausente, `setup_analytics_cron.sql`. **Ambos os arquivos de instalação fazem uma primeira chamada imediatamente**, portanto não são scripts de simples consulta.
- HTTP 401 demanda investigar autorização do cron. HTTP 503 precisa ser cruzado com os resultados dos lotes, conforme a análise da Vercel; não comprova migração ausente.

Se algum objeto estiver realmente faltando ou incompatível, aplicar somente a migração correspondente, respeitando seus pré-requisitos. Não há evidência nesta auditoria para fazer isso preventivamente.

## Manutenção e rollback

O `rollback_v23_olist_api_usage.sql` remove as funções e tabelas de cota/telemetria e **apaga o histórico de consumo**. Preserva pedidos, custos e jobs, mas faz o app voltar ao ritmo conservador de contingência. É uma reversão deliberada da funcionalidade, não uma tarefa para manter o banco atualizado.

A retenção atual já ocorre no fluxo normal: o cron conserva aproximadamente dois dias de disparos; a v23 conserva 48 horas de minutos/amostras e remove reservas antigas em limpezas periódicas por conta. Não foi identificado acúmulo que justifique `DELETE`, reset de fila ou manutenção manual. Essa retenção depende da continuidade dos respectivos fluxos; contas inativas podem conservar registros até voltarem a passar pelo controle.

A inspeção opcional também mostra estimativas de linhas mortas e os horários de manutenção automática. Não há medição nesta auditoria que justifique `VACUUM FULL`, reconstrução de índices ou mudança de autovacuum. A documentação do Supabase descreve como inspecionar espaço e manutenção antes de propor ajustes: [tamanho do banco e disco](https://supabase.com/docs/guides/platform/database-size).

Os arquivos deste repositório são SQLs versionados manualmente, fora da pasta convencional `supabase/migrations`. O ledger remoto não pôde ser consultado. Não se deve presumir que uma publicação na Vercel executa esses arquivos nem que o número no nome do arquivo prova sua aplicação. Alterações pelo SQL Editor também não equivalem ao registro de migrações gerenciadas pela CLI: [documentação oficial de migrações](https://supabase.com/docs/guides/deployment/database-migrations). Nesta revisão, a conclusão se baseia nos objetos acessíveis e no comportamento observado.

Para repetir a parte REST desta inspeção: `node scripts/analytics-schema-readonly.cjs` e `node scripts/analytics-progress-readonly.cjs`. O primeiro bloqueia métodos diferentes de GET/HEAD. Nenhum deles faz consultas ao ERP.
