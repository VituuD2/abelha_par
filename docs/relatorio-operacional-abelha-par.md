# Relatório operacional e técnico — Abelha Par

**Data de referência:** 02/10/2026.  
**Base da análise:** código atual do projeto, documentação interna e validações locais realizadas nesta revisão.  
**Escopo:** funcionalidades implementadas, operação, identidade visual, arquitetura e condições de ativação. A presença de uma função no código não comprova que a versão correspondente já esteja publicada ou configurada em produção.

## 1. Apresentação e finalidade

O **Abelha Par** é uma aplicação web para organizar e conferir pedidos de e-commerce antes da expedição. Ela cruza os pedidos selecionados na **Nuvemshop** com os registros da **Olist ERP**, valida o rastreio lido na etiqueta e reúne os pedidos conferidos em um lote com responsável, data e resultado imprimível.

O objetivo operacional é reduzir conferências manuais, evitar etiquetas fora da seleção ou repetidas dentro do lote, preservar o andamento do trabalho e permitir que a equipe consulte os resultados. A seleção feita na aplicação substitui a necessidade de uma planilha no fluxo principal atual.

A unidade de conferência é o **pedido identificado pelo código de rastreamento**. O sistema não verifica SKU, quantidade, peso ou conteúdo físico da embalagem. Também não cria etiquetas, calcula fretes, acompanha a entrega da transportadora ou altera automaticamente o status de expedição nas plataformas.

## 2. Organização das telas

| Nome no menu | Finalidade | Recursos principais |
| --- | --- | --- |
| **Colmeia** | Preparar a conferência | Resumo da seleção, busca na Olist, cruzamento entre plataformas, responsável e início da bipagem; lista de lotes em andamento e retomada. |
| **Pedidos do dia** | Definir quais pedidos entram no trabalho | Busca na Nuvemshop, filtros, ordenação, seleção individual ou em grupo e confirmação da seleção. |
| **Inspeção** | Conferir as etiquetas | Campo de leitura, progresso, pedidos pendentes/conferidos, avisos, atualização de rastreios e conclusão. |
| **Favos de Mel** | Consultar os resultados | Histórico de lotes finalizados, detalhes dos pedidos, responsável, data e impressão. A página usa o título “Histórico”. |
| **Ninho** | Administrar a operação | Conexões Olist/Nuvemshop, configuração do vínculo entre plataformas, webhook, usuários e permissões. Exclusivo de administradores. |

Existem ainda páginas de **login, recuperação de senha e definição de nova senha**. O acesso ao aplicativo exige autenticação e participação ativa na equipe da loja.

## 3. Fluxo diário de operação

1. **Entrar no sistema.** O usuário informa e-mail e senha. A aplicação verifica sua identidade e suas permissões.
2. **Buscar pedidos na Nuvemshop.** Escolher o período e consultar por data de criação ou atualização. O padrão é atualização, permitindo encontrar pedidos antigos preparados recentemente.
3. **Selecionar os pedidos preparados.** Usar busca, filtros e marcações para definir o conjunto exato que será conferido.
4. **Confirmar a seleção.** A confirmação registra a lista escolhida. Mudar a seleção ou buscar novamente na Nuvemshop exige uma nova confirmação.
5. **Buscar pedidos na Olist.** A busca pode ser feita antes ou depois da seleção Nuvemshop. Se a listagem já contiver os dados necessários, o sistema aproveita esses dados; consulta detalhes apenas quando faltarem campos.
6. **Revisar o cruzamento na Colmeia.** Verificar as correspondências e resolver divergências. Informar o responsável e iniciar a conferência.
7. **Bipar as etiquetas na Inspeção.** Cada leitura válida é gravada no banco antes de aparecer como conferida. Erros pausam o scanner para reconhecimento explícito.
8. **Salvar o lote concluído.** Depois de conferir todos os pedidos, clicar em “Salvar Lote”. A conclusão das leituras e a finalização do lote são etapas distintas.
9. **Imprimir ou iniciar outro lote.** A impressão e a opção “Novo Lote” ficam disponíveis após o salvamento. O resultado também pode ser consultado e reimpresso no histórico.

