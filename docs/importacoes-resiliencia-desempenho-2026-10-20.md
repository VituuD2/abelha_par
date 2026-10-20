Análise e correções das importações — 20/10/2026
================================================

As correções estão no código local. A produção foi consultada somente em leitura; não executei workers, renovações OAuth, alterações de fila, migrações ou deploy. Portanto, as medições abaixo retratam o comportamento anterior à publicação destas mudanças. Não há ganho de produção medido depois da correção.

**O que os 503 significam neste aplicativo**

Os snapshots das 14:27 e 14:28, horário de São Paulo, registram `Consulta Olist indisponível (HTTP 503).` em jobs incrementais das contas 2 e 1, respectivamente. A conta 2 voltou a avançar na amostra seguinte. Os cursores e IDs pendentes foram preservados.

O cliente anterior também convertia qualquer erro de rede ou timeout em `AnalyticsApiError(503)`. Assim, essas mensagens antigas não permitem concluir se houve resposta HTTP 503 real da Olist ou se a conexão expirou/falhou. A causa externa exata não está comprovada. Não há evidência nesta investigação para atribuí-la ao Supabase Free.

A rota interna também pode responder 503 porque a renovação de outra conta ou o CMV falhou, mesmo tendo importado pedidos. Um 503 da rota inteira não prova que todas as contas pararam. Preservei esse sinal de falha: retornar 200 indiscriminadamente esconderia problemas operacionais.

Antes, uma exceção na consulta de renovações ou no agendamento incremental abortava a rota antes de processar as filas existentes. Esse ponto foi corrigido.

**Correções implementadas**

| Mudança | Resultado e limite |
| --- | --- |
| Uma repetição local para GETs com 502, 503, 504 ou falha de rede/timeout | Pode recuperar a consulta do pedido atual no mesmo lote, sem repetir as etapas anteriores. Máximo de duas tentativas por consulta. Somente o worker de vendas habilita essa repetição, com prazo explícito. |
| Prazo de execução considerado antes de cada tentativa e depois da espera | A repetição só começa se couber o timeout de 10 segundos. O worker mantém margem para persistência; falta de tempo devolve o trabalho à fila sem marcar erro nem avançar o pedido. |
| Espaçamento e espera preservados | Todas as tentativas passam pelo espaçamento de 2,1 segundos da conta. A espera de repetição inclui variação aleatória; `Retry-After` numérico/data mantém a normalização existente entre 3 e 3.600 segundos. Se não couber no lote, permanece a retomada persistente. |
| Isolamento da renovação preventiva e do agendamento | Falhas nessas etapas são informadas na resposta, mas as filas existentes ainda podem avançar. O worker continua validando a própria autorização e identidade antes de importar. |
| Cache da origem da venda por lote | Pedidos consecutivos da mesma origem e com os mesmos metadados reutilizam o ID já persistido. Mudanças de nome/canal provocam nova gravação. Em teste com três pedidos da mesma origem, as gravações passaram de três para uma; isso não equivale a triplicar a velocidade total. |
| Diagnóstico de erro e métricas por lote | Distingue HTTP real, timeout e rede; preserva códigos/status seguros de falhas na leitura da conexão/empresa no banco. Registra duração do lote, tempo de API, espera, tentativas, falhas e acertos do cache de origem. |

401/403 de chamadas obrigatórias continuam exigindo ação; 429 continua aguardando a fila. Gravações no banco e trocas OAuth não receberam repetição HTTP automática. Os bloqueios por conta/CNPJ, checkpoints e ingestão atômica permanecem. Se a API continuar indisponível, o pedido fica pendente para retomada, sem ser pulado ou marcado como importado.

Os logs `analytics_import_batch` contêm identificadores internos e contadores, sem token, corpo do pedido ou dados de cliente. `apiMs / apiRequests` permite estimar a média de uma amostra de lotes; esses agregados não fornecem p95 de requisições individuais. `elapsedMs - apiMs - pacingMs` inclui banco, autenticação, normalização e outras despesas; não é uma medição exclusiva do banco.

**Ritmo medido em produção**

Observação de **16:47:12 a 16:50:13 de 20/10/2026**, horário de São Paulo: aproximadamente 3,013 minutos. As leituras de jobs e contagens não formam um único snapshot transacional.

| Conta | Pedidos armazenados ao fim, todas as datas/situações | Eventos processados na janela | Novas linhas | Eventos/minuto |
| --- | ---: | ---: | ---: | ---: |
| Olist 1 | 8.874 | 0 | 0 | 0 |
| Olist 2 | 2.312 | 14 | 9 | 4,65 |
| Olist 3 | 4.512 | 14 | 0 | 4,65 |

