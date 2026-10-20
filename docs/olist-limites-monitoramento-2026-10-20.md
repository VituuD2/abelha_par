Limites por conta e monitoramento da API Olist — 20/10/2026
========================================================

Implementação local concluída. **Ainda é necessário executar a migração v23 no Supabase e publicar o aplicativo.** A leitura de produção às 17:23 retornou `PGRST202` para o monitor, confirmando que a função nova ainda não está instalada. Neste ambiente há credenciais REST, mas não conexão SQL/CLI configurada nem navegador conectado para aplicar a migração. Nenhuma alteração de banco ou deploy foi feita em produção.

**Limites aprovados**

| Conta | Plano informado e cota GET confirmada | Teto do nosso app | Espaçamento mínimo aproximado | Reserva nominal |
| --- | --- | ---: | ---: | ---: |
| Olist 1 | Domine · 120/min | 60/min | 1 segundo | 60/min |
| Olist 2 | Impulsione · 60/min | 36/min | 1,667 segundo | 24/min |
| Olist 3 | Impulsione · 60/min | 36/min | 1,667 segundo | 24/min |

Os tetos se aplicam em conjunto às leituras de vendas, cadastros, notas, marcadores, CMV, conferência, validação e novas tentativas feitas pelos clientes HTTP do aplicativo. Trocas OAuth não entram na cota GET nem nesses contadores. Scripts de diagnóstico executados à parte não participam do limitador do app.

A chave é o CNPJ associado à empresa, preservando o mesmo orçamento quando a conta é acessada tanto pelo vínculo operacional quanto pelo analítico. Outras contas sem política cadastrada recebem teto conservador de 28/min. O limite não depende do nome de exibição “Olist 1/2/3”.

**Como o controle funciona**

- A autorização de cada chamada é atômica no banco, com bloqueio da linha da conta. Instâncias diferentes e rotinas concorrentes disputam o mesmo orçamento.
- O limitador espaça as autorizações e não acumula rajadas de créditos ociosos. Se a chamada precisar aguardar além do prazo do worker, ele preserva o checkpoint para retomada.
- Ao receber 429, a conta respeita a maior espera entre `Retry-After` e a renovação indicada pela Olist; o teto efetivo cai pela metade por 15 minutos. Depois, volta ao teto configurado, sem elevá-lo acima de 60/36/36.
- Se o saldo informado pela Olist chegar aos últimos 10% da cota, o app aguarda a renovação antes de continuar. Se a Olist informar limite menor que o cadastrado, o teto efetivo também é reduzido.
- Se o controle no banco estiver indisponível, a chamada é adiada. **Se especificamente a migração estiver ausente**, o código conserva o espaçamento anterior de 2,1 segundos, sem habilitar a aceleração; a ausência é apresentada no monitor. A detecção dessa ausência fica em cache por até um minuto.
- A falha de gravação de telemetria não transforma uma leitura bem-sucedida em nova consulta ao ERP. A reserva já conta como tentativa, e o monitor mostra resultados não confirmados.

O custo adicional do controle é de uma autorização no banco antes do GET e uma confirmação depois dele, além de eventuais reconsultas durante a espera. A latência da API, as operações no banco e a janela útil do cron ainda podem impedir o app de atingir o teto. O ganho real em pedidos/minuto precisa ser medido após a ativação.

**O que conseguimos observar das outras integrações**