Uma conferência interrompida pode ser retomada na Colmeia. O trabalho gravado não depende de manter a página aberta.

## 4. Seleção e correspondência entre plataformas

### Pedidos do dia

A tela permite pesquisar por **cliente, número ou ID do pedido**, filtrar pagamento e envio, ordenar por número, criação ou cliente e exibir somente os selecionados. A tabela apresenta cliente, referência do pedido, criação, pagamento, envio e valor.

A seleção pode ser feita pelo checkbox ou pelo clique na linha. **Shift + clique** seleciona ou desmarca um intervalo na página visível. “Selecionar todos os aptos do filtro” considera o conjunto filtrado, incluindo outras páginas. Pedidos selecionados que deixam de aparecer no filtro continuam na seleção, e a tela informa essa situação.

Somente pedidos **pagos e não cancelados** são aptos. O lote aceita até **1.000 pedidos**. As consultas por período aceitam até **31 dias**; a busca Nuvemshop tem paginação de 100 registros por chamada e limite de 100 páginas.

### Cruzamento com a Olist

O vínculo usa o **ID da integração de e-commerce na Olist** e uma referência configurada: número ou ID interno da Nuvemshop, comparado ao campo correspondente na Olist. Nome do cliente e número próprio do ERP não determinam a correspondência.

O sistema bloqueia o início quando encontra pedido ausente, pagamento inadequado, cancelamento, situação inválida na Olist, correspondência ambígua, seleção repetida, mistura de lojas ou rastreio compartilhado entre pedidos. Pedidos da Olist que não pertencem à seleção são ignorados.

Antes de criar a sessão, o servidor refaz o cruzamento com os dados armazenados em seus próprios caches. Dados com mais de **duas horas** precisam ser consultados novamente. O navegador não pode autorizar a sessão enviando um pedido já marcado como conferido ou um rastreio inventado.

Pedidos sem rastreio podem entrar na conferência, mas só serão bipados quando o código estiver disponível.

## 5. Comportamento da bipagem

O leitor esperado é um scanner que funciona como teclado, preenchendo o campo e enviando a leitura com Enter. Também existe digitação manual e envio pelo botão. A interface bloqueia colagem, arrastar códigos e atalhos de colagem; isso reduz transferências acidentais, mas não comprova que o código veio de uma leitura física.

Os códigos são normalizados para comparação, removendo espaços e convertendo letras para maiúsculas. O código dos **Correios** é mantido completo. Para etiquetas **Loggi de 20 caracteres**, o sistema compara os oito caracteres finais quando correspondem ao formato previsto.

| Situação | Comportamento operacional |
| --- | --- |
| Código válido e pedido pendente | Grava a conferência, registra o horário do pedido, atualiza contagem/progresso e apresenta aviso verde com som de sucesso. |
| Gravação em andamento | O campo fica temporariamente indisponível e a tela informa que está salvando. Não há fila automática de novas leituras. |
| Código fora do lote | Não marca pedido e apresenta erro. |
| Pedido já bipado | Impede nova conferência do mesmo pedido nessa sessão e apresenta erro. |
| Código associado a mais de um pedido | Bloqueia a leitura e exige revisão do lote. |
| Erro aberto | Descarta eventos de teclado para que outra bipagem não feche o aviso. A continuação exige clique ou toque no botão de reconhecimento. |
| Pedido sem rastreio ao abrir a tela | Mostra a lista inicial e exige reconhecimento do aviso; permite conferir os demais enquanto busca os códigos ausentes. |
| Rede ou banco indisponível | Não antecipa a confirmação visual. Informa a falha; uma resposta perdida pode exigir recuperar a sessão para verificar o que já foi gravado. |
| Todos os pedidos conferidos | Apresenta a tela de conclusão, efeitos de celebração, som final e ação para salvar o lote. |

O aviso verde dura aproximadamente **dois segundos**, sem impor essa espera para a próxima leitura. O campo é liberado quando a resposta de gravação é processada. Pedidos conferidos aparecem primeiro na lista, com os mais recentes no topo.

A versão local atual exibe **100 pedidos por página na Inspeção**, mantendo o lote inteiro nos contadores. Isso reduz o custo de atualização da tela em grandes volumes.

