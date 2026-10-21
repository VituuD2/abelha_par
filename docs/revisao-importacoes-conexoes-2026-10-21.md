# Revisão das importações e conexões — 21/10/2026

As importações continuam à noite e com o navegador fechado. O Supabase Cron chama `/api/internal/analytics-sync` a cada minuto usando o segredo do servidor; essa rota não usa cookies nem uma sessão de usuário. As filas, cursores e novas tentativas ficam no banco. O navegador apenas consulta o progresso. A renovação operacional também tem agendamento próprio, e a rotina analítica renova suas autorizações preventivamente.

A produção foi consultada somente em leitura. As alterações descritas aqui são locais: nenhuma migração, publicação, renovação OAuth, alteração de fila ou importação foi executada manualmente nesta revisão.

## Evidência da madrugada

Janela de **00h00 a 06h00 de 21/10**, horário de São Paulo, UTC 03h00–09h00. [Dados completos](evidencias/importacao-noturna-2026-10-21/status.json).

| Hora | Disparos do cron | Tentativas de API | Resultados registrados | Falhas HTTP 5xx/rede/timeout |
| --- | ---: | ---: | ---: | ---: |
| 00h | 60 | 3.062 | 3.046 | 5 |
| 01h | 60 | 3.021 | 3.015 | 3 |
| 02h | 60 | 2.907 | 2.889 | 5 |
| 03h | 60 | 3.240 | 3.227 | 4 |
| 04h | 60 | 2.899 | 2.884 | 7 |
| 05h | 60 | 3.232 | 3.215 | 3 |
| Total | 360 | 18.361 | 18.276 | 27 |

Não houve HTTP 429 registrado nessa janela. Os 85 registros sem resultado confirmado não provam sucesso nem falha: a reserva é contabilizada antes da consulta e a gravação da telemetria pode falhar. Os números são chamadas, não pedidos; resultados incluem respostas de erro. O registro do cron, isoladamente, confirma o disparo HTTP, não seu sucesso. Os contadores da API acrescentam evidência de execução efetiva durante toda a madrugada. Não foram consultadas sessões para afirmar quem estava conectado; a independência de login é comprovada pelo fluxo de autorização da rota interna.

Também foram encontrados históricos concluídos às 21h02 e 21h12 de 20/10, e outro às 06h38 de 21/10. [Snapshot de filas, cobertura e contas](evidencias/importacao-ritmo-20261021135120/status.json).

Às 10h51 de 21/10, as três contas estavam habilitadas e processando. Havia 9.508, 4.102 e 4.573 pedidos armazenados, respectivamente. As consultas não compartilham um snapshot transacional. A cobertura confirmada ainda tinha lacunas: 09–19/10 não estava integralmente confirmado. Ter pedidos de hoje não comprova cobertura completa dos dias anteriores.

## Problemas tratados

| Problema | Correção |
| --- | --- |
| Qualquer `last_error` oferecia reconexão | A ação passa a depender do estado de autorização, vínculo e identidade. Erro temporário de cota, banco ou rede não pede reconexão. |
| Token de acesso vencido era uma indicação incompleta de autorização | O estado considera também a renovação. Um acesso vencido com refresh válido pode ser renovado automaticamente. Renovação vencida exige ação, mesmo que reste acesso temporário. |
| Conta operacional vinculada sempre oferecia restabelecimento | A API consulta o vínculo atual no workspace. O reparo aparece apenas quando o vínculo realmente falta ou mudou. |
| Erro ao consultar o vínculo no banco era tratado como autorização removida | Falha temporária permanece indisponibilidade de verificação; não vira `authorization_required`. |
| Conta operacional saudável sempre mostrava “Reconectar Olist” | Reconexão fica restrita à autorização expirada/revogada. A mesma apresentação de status é usada no Ninho e na busca de pedidos. |
| Conta ainda não cadastrada parecia autorização expirada | Ausência de integração passa a ser `missing`, com ação de conectar. |
| Espera preventiva do limitador local parecia HTTP 429 da Olist | `AnalyticsQuotaWait` identifica a espera programada e preserva seu prazo. Não dispara a chamada nem cria um resultado HTTP fictício no monitor. |
| Troca de aplicativo mantinha erros da credencial anterior | A gravação limpa os erros anteriores ao invalidar tokens e validação. |
| Múltiplos períodos de cobertura sempre eram descritos como lacunas | A detecção passa a considerar a ordem, sobreposição e adjacência dos intervalos. |
| A Curva ABC ocultava cobertura parcial quando já havia resultados | Um resumo recolhido informa o escopo parcial e o progresso, sem repetir explicações junto às métricas. |
| Progresso podia ficar parado na tela quando não havia fila no primeiro carregamento | O Ninho atualiza o estado a cada 15 segundos enquanto visível, inclusive após tarefas iniciadas em outra sessão. Respostas antigas não substituem leituras mais novas. |

