# Verificação básica de capacidade do Supabase — 19/10/2026

O projeto Free apresenta margem para continuar a importação atual com três contas. Não foi encontrada saturação de CPU, conexões ou espaço na janela observada. Essa conclusão vale para a carga observada; não representa uma garantia para muitos usuários simultâneos ou um teste de estresse.

Medição entre 12:22:47 e 12:23:53, horário de São Paulo, com a importação em andamento. Plano Free informado pelo responsável. Todas as operações remotas da verificação foram de leitura. Nenhuma migração, alteração de configuração, renovação de OAuth ou execução manual de importação foi realizada.

| Indicador | Medição | Interpretação |
| --- | --- | --- |
| Dados do cluster, incluindo bancos internos | 45,51 MB | Aproximadamente 9,1% da cota nominal de 500 MB |
| Banco principal `postgres` | 30,40 MB | Inclui dados operacionais e analíticos; não apenas a Curva ABC |
| CPU fora de idle | 5,97% na janela de 65,4 segundos | Inclui 2,06 pontos percentuais de espera por I/O; CPU de usuário + sistema: aproximadamente 3,87% |
| Memória disponível | 162,74 MB de 456,82 MB visíveis ao sistema | Aproximadamente 35,6% disponível |
| Conexões PostgreSQL | 12; `max_connections = 60` | Parte das conexões é reservada aos serviços internos; não equivale a 60 usuários do aplicativo |
| Clientes aguardando no PgBouncer exposto pelas métricas | 0 nas duas amostras | Esse indicador cobre o pooler medido, não todas as filas possíveis |
| Deadlocks na janela | 0 | Nenhum incremento do contador |
| Arquivos temporários de consultas na janela | 0 bytes adicionais | Contador cumulativo anterior é histórico; não foi tratado como uso atual |
| Curva ABC: três leituras sequenciais | 1.139, 1.098 e 1.017 ms | Incluem rede; não são tempos puros de execução SQL nem uma medição de p95 |
| Resposta do relatório | 32.675 bytes de JSON; 50 linhas de 462 entidades | Período 01/08–19/10, produtos, receita, pedidos com situações 1/5/6 |
| Volume analítico | 7.603 pedidos, 7.874 itens, 465 produtos | Contagens feitas em sequência; o worker continuava alterando os totais |
| Controle da importação | 15 jobs, 3 contas habilitadas sem `error_code` | São faixas e checkpoints, não 15 processos concorrentes |
| Histórico do cron | 2.881 registros | O código mantém aproximadamente dois dias, com exclusão a cada execução |

MB nesta medição significa 1.000.000 de bytes. A soma dos bancos internos foi usada para uma comparação conservadora com a cota. Espaço do filesystem inclui componentes como WAL e não deve ser comparado diretamente aos 500 MB de dados. A distinção e a soma de `pg_database_size` são descritas na [documentação de tamanho do banco](https://supabase.com/docs/guides/platform/database-size).

Há swap em uso: aproximadamente 326 MB no fim da janela. Os contadores registraram 4.004 páginas lidas e 52 escritas durante a janela. Isso merece acompanhamento com uso simultâneo do painel; não houve, nesta amostra, memória esgotada ou CPU saturada. Swap ocupado isoladamente não determina necessidade de upgrade.

O Free publica 500 MB para o banco, CPU compartilhada, cerca de 500 MB de RAM e 5 GB de saída de dados. Requisições de API não têm uma franquia mensal por quantidade, mas continuam dependentes desses recursos. O Pro parte de US$ 25/mês, inclui 8 GB de disco por projeto, 250 GB de saída e backups diários retidos por sete dias. Referência: [planos oficiais](https://supabase.com/pricing). Esses limites foram consultados na data da verificação; não foi alterado o plano.

O cron analítico programa uma chamada por minuto, ou 1.440 por dia. O trabalho acontece na rota Next.js hospedada na Vercel, com orçamento de 45 segundos e até três contas distintas em paralelo. As reservas duram 90 segundos e serializam o trabalho por conta. Grande parte do tempo do worker é espera pela API da Olist; o orçamento inteiro não corresponde a CPU de PostgreSQL ocupada. Esses workers não consomem a franquia de Supabase Edge Functions. Limites e custos da Vercel e da Olist são independentes desta verificação.

O painel consulta progresso a cada 15 segundos enquanto há importação pendente e a aba está visível. Mudanças de progresso provocam novas leituras da Curva ABC. Mais usuários e exportações simultâneas podem elevar consultas e tráfego. Como cenário aritmético, 240 relatórios por hora, com o JSON medido, durante oito horas por dia e 22 dias, representam aproximadamente 1,38 GB por aba. Esse cenário não é consumo faturado: desconsidera compressão, outros endpoints e a frequência efetiva de mudanças de progresso.

Não foi obtido o consumo mensal de saída de dados, o histórico de CPU/memória de horas anteriores, nem o uso simultâneo em horários de pico. A Metrics API forneceu as duas amostras de infraestrutura, mas não substitui a página Usage de faturamento. Os HTTP 503 apresentados anteriormente não demonstram, por si, falta de capacidade: a rota também retorna 503 por erros de importação e renovação de credenciais.

Recomendação: manter o limite atual de três contas e continuar a importação. Não há evidência nesta medição que exija um upgrade imediato para completar essa carga. Conferir o tráfego acumulado em **Supabase → Usage** e acompanhar CPU, memória e latência durante o uso simultâneo do painel. Como alertas operacionais propostos, e não limites do fornecedor, usar 350 MB de dados e 3,5 GB de tráfego mensal; investigar CPU acima de 70% por 15 minutos, perda persistente de memória disponível, aumento de swap e filas. Não é possível prometer uma quantidade de usuários suportados com três consultas sequenciais.

As evidências agregadas, sem credenciais ou dados de clientes, estão em [medicao.json](evidencias/supabase-capacidade-20261019152247/medicao.json). O coletor [supabase-capacity-readonly.cjs](../scripts/supabase-capacity-readonly.cjs) pode ser executado com `node scripts/supabase-capacity-readonly.cjs`; consulta contagens, uma RPC STABLE de relatório e duas amostras de métricas com intervalo de aproximadamente um minuto. Ele não faz teste de carga e não deve ser executado repetidamente sem necessidade. Autenticação da coleta segue o [repositório oficial de observabilidade](https://github.com/supabase/supabase-grafana).