Total ao fim: **15.698 pedidos armazenados**. Os dados incluem vendas desde julho, portanto não devem ser comparados diretamente ao saldo anterior limitado a agosto–outubro. A janela registrou 28 eventos e nove novas linhas. Processamento inclui atualizações/cancelamentos; a ausência de linhas novas da Olist 3 não significa ausência de trabalho.

A Olist 1 voltou a avançar depois da janela. Às 16:52, o histórico agosto–outubro passou de 6.561 para 6.566 eventos, e o histórico de julho de 171 para 174. A leitura de dois pedidos então pendentes confirmou um item/produto por pedido, produto em cache recente e normalização válida. Não foi reproduzido um pedido inválido ou grande bloqueando permanentemente essa conta. A pausa curta, isoladamente, não identifica sua causa.

A leitura do CMV às 16:51 confirmou catálogo sincronizado às 16:49 e 119 históricos concluídos, sem pendências. O código executa custos antes de vendas e usa o mesmo bloqueio de conta, seguido de cooldown de pelo menos três segundos. Portanto, uma rodada de custos pode retirar a conta do processamento de vendas daquele cron. Isso é uma limitação estrutural a acompanhar, mas não comprova a causa de toda a pausa observada na conta 1.

Os três incrementais criados às 10:57 de 19/10 ainda estavam abertos às 16:50 de 20/10: cerca de **29h53 de tempo decorrido**. Permaneciam nas fases de alterações de 01/10, 06/10 e 05/10. Idade do job não é tempo de CPU contínuo: inclui turnos de outros históricos, pausas e retomadas. A presença de vendas de hoje não prova cobertura completa dos dias anteriores.

Os jobs específicos de vendas de 20/10, já concluídos antes desta observação, mostram o tempo percebido entre agendamento e conclusão:

| Conta | Eventos | Tempo decorrido | Eventos/minuto incluindo esperas |
| --- | ---: | ---: | ---: |
| Olist 1 | 31 | 16min20s | 1,90 |
| Olist 2 | 25 | 9min01s | 2,77 |
| Olist 3 | 14 | 5min08s | 2,73 |

Esses jobs tinham tamanhos e concorrência diferentes. Não constituem benchmark controlado nem medem a latência individual de cada pedido.

**Está lento em relação a integrações semelhantes?**

Está lento para manter vendas recentes próximas do tempo real: uma atualização aberta por quase 30 horas merece mudança de estratégia. Entretanto, o ritmo de aproximadamente cinco eventos por minuto é coerente com as restrições do desenho atual; não é evidência de que o banco esteja processando cada linha lentamente.

Cada pedido costuma exigir detalhe + marcadores, e pedidos com NF acrescentam outra consulta. Há listagens e produtos sem cache. O espaçamento de 2,1 segundos permite cerca de 28,6 chamadas/minuto em execução contínua. Com três chamadas por pedido, o teto simplificado é 9,52 pedidos/minuto, antes de banco, latência, erros e listagens.

A rota declara 60 segundos, mas o aplicativo disponibiliza 45 segundos incluindo preparação e custos. O worker deixa 12 segundos antes de iniciar outra consulta. Isso resulta, no melhor cenário aproximado, em 33 segundos de janela de início de chamadas por minuto: perto de cinco pedidos/minuto com três chamadas. Páginas e aquecimento reduzem o rendimento, e não há promessa de atingir esse teto.