### Rastreios que chegam depois

A aplicação consulta códigos ausentes em grupos de até cinco pedidos, com uma fila sequencial. Há intervalos de aproximadamente cinco segundos entre grupos pendentes e 30 segundos entre ciclos; limites ou falhas podem aumentar a espera. As atualizações preservam pedidos já conferidos.

A busca de rastreios ocorre em uma requisição separada da bipagem. Se a Olist limitar ou demorar, a equipe pode continuar conferindo pedidos que já tenham código. O lote só pode ser finalizado depois de todos os pedidos terem rastreio e estarem bipados.

## 6. Sessões, histórico e rastreabilidade

As sessões são persistidas no Supabase. A Colmeia apresenta até **50 lotes ativos mais recentes**, com responsável, progresso, atualização e opção de retomada. Outro membro ativo da mesma loja pode retomar a conferência.

O navegador armazena o identificador da sessão e o usuário para recuperação. O rascunho de preparação fica no armazenamento da aba, conserva seleções durante navegação/recarregamento e é separado por usuário.

O registro contém o nome informado como responsável, o criador da sessão, o último usuário que a alterou, o horário de conferência por pedido e o usuário que finalizou o lote. Esse modelo não corresponde a um log imutável de todas as ações com identificação individual do operador de cada leitura.

A finalização verifica se todos os pedidos foram conferidos. Repetir o salvamento da **mesma sessão** retorna o mesmo lote, evitando duplicidade decorrente de repetição da requisição.

O histórico apresenta os **50 lotes finalizados mais recentes da loja**, com expansão dos detalhes e impressão. A impressão lista lote, responsável, data, quantidade, clientes, rastreios e referências dos pedidos. Ela usa o recurso de impressão do navegador, que também pode permitir salvar em PDF. Não é uma função de emissão de etiqueta de transporte.

Lotes antigos com referência Yampi continuam sendo reconhecidos. Componentes e dependências legados de planilha/Yampi permanecem no repositório, mas não constituem o fluxo principal atual.

## 7. Equipe e administração

| Permissão | Operador | Administrador |
| --- | --- | --- |
| Buscar, selecionar e cruzar pedidos | Sim | Sim |
| Iniciar, retomar, bipar e finalizar lotes da loja | Sim | Sim |
| Consultar histórico e imprimir resultados | Sim | Sim |
| Configurar ou remover conexões | Não | Sim |
| Alterar o vínculo Nuvemshop/Olist | Não | Sim |
| Administrar webhook | Não | Sim |
| Criar usuários, definir perfis e bloquear acesso | Não | Sim |

As integrações pertencem à **loja compartilhada**, e não à conta individual de cada operador. Bloquear uma pessoa não desconecta a loja. O servidor verifica participação e perfil em cada operação; esconder o menu não é a única proteção.

No Ninho, o administrador cria usuários com nome, e-mail, senha inicial e perfil. A senha inicial exige ao menos 12 caracteres. A criação não dispara convite por e-mail: as credenciais precisam ser entregues à pessoa. É possível alterar perfil e ativar/bloquear acesso. O banco impede remover ou bloquear o último administrador ativo.

O menu acompanha a sessão atual e reconsulta permissões durante a navegação, ao recuperar foco e periodicamente. Usuários sem autorização não mantêm acesso administrativo por respostas antigas de outra conta.

## 8. Estilo, tema e experiência visual

A identidade usa a metáfora de **abelha, colmeia e mel**, aplicada ao nome, logotipo, ícones e navegação. A proposta visual é clara, acolhedora e organizada, com destaque para o estado de cada etapa.

| Elemento | Característica |
| --- | --- |
| Tema | Claro, com fundos em branco quente e creme. Não há seletor de tema escuro no fluxo atual. |
| Cores principais | Creme `#f8f6f1`, texto marrom `#302518`, âmbar `#d97706` e amarelo-mel `#f5bb20`. |
| Estados | Verde para sucesso/conferido, vermelho para erro/bloqueio e âmbar para atenção/pendência. |
| Tipografia | Inter para a interface; fonte monoespaçada em códigos de rastreamento. |
| Componentes | Cartões com bordas arredondadas, sombras suaves, botões arredondados, badges e barra de progresso. |
| Efeitos | Gradientes discretos, transparência com desfoque, transições, avisos animados e confetes na conclusão. |
| Computador | Menu lateral fixo e conteúdo central com largura controlada. |
| Telas menores | Navegação inferior, reorganização de cartões e rolagem horizontal em tabelas. |

