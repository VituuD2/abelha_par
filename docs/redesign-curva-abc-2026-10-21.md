# Redesign da Curva ABC — 21/10/2026

## A. Diagnóstico inicial e plano

Baseline: `2a0a225c`. Rota: `src/app/analytics/abc/page.tsx`; interface e estados em `src/components/analytics/abc-dashboard.tsx`. O AppShell limitava todas as páginas a 1240 px, incluindo seus paddings, e o dashboard repetia esse limite. O cabeçalho ficava separado das ações, os filtros principais ocupavam duas linhas amplas e a tabela começava com 50 registros, sem busca, intervalo visível ou alinhamento numérico consistente. CSV e Excel estavam separados das ações superiores.

Sistema existente: Tailwind, React Aria para datas e seletores, lucide, tokens de superfícies quentes e laranja, fonte Inter já configurada no aplicativo. Sidebar, controles compartilhados e tokens globais devem permanecer compatíveis.

Plano, registrado antes da implementação:

1. Ampliar o AppShell somente na rota ABC, até 1600 px, com padding desktop de 32 px. Reaproveitar o Header sem alterar sua tipografia; reunir as ações no dashboard.
2. Usar abas com teclado, filtros compactos e expansão existente, indicação de alterações ainda não aplicadas e resumo dos filtros aplicados. Organizar KPIs e classes sem recalcular métricas.
3. Manter paginação e ordenação pelo servidor normalmente. Buscar na lista completa `result.pareto` já fornecida pela v22, com paginação local apenas durante a busca. Não buscar somente na página carregada; bloquear a busca se o servidor devolver uma lista incompleta. Preservar ranking, classes e valores recebidos.
4. Usar 25 registros por padrão, alinhar números, conter a rolagem na tabela, ocultar SKU em Clientes e preservar o detalhamento real. Agrupar exportações com feedback, mantendo filtros e formatos.
5. Validar contratos e interações com testes, TypeScript, lint e build isolado. Comparar gráfico, tipografia e regras com a baseline. Tentar capturas locais de antes/depois nos principais breakpoints.

Não serão alterados banco, APIs, importadores, integrações ou regras comerciais. A persistência em URL fica fora desta entrega para não serializar seleções sensíveis nem introduzir outra fonte de estado sem contrato existente.

Arquivos protegidos (SHA-256 antes da implementação):

- `pareto-chart.tsx`: `0519B09DAB8C07175F17483A82919C4D5F0E55E2F65E0F64ECC612C0AA55C68E`.
- `globals.css`: `8B7BF0AF3E6E9B9DBFF7463E85331A2531E03DBE1708E30CDC093408C27B1504`.
- `app/layout.tsx`: `3B37ED006DD2BA17F24804660C7C5547B67B07BD17D82241D2EC8F09D1C488AE`.

## B. Alterações realizadas

- `app-shell.tsx`: limite de 1600 px e padding desktop de 32 px exclusivamente para `/analytics/abc`. O ramo de layout das demais páginas e a sidebar foram preservados.
- `analytics/abc/page.tsx`: o Header passou a ser renderizado pelo dashboard, junto às ações e ao horário de atualização. Autorização e agrupamento inicial continuam iguais.
- `abc-controls.tsx`: componentes de apresentação para modos e exportação. Abas com estado ativo, foco, setas, Home e End; os três modos permanecem visíveis em telas pequenas. CSV e Excel ficam no mesmo menu, com indicador de preparação e Escape para fechar.
- `abc-dashboard.tsx`: filtros de período em uma barra flexível; painel expansível e regras adicionais existentes preservados; resumo do período e das seleções aplicadas, aviso de alterações pendentes e limpeza das seleções. Limpar seleções restaura os status padrão e não aplica silenciosamente datas ou regras ainda em edição.
- KPIs com espaçamento e alinhamento consistentes, valores originais e tooltips nativos para os indicadores ambíguos. Resumos A/B/C com badges, quantidade de produtos/clientes, receita, participação e unidades.
- Tabela com busca por nome/SKU em todos os registros do ranking, ignorando acentos; Clientes busca apenas nomes. Busca adiada pelo React e resultado memorizado para evitar recalcular a cada destaque do gráfico. Ranking, valores e classes permanecem recebidos do servidor, sem reclassificação dos resultados encontrados.
- Paginação padrão de 25 registros, opções 25/50/100, intervalo e total visíveis. A tabela normal mantém paginação/ordenação do servidor; durante a busca, os resultados completos são ordenados e paginados na apresentação. Comparações monetárias e de quantidade usam precisão decimal, sem converter centavos grandes para ponto flutuante.
- Cabeçalho fixo na rolagem interna da tabela, números à direita, divisores, foco/hover e nomes de coluna por contexto. SKU é ocultado em Clientes e reaparece ao retornar a Produtos, preservando as escolhas de colunas.
- Detalhamento existente apresentado em painel lateral com dialog nativo e título acessível. Mantidos filtros, página, API, paginação dos pedidos, Escape e fechamento.
- Skeleton inicial fora do gráfico; indicador fixo e retenção do resultado durante atualizações do mesmo escopo. A atualização automática continua a cada 15 segundos, sem inserir uma nova linha no fluxo da página.
- Exportações continuam enviando exatamente `{ filters, format }` para a API existente, com todos os registros do escopo aplicado. A busca da tabela não restringe a exportação. Sucesso anunciado e erros de exportação separados dos erros do relatório; ambos os formatos ficam bloqueados durante a preparação e liberados após falha.

