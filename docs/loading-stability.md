# Carregamento de dados sem saltos de layout

O componente compartilhado é `src/components/ui/loading-region.tsx`. Ele mantém o conteúdo e os elementos de rolagem montados enquanto a consulta está pendente, cobre os dados com skeletons e conserva a altura medida também depois da resposta. Resultados maiores usam a rolagem interna. `scrollbar-gutter: stable` reserva espaço para a barra de rolagem.

Não se chama `scrollTo` para tentar compensar mudanças de altura. Não se troca a tabela inteira por outro componente durante uma atualização. Não se aplica `inert` ao contêiner de rolagem: apenas controles, links e linhas interativas ficam temporariamente indisponíveis. Eventos de roda e toque não são cancelados.

## Padrão para componentes novos

```tsx
<LoadingRegion
  label="Resultados da consulta"
  loading={loading}
  skeleton={<TableSkeleton columns={6} />}
  className="card"
>
  <div
    role="region"
    aria-label="Tabela de resultados"
    tabIndex={0}
    className="h-[min(720px,70dvh)] min-h-80 overflow-auto"
  >
    <table className="w-full min-w-[800px] table-fixed">
      {/* Cabeçalhos e dados, sem alterar a chave do contêiner de rolagem. */}
    </table>
  </div>
</LoadingRegion>
```

- Declarar o componente fora de condicionais de `loading` e manter a estrutura da área vazia e da área preenchida.
- Usar uma altura de viewport para tabelas e gráficos; o volume de resultados não deve decidir a altura da página. Colunas fixas evitam que os valores novos recalculem a largura de toda a tabela.
- O primeiro carregamento precisa de uma estrutura ou altura mínima compatível com o conteúdo esperado. Se a quantidade inicial de seções é desconhecida, pode-se usar `preserveHeight={!!data}` para medir a estrutura real a partir da primeira resposta.
- Tratar falhas explicitamente. `error` esconde e bloqueia os dados anteriores, conservando a área ocupada. Não apresentar um snapshot anterior como resposta bem-sucedida do filtro novo.
- Agrupar pedidos relacionados: na análise manual ABC, os skeletons dos quatro blocos principais permanecem até terminarem relatório e comparação. Respostas obsoletas continuam sendo descartadas pelos controladores existentes.
- Ordenação, paginação e quantidade de linhas atualizam apenas as linhas do ranking. Os skeletons ocupam as células existentes, preservando suas medidas; cabeçalhos, busca e seletor continuam montados e visíveis. Botões de ordenação e paginação usam `aria-disabled` com proteção no handler durante a consulta, preservando o foco. Não aplicar `inert` ao controle que disparou uma alteração da lista.
- Desabilitar `overflow-anchor` no ranking e em seu viewport evita que o navegador acompanhe uma linha que mudou de posição ao ordenar ou buscar. Manter os deslocamentos válidos sem chamar `focus()` ou `scrollIntoView()` na atualização dos dados; isso também permite continuar rolando enquanto a consulta está pendente.
- Atualizações automáticas do progresso e do consumo não precisam mascarar todos os dados. Manter a informação disponível e atualizar discretamente evita flashes periódicos. Escritas como bipagem e envio de formulários usam o feedback da própria ação; não devem bloquear uma tela inteira.
- Mudanças de largura/viewport e expansão explícita de `details` podem recalcular o espaço. Isso é diferente de variar a altura porque uma consulta retornou menos linhas.
- Não animar altura, margem ou posição da página na troca de dados. A animação dos skeletons respeita `prefers-reduced-motion`; transições numéricas existentes usam transformações que não alteram o fluxo.

## Aplicações realizadas

| Área | Comportamento |
| --- | --- |
| Curva ABC | Indicadores, distribuição, gráfico, ranking e regras da consolidação recebem skeletons na análise manual. Rolagem, busca, paginação, estado vazio e falhas preservam as estruturas. |
| Gráfico de Pareto | Altura fixa; o gráfico vazio mantém a área; tooltip móvel sobreposto evita deslocar os blocos abaixo. |
| Detalhamento de pedidos | Skeleton durante abertura e troca de página, preservando a área do detalhe. |
| Pedidos do dia | Skeleton durante a busca remota e viewport estável para a seleção. Filtros locais instantâneos não piscam skeletons. |
| Histórico | Mantém a área durante busca, debounce, paginação e atualização. |
| Preparação | Lotes em andamento e resultado da conferência preservam suas áreas durante novas leituras. |
| Ninho | Leituras de usuários, conexões analíticas e atualização manual de consumo usam o componente compartilhado. Polling de consumo permanece discreto. |

Ao diminuir o volume de dados, a posição de rolagem é preservada enquanto continuar válida. Se uma lista vazia deixa de ter conteúdo rolável, o navegador limita o deslocamento interno ao novo máximo; a caixa externa e a posição da página permanecem estáveis.

## Verificação

`node scripts/verify-loading-layout.cjs` compila os componentes reais e o CSS do projeto, injeta respostas sintéticas e executa Chrome/Chromium isolado e sem interface. Não usa credenciais, servidor de produção ou respostas reais de clientes. O executável pode ser informado por `CHROME_PATH`.

O teste mede posição, largura e altura dos quatro blocos principais em viewports de 1440 × 1000, 768 × 1000 e 390 × 844. Verifica skeletons simultâneos, resposta da comparação atrasada, rolagem durante a espera, continuidade dos elementos, deslocamentos válidos após a resposta, resultado vazio e ausência de transbordamento horizontal. Nas listas de produtos Olist, produtos base e clientes, verifica ordenação, troca entre 25/50/100 linhas, paginação, busca e visibilidade das colunas; cliques de mouse reais via Chrome DevTools verificam também o foco ao fechar o seletor. Evidências JSON e capturas ficam no diretório temporário informado pelo comando.

Os testes `loading-region.test.cjs` e os testes de interface existentes cobrem bloqueio das ações antigas, recuperação de falhas, detalhes de pedidos, redimensionamento, buscas e respostas fora de ordem. O teste em navegador complementa o JSDOM, que não calcula layout real.