A interface usa português brasileiro, estados de carregamento, mensagens de erro e recursos semânticos como labels e avisos. O CSS reduz animações para a preferência de movimento reduzido; isso não equivale a uma certificação de acessibilidade ou à desativação de todos os efeitos de JavaScript.

Os filtros operacionais e a data do lote usam referências de horário de São Paulo. Algumas apresentações de data/hora usam o fuso do navegador, portanto o equipamento da operação deve estar configurado corretamente.

## 9. Integrações e automações

**Nuvemshop:** conexão por ID da loja e token de aplicativo sob medida, com leitura de pedidos/clientes. O servidor valida o acesso antes de salvar a credencial. O Ninho permite alterar a conexão e o vínculo com a Olist. O adaptador do projeto aponta para a versão de API `2025-03`.

**Olist ERP:** conexão OAuth, busca de pedidos por criação/atualização, consulta de detalhes quando necessária, cache no servidor e renovação de credenciais. O sistema aproveita os dados completos da listagem para evitar consultar todos os pedidos individualmente.

**Webhook Olist:** registra notificações em uma fila persistente e responde sem esperar a consulta completa ao ERP. A fila tem reserva com expiração, versões de eventos e novas tentativas para falhas. O Ninho permite consultar status, copiar a URL, pausar/ativar recebimento e gerar outra URL. Gerar outra URL exige atualizar o cadastro na Olist.

**Sincronização periódica:** o arquivo da Vercel define uma execução diária para descoberta e processamento limitado de pedidos. No fuso de São Paulo, o agendamento `0 3 * * *` em UTC corresponde a 00h. Esse mecanismo é complementar e não representa sincronização contínua de toda a loja.

**Renovação automática:** há um agendamento separado, preparado para executar a cada hora pelo Supabase Cron. Ele verifica tokens próximos do vencimento e pode renová-los sem navegador aberto. A reserva no banco protege contra trocas simultâneas e contra sobrescrever uma reconexão recente. A execução depende de configurar o agendamento, os segredos e a aplicação publicada.

## 10. Arquitetura e segurança técnica

| Camada | Implementação no projeto |
| --- | --- |
| Aplicação | Next.js 15, React 19 e TypeScript; páginas e endpoints no App Router. |
| Interface | Tailwind CSS 4, Framer Motion, Lucide e Canvas Confetti. |
| Estado da operação | Zustand, com persistência controlada no navegador. |
| Identidade e banco | Supabase Auth e PostgreSQL/Supabase. |
| Escopo da equipe | `workspaces` e `workspace_members`, com consultas limitadas à loja autorizada. |
| Dados principais | Conexões, caches Nuvemshop/Olist, fila de sincronização, sessões e lotes finalizados. |
| Credenciais | Criptografia AES-256-GCM no servidor; chaves administrativas não são entregues ao operador. |
| Proteção do banco | RLS e restrições de acesso às tabelas/funções; operações críticas executadas pelo servidor. |
| Infraestrutura prevista | Aplicação na Vercel e persistência/serviços no Supabase. |
| Validação local | Testes Node.js, TypeScript, build de produção e PostgreSQL isolado com PGlite. |

As APIs validam identidade, participação ativa e perfil. Os pedidos de uma sessão são derivados de registros do servidor. Tokens não retornam nas consultas operacionais. Rotas internas de automação exigem um segredo próprio, e o fluxo OAuth inclui verificação do estado da autorização.

As alterações concorrentes de rastreios usam revisão para impedir sobrescrever uma leitura gravada. A nova função de bipagem usa transação e bloqueio da linha do lote para validar e salvar de maneira atômica. A finalização também é transacional e idempotente.

## 11. Melhoria recente de desempenho