## Organização da interface

Cada conta tem um cartão com nome, CNPJ, estado da conexão, estado da importação e última atualização. O consumo fica dentro do cartão correspondente, associado pelo ID da conexão. O CMV aparece apenas na conexão que o fornece.

O consumo destaca dois indicadores: chamadas do app no último minuto completo e amostra de uso total da conta na Olist. O gráfico mostra 15 minutos. Amostras antigas, ausência de medição e erros de atualização permanecem identificados. Plano, limites, falhas, latência e histórico ficam em “Detalhes de consumo”. Uma única consulta e um único polling abastecem todos os monitores.

Histórico, CMV, gerenciamento e formulários ficam recolhidos. Contas saudáveis mostram apenas ações operacionais úteis. `ConnectionStatus` e o contrato `ConnectionHealth` centralizam rótulos, cores e ação necessária. Autorização, importação e identidade continuam separados: “CNPJ validado” não é sinônimo de conexão funcionando, e “Conectada” não é promessa de histórico completo.

## Continuidade e limites

O agendamento atual está ativo e há evidência noturna. A operação ainda depende de banco/agendador, hospedagem, conectividade, cotas e credenciais válidas. As falhas temporárias preservam os checkpoints e aguardam nova tentativa. Nenhum limite foi aumentado e nenhum checkpoint foi avançado artificialmente.

Os incrementais antigos ainda estavam abertos e atrasados no snapshot, com cursores de atualização em 03/10 e 09/10. Esta revisão corrige a interpretação e a recuperação de estados; não redesenha a distribuição de trabalho entre a fila histórica e as vendas recentes. A falha ocasional do controle distribuído permanece uma indisponibilidade temporária protegida: sem reserva confirmada, nenhuma consulta é enviada à Olist. A mensagem genérica observada não permite atribuir sua causa a timeout, contenção ou indisponibilidade específica do banco.

Referências oficiais: [Supabase Cron](https://supabase.com/docs/guides/cron), para execução independente do navegador, e [OAuth Security Best Current Practice, RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html), para proteção das credenciais de renovação. A implementação preserva criptografia, reservas distribuídas, controle de versão, isolamento por workspace e verificação de CNPJ já existentes. Consultar status analítico lê apenas metadados e não expõe tokens nem consome a API Olist.

## Verificação

A suíte completa passou com **312 testes**. Após o ajuste final que sinaliza renovação expirada sem descartar um acesso ainda válido, os **37 testes focados de status, OAuth e interface** também passaram. TypeScript, lint e build de produção passaram. Os testes cobrem estados de autorização e pausa, falhas temporárias, vínculo operacional real, isolamento do consumo por cartão, uma única leitura compartilhada, ausência de reconexão em contas saudáveis, retomada de checkpoint, falhas de telemetria e distinção entre espera local e HTTP 429.

A conferência visual em navegador não foi possível: o runtime de navegador não tinha nenhuma instância disponível. A interface foi validada por testes de componentes/DOM, TypeScript, lint e build; isso não substitui inspeção visual em desktop e celular após a publicação.

Os resultados finais estão em [testes completos](evidencias/revisao-importacoes-testes-completos.log), [testes após o ajuste final](evidencias/revisao-importacoes-testes-finais.log), [lint](evidencias/revisao-importacoes-lint.log) e [build](evidencias/revisao-importacoes-build.log). Estas alterações não exigem nova migração SQL. O monitor continua dependendo da v23, cuja disponibilidade foi confirmada pela [leitura de consumo](evidencias/olist-consumo-20261021135121/usage.json).

Para repetir a auditoria noturna: `node scripts/analytics-overnight-readonly.cjs --day=2026-10-21`. Para o andamento atual: `node scripts/analytics-progress-readonly.cjs`. Ambos consultam dados persistidos sem iniciar workers ou renovar OAuth.