Nenhuma dependência foi adicionada ao projeto. Os arquivos de comparação visual usam ferramentas temporárias fora do repositório.

## C. Preservação das restrições

- **Gráfico:** `pareto-chart.tsx` permanece byte a byte igual, com o SHA-256 registrado acima. A invocação `<ParetoChart ... />` também foi preservada, incluindo todas as propriedades e callbacks. Nenhuma série, eixo, tooltip, interação, classe interna, dimensão ou regra de renderização foi editada. Apenas o espaço externo acompanha o novo contêiner responsivo.
- **Fonte:** `globals.css`, `app/layout.tsx` e `layout/header.tsx` sem alterações. Inter, imports e tokens globais preservados. A comparação em navegador confirmou a mesma fonte e a mesma tipografia do título nos respectivos breakpoints; em desktop, título de 34 px, peso 700 e altura de linha 42,5 px antes e depois.
- **Negócio:** nenhum SQL, endpoint, contrato de API, engine, critério de classe, regra de pedidos, configuração ou importador foi modificado. A busca trabalha em uma cópia da lista recebida; preserva os objetos, ranking e classificações. Nenhum SQL novo é necessário para este redesign.

## D. Validação

| Verificação | Resultado |
| --- | --- |
| `node --test tests/*.test.cjs` | **343 testes passaram**, zero falhas e zero ignorados |
| `node node_modules/eslint/bin/eslint.js src next.config.ts` | Passou |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | Passou |
| Build Next.js de produção | Passou, incluindo lint e verificação de tipos do build |
| `git diff --check` | Passou |
| Comparação dos arquivos protegidos e chamada do gráfico | Preservados |
| Chromium headless | Sem erros JavaScript da página nos cenários executados |

O build foi executado em um worktree temporário no mesmo disco, com as fontes finais copiadas e as dependências existentes, para não alterar os artefatos `.next` do workspace principal.

Os testes cobrem busca além da primeira página, acentos, SKU por contexto, precisão na ordenação, preservação dos objetos e classes, paginação local sem novas chamadas, teclado das abas, ausência de busca parcial com ranking incompleto, exportação com filtros aplicados, sucesso/falha/espera, separação de erros e limpeza sem aplicar rascunhos. A suíte existente também validou filtros, atualizações concorrentes, polling, gráfico, detalhamento, permissões, cálculos SQL e importação.

No navegador: busca pelo item de posição 100 sem nova chamada de relatório; 25 linhas; próxima página; abertura de detalhes, Escape e preservação da página; troca de modo pelo teclado; SKU ocultado/reexibido. Contorno da curva e viewBox SVG iguais com o mesmo conjunto de teste. Verificados 320, 390, 768, 1024, 1440, 1920 e 2560 px, sem overflow horizontal da página. A tabela e o gráfico conservam sua própria rolagem quando necessária.

Limites reais:

- As capturas e interações visuais usaram um harness temporário local com **componentes reais e dados sintéticos de teste**, sem acesso a APIs externas. A sidebar é a original; o wrapper usa as classes da respectiva versão do AppShell. Não equivalem a um teste autenticado de produção nem comprovam disponibilidade atual da Olist. Mocks não foram adicionados à aplicação.
- A busca global exige `pareto` completo, já fornecido pela migração v22 existente. Se um servidor antigo retornar apenas parte do ranking, a busca fica desabilitada com mensagem explícita, evitando resultados falsamente completos.
- Filtros não foram persistidos na URL. Mantido o estado atual do componente, incluindo escolhas ao recolher painéis e ao abrir/fechar detalhes.
- Alterações implementadas e validadas localmente; esta revisão não publicou uma implantação na Vercel.

## E. Evidências antes/depois

As imagens completas e as medições estão em [evidencias/abc-redesign](evidencias/abc-redesign/). Os valores nas capturas são exclusivamente dados de teste.

| Tela | Antes | Depois |
| --- | --- | --- |
| Desktop, 1920 px | [Antes](evidencias/abc-redesign/before-desktop.png) | [Depois](evidencias/abc-redesign/after-desktop.png) |
| Tablet, 1024 px | [Antes](evidencias/abc-redesign/before-tablet.png) | [Depois](evidencias/abc-redesign/after-tablet.png) |
| Celular, 390 px | [Antes](evidencias/abc-redesign/before-mobile.png) | [Depois](evidencias/abc-redesign/after-mobile.png) |

Em Full HD, o contêiner passou de 1240 para 1600 px: **360 px a mais de largura**, com paddings menores e consistentes. A navegação saiu do card independente, ações foram reunidas no cabeçalho e as datas/atalhos passaram a compartilhar uma linha quando há espaço. A tabela deixou de alongar toda a página com 50 registros e ganhou busca completa, 25 registros por padrão, rolagem interna e intervalo explícito. No celular, os três modos aparecem juntos e a rolagem horizontal fica contida nos componentes que precisam dela.

Detalhes das medições, tipografia e comparação SVG: [verificacao-visual.json](evidencias/abc-redesign/verificacao-visual.json).

Hashes e comparação da invocação do gráfico: [preservacao.json](evidencias/abc-redesign/preservacao.json).
