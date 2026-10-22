# Importações e ETA — 21/10/2026, 21h11 de São Paulo

Consulta atual ao projeto Supabase `abelha_par`, em modo somente leitura. Nenhum worker, agendamento, pedido, checkpoint, migration ou deploy foi alterado. A conexão MCP local foi configurada e autenticada para permitir as consultas.

## Resultado observado

- As três contas estão habilitadas, com avanço recente e sem erro registrado nos checkpoints ativos da leitura.
- Cron: 60 disparos na última hora. Os disparos, sozinhos, não comprovam conclusão; o crescimento dos contadores e as atualizações dos pedidos confirmam atividade adicional.
- 18.380 pedidos armazenados: Olist 1, 9.581; Olist 2, 4.168; Olist 3, 4.631. São 97 registros a mais que às 14h18, incluindo todas as situações armazenadas.
- Os oito pedidos não cancelados ausentes na auditoria das 14h34–14h41 agora estão presentes: seis na Olist 1 e dois na Olist 2. Não foi refeita a listagem do ERP; essa conferência não garante ausência de novos pedidos pendentes nem igualdade atual de situações, itens e valores com a origem.
- Na telemetria de aproximadamente 60 minutos, não houve respostas 429, erros de servidor, timeouts ou erros de rede registrados nas três contas. Existem reservas sem resposta registrada; não foram tratadas como sucesso.
- Histórico de custos: 119/119 registros com sincronização realizada e nenhum vencido para revisão no momento. Isso não significa que todos os itens tenham CMV válido ou que não haja revisões futuras.

## Ritmo e projeção

Comparação dos mesmos jobs históricos incrementais entre 14h18 e 21h11, aproximadamente 413 minutos. Olist 1 avançou 1.708 eventos; Olist 2, 1.373; Olist 3, 1.450. Uma segunda observação de aproximadamente 1,8 minuto confirmou mais 4, 3 e 5 eventos, respectivamente; essa amostra curta comprova avanço, mas não foi usada como média principal.

| Conta | Ritmo histórico médio | Restante estimado no job atual | ETA do job atual | Restante incluindo uma rodada seguinte | ETA incluindo a rodada seguinte |
| --- | ---: | ---: | --- | ---: | --- |
| Olist 1 | 4,14 eventos/min | ~3.878 | 22/10, 12h50 | ~5.199 | 22/10, 18h10 |
| Olist 2 | 3,32 eventos/min | ~269 | 21/10, 22h30 | ~905 | 22/10, 01h45 |
| Olist 3 | 3,51 eventos/min | ~938 | 22/10, 01h40 | ~1.696 | 22/10, 05h15 |

As contas trabalham em paralelo. A projeção central para o passivo estimado mais uma rodada é de aproximadamente **21 horas**, até **22/10 às 18h10**, determinada pela Olist 1. Se a vazão voltar à média menor da medição anterior, o mesmo volume da Olist 1 exigiria aproximadamente 37 horas, até **23/10 às 10h30**. Essa comparação de cenários não é um intervalo estatístico nem um prazo garantido.

O volume restante não foi contado novamente na Olist. Ele usa as contagens da fonte obtidas por volta de 14h07–14h18, descontando o crescimento real de `processed` no mesmo job e somando a rodada seguinte já estimada naquela medição. Os parâmetros fixos `scan.since` e `scan.ceiling` permaneceram iguais. Pedidos e alterações adicionais, retroativos ou novos escopos podem aumentar o trabalho; portanto os números são estimativas com volume congelado, não contagens atuais exatas.

Fórmulas:

```text
ritmo = (processed atual − processed às 14h18) / minutos observados
restante do job = restante estimado às 14h18 − avanço do mesmo job
restante com rodada seguinte = restante do job + rodada seguinte estimada anteriormente
horas = restante / ritmo / 60
```

Eventos incluem releituras, cancelamentos e atualizações; não são pedidos únicos ausentes ou chamadas HTTP. No momento da leitura, a Olist 1 ainda percorria vendas com cursor em 16/10; Olist 2 e 3 já estavam na fase de alterações, em janelas de criação de 15–21/10 e 08–14/10, respectivamente.

## Pedidos recentes

Os ciclos recentes concluídos e iniciados nas últimas seis horas duraram, em média, 45 minutos na Olist 1, 38,9 na Olist 2 e 33,2 na Olist 3. A média mede o ciclo inteiro, não o atraso individual de cada pedido. Essa fila continua trabalhando independentemente do encerramento do passivo histórico.

## Evidências

- [Primeira fotografia atual](evidencias/importacao-scan-20261021-2111/snapshot.json)
- [Fotografia das 21h11](evidencias/importacao-scan-20261021-2111/latest-snapshot.json)
- [Telemetria, ciclos recentes e oito pedidos anteriores](evidencias/importacao-scan-20261021-2111/diagnostics.json)
- [Memória de cálculo](evidencias/importacao-scan-20261021-2111/estimate.json)
- [Contagens e estimativa anteriores](evidencias/importacao-v24-estimativa-20261021170711/estimate.json)

As evidências não contêm tokens nem payloads pessoais de pedidos. As consultas foram executadas pelo transporte MCP autenticado do Codex, sem iniciar outra execução de modelo.