A documentação técnica define os cabeçalhos `X-RateLimit-Limit`, `X-RateLimit-Remaining` e `X-RateLimit-Reset`; o reset é expresso em segundos restantes. A cota pertence à conta e é compartilhada entre os aplicativos. [Contrato oficial Olist v3](https://api-docs.erp.olist.com/documentacao/comecando/limites-de-consulta).

Foi feita uma consulta GET `/info` por conta, sem renovar tokens. A identidade retornada correspondeu à empresa esperada nas três contas. Amostra em **20/10/2026, aproximadamente 17:18:30, horário de São Paulo**:

| Conta | Limite retornado | Saldo retornado | Consumo observado na janela | Segundos até renovar |
| --- | ---: | ---: | ---: | ---: |
| Olist 1 | 120 | 105 | 15 | 26 |
| Olist 2 | 60 | 45 | 15 | 26 |
| Olist 3 | 60 | 44 | 16 | 26 |

Esses valores são uma fotografia parcial da janela da Olist, **não o consumo final de um minuto nem uma medição após a aceleração**. Incluem as consultas de diagnóstico conforme a contabilização do provedor.

O monitor consegue mostrar o consumo total observado dos aplicativos que usam essa cota e, separadamente, contar nossas tentativas por minuto do relógio. Não identifica qual parcela pertence a Mercado Livre, Shopee, Magalu, Shein ou Nuvemshop. Também não comprova que todos os conectores nativos consumam essa franquia pública. Não subtraímos diretamente o total observado e nossos contadores para inventar consumo externo: as janelas e instantes de observação podem diferir.

**Onde acompanhar**

Depois da migração e publicação, abrir **Ninho → Conexões da Curva ABC → Consumo da API Olist**. O monitor atualiza a cada 15 segundos enquanto a página está visível; a importação continua no servidor sem a página aberta. Atualizar o monitor consulta apenas o banco, sem gastar uma chamada Olist adicional.

Por conta, ele apresenta:

- Plano, teto configurado e teto efetivo atual, incluindo pausas e redução temporária.
- Chamadas do último minuto encerrado, pico por minuto e tempo médio das consultas confirmadas.
- Contagem por vendas, CMV, conferência e validação, mais novas tentativas, 429 e falhas 5xx/rede/timeout.
- Saldo e consumo total observados na última amostra da conta, com horário e renovação prevista. Amostras expiradas ficam identificadas.
- Gráfico e tabela dos últimos 15 minutos encerrados. A tabela guarda a amostra de **maior consumo observado** de cada minuto, sem afirmar que seja o consumo final daquela janela do provedor.
- Identificação de minutos sem medição e de tentativas sem confirmação. O primeiro minuto instrumentado pode ser parcial, conforme o horário de início exibido.

O endpoint administrativo `GET /api/analytics/api-usage` retorna os últimos 60 minutos, com `Cache-Control: no-store`. Workspace e usuário vêm da sessão; operadores e contas sem permissão de gestão não acessam o monitor. Tabelas e RPCs são restritas à chave de serviço, e a leitura também verifica administrador ativo do workspace.

Os dados são agregados; não são armazenados tokens, corpos de pedido, dados de cliente ou cabeçalhos arbitrários. O histórico cobre 48 horas e é limpo por conta a cada dez minutos enquanto houver chamadas; contas inativas são limpas ao retomar. Permissões temporárias de chamada são descartadas após cerca de 10–20 minutos. Não há uma linha permanente por requisição.

**Ativação**

1. No SQL Editor do Supabase usado pelo app, executar **o arquivo inteiro** [migration_v23_olist_api_usage.sql](../supabase/migration_v23_olist_api_usage.sql). É independente do SQL v22 de Pareto e não altera pedidos, itens, custos, credenciais nem checkpoints existentes.
2. Publicar o código do aplicativo. Aplicar só o SQL ainda não muda o cliente HTTP antigo; publicar só o código mantém o ritmo anterior até a migração estar disponível.
3. Abrir o monitor no Ninho e aguardar alguns minutos de trabalho. Validar o teto efetivo, a chegada das amostras e o avanço dos checkpoints. Não interpretar ausência de amostra como consumo zero.

Para ler as métricas armazenadas sem abrir o Ninho: `node scripts/olist-api-usage-readonly.cjs`. O comando gera um snapshot local, consulta somente o banco e não chama a Olist. Para confirmar apenas os cabeçalhos com um GET por conta: `node scripts/olist-api-headers-readonly.cjs`; esse diagnóstico consome a cota do provedor e não faz renovação OAuth.

Uma reversão está disponível em [rollback_v23_olist_api_usage.sql](../supabase/rollback_v23_olist_api_usage.sql). Ela elimina somente o histórico/controle v23 e faz o código voltar ao ritmo conservador; pedidos, custos, credenciais e filas permanecem.

**Como usar os dados para decidir outro aumento**

Observar ciclos de movimento real, incluindo horários de pico, por pelo menos uma hora e depois comparar com outros períodos de pico. Procurar 429, mínimo de saldo observado, amostras ausentes, redução automática, tempo das consultas e idade das filas. Uma amostra curta com saldo alto não garante capacidade disponível durante picos de sincronização de estoque/preço.

Se o app não chega ao teto atual enquanto há fila e saldo disponível, investigar latência e janela do worker antes de elevar o teto. Se ele atinge o teto e as amostras mantêm folga nos horários relevantes, os dados permitem avaliar um novo aumento gradual. Os limites configurados não são elevados automaticamente.

**Validação**

53 testes focados passaram, incluindo os clientes HTTP, concorrência e orçamento compartilhado, 429, cabeçalhos, idempotência, amostras por minuto, retenção, reversão/reaplicação e atualização da interface. A suíte geral executada teve 299 aprovações em 301 testes; as duas falhas de `analytics-ui.test.cjs` são as já reproduzidas no código anterior na investigação precedente. Typecheck e lint passaram, com os quatro avisos existentes no dashboard. Build validado. O Browser não estava conectado; o comportamento da nova interface foi verificado em testes de DOM, sem inspeção visual em navegador real.

Evidências: [cabeçalhos reais sanitizados](evidencias/olist-cotas-20261020201830/headers.json), [confirmação da migração ainda ausente](evidencias/olist-consumo-20261020202338/usage.json), [testes focados](evidencias/olist-cotas-20261020201830/testes-focados.log), [suíte geral](evidencias/olist-cotas-20261020201830/testes-gerais.log), [build](evidencias/olist-cotas-20261020201830/build.log).
