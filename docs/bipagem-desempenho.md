# Latência da bipagem

## Diagnóstico

O caminho anterior de `POST /api/scan-sessions/:id` fazia quatro chamadas remotas em sequência: `auth.getUser()`, consulta de participação em `workspace_members`, leitura de `scan_sessions` e gravação de `scan_sessions`. Em disputa de revisão, repetia a leitura e a gravação até quatro vezes. A leitura, a atualização e a resposta HTTP transportavam o array inteiro de pedidos. A tela desabilitava o campo durante a requisição e só marcava o pedido depois da confirmação do servidor.

O middleware já exclui `/api`; não há uma segunda autenticação por middleware nesse caminho. A Olist só é consultada em outro endpoint, para atualizar rastreios ausentes, sem bloquear a requisição de bipagem. Essa atualização pode disputar a revisão do lote. O aviso verde permanece por dois segundos, mas o campo já permitia uma próxima bipagem durante o aviso: reduzir esse timer não resolve a espera de gravação.

No navegador, a lista ordenava e renderizava todos os pedidos em cada atualização da página, inclusive ao mudar `busy` e ocultar o aviso. Respostas com o lote inteiro também substituíam todas as referências dos pedidos.

Em 02/10/2026, consultas **somente de leitura**, realizadas desta máquina ao banco configurado, deram:

| Consulta | Primeira amostra | Segunda amostra | Terceira amostra |
| --- | ---: | ---: | ---: |
| Participação ativa, limitada a um registro | 422 ms | 86 ms | 95 ms |
| Três sessões mais recentes da loja | 90 ms | 74 ms | 59 ms |

Havia duas sessões concluídas, com 11 pedidos cada, e nenhuma sessão ativa nessa amostra. Esses valores incluem a rede desta máquina, não medem `getUser`, gravação ou uma bipagem em produção e não comprovam a latência percebida pelo operador. Mostram o custo de repetir chamadas remotas; o ganho real depende também da região do servidor, da região do Supabase e da conexão do operador.

## Correção implementada

- A função `submit_workspace_scan` valida o código e grava o pedido na mesma transação, com bloqueio da linha do lote. O caminho passa de quatro para três chamadas remotas: autenticação, participação e gravação atômica.
- Quando a revisão enviada pelo navegador coincide com a revisão anterior do lote, retorna apenas o pedido alterado, a revisão e os contadores. Se houver alteração de outro operador ou da atualização de rastreios, retorna também a sessão completa para sincronizar a tela. Clientes antigos, sem revisão, continuam recebendo a sessão completa.
- A validação continua usando os dados do banco. A função rejeita usuários bloqueados, lotes de outra loja, lotes finalizados, rastreios ambíguos e pedidos já bipados. Acesso direto à função é restrito a `service_role`.
- O navegador conserva as referências dos pedidos não alterados na resposta compacta e atualiza a confirmação e a liberação do campo na mesma alteração de estado. Erros continuam pausando a leitura e nenhuma confirmação é antecipada à gravação.
- A lista ordenada é memorizada e exibe 100 pedidos por página, com linhas memorizadas. Todos os pedidos continuam no lote e nos contadores.
- Cada nova confirmação toca o som e reinicia o timer do aviso verde, mesmo se o aviso anterior ainda estiver aberto. Desde a revisão de 19/10, o áudio parte diretamente da resposta confirmada, antes de notificar a interface; o popup cuida apenas da apresentação e da dispensa. Esse aviso não intercepta cliques, e sua dispensa não pode apagar um erro.

A função ainda percorre o array e o PostgreSQL ainda grava o JSON do lote. A otimização reduz viagens de rede e transferência do lote; não elimina o custo de armazenar pedidos como JSON. Se medições posteriores apontarem o banco como gargalo em lotes muito maiores, o próximo passo é normalizar os pedidos em uma tabela própria.

## Ativação e medição

1. Depois da v9, execute `supabase/migration_v10_atomic_scan.sql` no SQL Editor do Supabase. A migração é transacional, pode ser reaplicada e não altera os pedidos existentes.
2. Publique a aplicação com estas alterações. Enquanto a função não existir, o servidor usa o caminho anterior, adicionando a tentativa inicial de RPC. Aplique a migração primeiro para obter a melhoria do banco.
3. No navegador, abra **Network**, faça leituras reais e selecione a requisição `POST /api/scan-sessions/:id`. O cabeçalho `Server-Timing` mostra `authorize` (autenticação e participação) e `save` (validação e gravação). A descrição de `save` deve ser `atomic`; `legacy` indica que a função ainda não está disponível.
4. Compare duração total, `authorize`, `save` e tamanho da resposta em leituras sucessivas, incluindo a primeira depois de um período sem uso. Separe os casos em que há sincronização completa da sessão. Para medir percentis, registre uma sequência representativa no equipamento e na rede dos operadores.