A Olist documenta 30/60/120/140 leituras por minuto conforme o plano, compartilhadas entre aplicativos da conta. O plano efetivo e o uso de outras integrações não foram confirmados. O ritmo de 2,1 segundos já ocupa quase toda a cota de 30/minuto em execução contínua. [Limites oficiais Olist v3](https://ajuda.olist.com/pt_BR/hubs-e-plataformas-via-api/aplicativos-api-v3-configuracoes-e-utilizacao).

| Referência | Comparação útil |
| --- | --- |
| Integração REST com o mesmo limite Olist e dois/três GETs por pedido | Compartilha o mesmo teto de chamadas. Economizar consultas e evitar turnos ociosos ajuda mais que disparar requisições paralelas indiscriminadamente. |
| Shopify Bulk Operations | A plataforma fornece consulta assíncrona e arquivo de resultado, reduzindo paginação e chamadas individuais. É uma arquitetura adequada a histórico volumoso, mas sua velocidade não é transferível para a Olist sem capacidade equivalente. [Documentação Shopify](https://shopify.dev/docs/apps/build/apis/graphql-admin/bulk-operations/queries). |
| Integrações Stripe | A referência útil é controlar tráfego, medir latências e retomar com backoff e variação aleatória. As cotas e os objetos são diferentes; não são um benchmark de pedidos Olist. [Documentação Stripe](https://docs.stripe.com/rate-limits). |

Não foi encontrada nessas fontes uma média pública comparável de “pedidos Olist importados por minuto” com os mesmos campos, plano e infraestrutura. Atribuir uma média de mercado seria inventar precisão. A comparação acima usa limites verificáveis e diferenças de arquitetura.

Como referência matemática, 1.000 eventos a cinco/minuto levam cerca de 3h20 por conta, se o ritmo se mantiver. Isso não é previsão de término: não foi reconciliado o saldo atual por ID, e há reprocessamentos e turnos compartilhados.

**Próximas melhorias de maior impacto**

| Prioridade | Proposta | Condição para preservar a integridade |
| --- | --- | --- |
| 1 | Separar a chegada de vendas recentes das varreduras extensas de alterações antigas | Fila recente com prioridade e tempo reservado para o histórico; cobertura só avança após todas as fases necessárias. Não alterar diretamente os checkpoints atuais para “pular” o atraso. |
| 2 | Evitar repetir detalhes/NF/marcadores quando um lote termina no meio do pedido | Persistir etapas temporárias com validade/revisão, permitir revalidação e manter publicação final atômica. Isso requer desenho de armazenamento e migração próprios. |
| 3 | Ler cadastros em lote em pedidos com muitos produtos | Reduzir leituras sequenciais no banco, preservando escopo por workspace/conexão e prazo do cache. Os dois pedidos examinados nesta investigação não tinham esse gargalo. |
| 4 | Reservar turnos justos para custos e vendas na mesma conta | A reserva compartilhada impede execução concorrente. A distribuição deve evitar tanto vendas quanto CMV ficarem sem oportunidade; medir as duas filas. |
| 5 | Rever a janela útil do worker após medir os novos logs | Confirmar runtime/plano e duração reais; coordenar timeout, checkpoint, lease de 90 segundos e cron. A duração é configurável na plataforma, mas a configuração efetiva deste projeto não foi consultada. [Duração de funções Vercel](https://vercel.com/docs/functions/configuring-functions/duration). |
| 6 | Ajustar a taxa por conta quando a cota contratada e o consumo compartilhado forem conhecidos | Limitador distribuído por conta, cooldown de 429 e espaço para outras integrações. Não reduzir o intervalo de 2,1 segundos apenas supondo que o plano comporte. |

Também é necessário validar o contrato e o volume real de `dataAtualizacao` antes de redesenhar as varreduras incrementais. A documentação distingue filtros de criação e atualização, mas não estabelece, nesse texto, que o filtro de atualização represente uma janela diária fechada. Não assumi esse comportamento nem alterei o filtro nesta correção. [Listagem oficial de pedidos](https://api-docs.erp.olist.com/api-reference/pedidos/listar-pedidos).

**Validação e publicação**

- 37 testes focados passaram, incluindo recuperação de 503 em marcadores sem repetir o detalhe do pedido, falha persistente, prazo, `Retry-After`, 429/401/403, cache com alteração de metadados e isolamento das etapas do cron.
- A suíte completa: 281 passaram e duas falharam em `analytics-ui.test.cjs`. As mesmas duas falhas foram reproduzidas carregando as versões HEAD dos módulos alterados, confirmando que já existiam antes desta mudança. Não foram feitas alterações na interface para mascará-las.
- Typecheck e build passaram. Lint sem erros, com quatro avisos já existentes em `abc-dashboard.tsx`.
- Não há migração SQL necessária para estas mudanças. O arquivo v22 de Pareto não foi alterado.

Após publicar o código, comparar janelas de pelo menos 15–30 minutos e um ciclo completo das filas: eventos/minuto, linhas novas separadas de atualizações, tempo até uma venda recente aparecer, retries recuperados e repetidos, 429, idade dos jobs e duração dos lotes. Uma janela com mix diferente de pedidos não comprova ganho percentual. A recuperação externa continua dependente da Olist/rede; não é possível garantir ausência absoluta de indisponibilidade.

Evidências: [observação de ritmo](evidencias/importacao-ritmo-20261020194712/status.json), [estado de custos](evidencias/importacao-ritmo-20261020194712/custos.json), [pedidos pendentes sanitizados](evidencias/importacao-pendencias-20261020195241/status.json), [testes focados](evidencias/importacao-ritmo-20261020194712/testes-focados.log), [suíte completa](evidencias/importacao-ritmo-20261020194712/testes-completos.log), [reprodução no código anterior](evidencias/importacao-ritmo-20261020194712/baseline-ui.log) e [build](evidencias/importacao-ritmo-20261020194712/build.log).

Para repetir a observação: `node scripts/analytics-progress-readonly.cjs --observe=180`. Para examinar somente os pedidos pendentes de uma conta: `node scripts/analytics-pending-readonly.cjs --connection=UUID`. Esses comandos não executam importação nem renovam credenciais; o segundo consome poucos GETs da cota compartilhada da Olist, com espaçamento de três segundos.