O diagnóstico do fluxo anterior mostrou quatro chamadas remotas sequenciais por bipagem: autenticação, permissões, leitura da sessão e gravação. Também havia transferência do lote inteiro e renderização de todas as linhas.

As alterações locais reduzem o caminho para **três chamadas**, validando e salvando a leitura em uma única função do banco. Quando a revisão do navegador está atualizada, a resposta contém apenas o pedido alterado e os contadores. Quando houve alteração de outro operador ou dos rastreios, a resposta inclui a sessão completa para sincronização.

A lista foi limitada a 100 linhas por página, e as linhas sem alterações são reaproveitadas. O pedido continua sendo confirmado somente depois da gravação. O cabeçalho `Server-Timing` permite separar o tempo de autorização do tempo de gravação no painel de rede do navegador.

A otimização do banco depende de executar **`supabase/migration_v10_atomic_scan.sql` após a v9** e publicar o código. Sem a função, a aplicação mantém compatibilidade com o caminho anterior, mas não obtém a melhoria de gravação. Nesta revisão, a migração v10 e a publicação não foram executadas em produção.

Na validação local mais recente, passaram **79 testes**, a checagem de tipos e o build. Os testes incluem lote de 1.000 pedidos, duplicidade, concorrência, falha de rede, permissões e sincronização de revisões. Isso verifica o comportamento do código; o ganho de velocidade no equipamento dos operadores ainda exige medição durante a operação real.

## 12. Limites operacionais e condições de uso

- **Conexão necessária:** não há modo de bipagem offline nem fila persistente de leituras para envio posterior.
- **Duplicidade entre lotes:** a proteção cobre a repetição dentro da sessão e o salvamento repetido da mesma sessão. Não há bloqueio global para incluir o mesmo pedido em sessões diferentes.
- **Um rastreio por pedido:** múltiplos volumes, etiquetas ou rastreios por pedido ainda precisam de modelagem própria.
- **Dados após a preparação:** pagamento e cancelamento da Nuvemshop não são monitorados continuamente em uma sessão já iniciada. Mudanças operacionais exigem revisão dos dados.
- **Trabalho compartilhado:** revisões e transações protegem a gravação, mas a tela de cada operador não recebe atualização contínua por Supabase Realtime. A sincronização ocorre nas consultas e respostas das ações.
- **Histórico disponível na tela:** são exibidos os 50 registros mais recentes; não há busca abrangente ou paginação de todo o histórico nesse fluxo.
- **Relatórios:** o recurso atual é consulta/impressão do lote; não há painel completo de produtividade, SLA ou exportação geral CSV/Excel no fluxo principal.
- **Automação:** webhooks, sincronização e renovação dependem de configuração externa e podem sofrer atraso por fila, indisponibilidade ou limites dos provedores.
- **Desempenho:** o armazenamento de pedidos ainda usa arrays JSON no lote. A otimização reduz viagens de rede e renderizações, mas não elimina o custo de grandes arrays no banco.

Para operar a versão correspondente ao código, é necessário ter as migrações compatíveis aplicadas, os serviços Supabase configurados, as conexões validadas no Ninho e a aplicação publicada. Os agendamentos precisam ser ativados separadamente. A chave de criptografia existente deve ser preservada para continuar lendo as credenciais armazenadas.

## Referências internas para manutenção

- [Ninho e acesso da equipe](ninho.md).
- [Diagnóstico e ativação da melhoria de bipagem](bipagem-desempenho.md).
- [Renovação e otimização das consultas Olist](olist-renovacao-e-desempenho.md).
- Código de operação: `src/app/page.tsx`, `src/app/orders/page.tsx`, `src/app/scanner/page.tsx`, `src/app/history/page.tsx` e `src/components/ninho/`.
- Regras e persistência: `src/lib/reconciliation.ts`, `src/lib/tracking.ts`, `src/stores/scan-store.ts`, `src/lib/scan-session-server.ts` e `supabase/migration_v10_atomic_scan.sql`.
- Identidade visual: `src/app/globals.css` e `src/components/layout/sidebar.tsx`.

Documentos mais antigos de implantação descrevem versões anteriores; quando houver divergência, este relatório considera o código atual, especialmente as conexões compartilhadas e a retomada de lotes.