O tempo total do navegador inclui rede, inicialização da aplicação e processamento da resposta; o `Server-Timing` cobre as etapas dentro do endpoint. Os tempos não incluem códigos nem dados dos clientes. Não há gravação automática de uma nova leitura enquanto a anterior está em andamento.

## Validação

`npm test` verifica a migração em PostgreSQL local isolado, paridade da normalização dos códigos, duplicidade, leituras concorrentes, proteção contra atualização de rastreio com revisão antiga, permissões, resposta compacta para 1.000 pedidos, sincronização de revisão divergente, compatibilidade sem migração, falha de rede e isolamento de sessões. Também verifica que a lista de 1.000 pedidos renderiza apenas 100 linhas. Execute ainda `npm run typecheck` e `npm run build`.

## Revisão de 19/10/2026: lista e resposta sonora

O rastreio foi retirado da lista de pedidos da inspeção, tanto nos pendentes quanto nos já conferidos. A lista mantém nome, referência do pedido, data e situação. O aviso de rastreio ausente continua visível. O código permanece nos dados necessários à validação; esta alteração é de apresentação da lista.

O som de sucesso agora começa após validar a resposta de gravação e antes da atualização do estado que dispara a renderização da lista. Não depende mais do efeito React do popup. A última leitura usa a mesma confirmação para iniciar a fanfarra uma única vez. Respostas de uma sessão anterior, erros de rede e duplicidades não tocam confirmação. Falhas no áudio não transformam uma gravação confirmada em erro. O contexto de áudio é preparado durante o gesto do operador, reutilizado e configurado para interação; os nós são desconectados ao terminar cada som.

Não há espera artificial, consulta à Olist ou recarga da sessão completa a cada leitura no caminho normal. São uma requisição do navegador por bipagem e três chamadas remotas sequenciais dentro dela: autenticação, consulta da participação e RPC atômica. A participação continua sendo revalidada a cada leitura. A sessão completa é retornada quando há divergência de revisão. O aviso verde de dois segundos não exige aguardar para fazer a próxima leitura.

As consultas automáticas à Olist só ocorrem para pedidos pendentes sem rastreio, em grupos de até cinco, sem sobreposição entre essas consultas. O intervalo é de cinco segundos para percorrer o restante da fila e de 30 segundos para tentar novamente, com espera maior após limite da Olist. Sem rastreios faltantes, essa fila não gera requisições. Ela não é aguardada pela bipagem, embora possa disputar a linha do lote durante sua gravação.

Às 16:39 de São Paulo, uma verificação somente de leitura confirmou a disponibilidade de `submit_workspace_scan` no schema exposto pelo Supabase. Três amostras pequenas desta máquina até o banco deram 109/86/66 ms para participação e 126/57/52 ms para metadados da sessão mais recente. Não foram lidos os pedidos nem executada qualquer bipagem nessa medição. Evidência: [scanner-latencia-20261019193954.json](evidencias/scanner-latencia-20261019193954.json). Para repetir: `node scripts/scanner-latency-readonly.cjs`.

Esses números não medem gravação, autenticação do operador, servidor hospedado ou saída física do som. Não permitem atribuir a espera ao plano Free nem prometer latência zero. Para localizar uma demora real, compare o tempo total de uma bipagem no navegador com `authorize` e `save` no `Server-Timing`: `authorize` reúne autenticação/participação; `save` reúne a chamada ao banco; o restante inclui rede, inicialização do servidor e processamento. A descrição `atomic` confirma o caminho usado naquela requisição. Esta revisão não exige migração nem altera a importação analítica.

Os testes de conferência verificam som somente depois da resposta, início antes da atualização visual, fanfarra única, ausência de confirmação em erros/respostas antigas, continuidade sem suporte de áudio, preservação de rastreios atualizados em paralelo e ausência dos códigos no HTML da lista.

Validação desta revisão: 30 testes passaram nos arquivos `scan-performance`, `session-api`, `tracking` e `nuvemshop`; typecheck e build de produção passaram. O lint terminou sem erros, com quatro avisos já existentes no dashboard analítico. Não foi feita medição física com o leitor nem gravação de teste em produção.
