# Histórico de versões

## 3.0.0 — 20/10/2026

Entrega consolidada das alterações posteriores à versão exibida em 18/08/2026: **v2.1.1 - 08182600**, registrada no commit `d361f755`. Inclui as mudanças de código até 20/10/2026 e a correção local de CMV da migração v21.

A versão principal avança para 3 porque o fluxo de conferência passou a depender de sessões persistidas, gravação atômica no servidor e permissões por workspace. A migração v6 revoga a gravação direta de lotes usada pelo cliente antigo; a atualização exige código e banco compatíveis. Não é uma atualização apenas de correções pontuais.

### Operação e conferência

- Seleção e conciliação de pedidos da Nuvemshop com a Olist, com filtros e retomada do trabalho.
- Rastreios atualizados em segundo plano, preservando pedidos já conferidos.
- Sessões de lote persistidas, recuperação de andamento e finalização idempotente.
- Gravação atômica das leituras antes da confirmação visual; tratamento de duplicidades e de erros sem perder a sessão.
- Melhorias de desempenho, paginação e retorno sonoro na bipagem.
- Busca e paginação do histórico de lotes, com isolamento por workspace.

### Conexões e acesso

- Administração das integrações Olist e Nuvemshop no Ninho.
- Renovação automática de tokens, validação da identidade da conta e retomada após reconexão.
- Webhooks, filas persistidas e processamento periódico com reservas e tentativas controladas.
- Permissões de administrador e operador verificadas no servidor, com proteção das rotas e dados da operação.

### Curva ABC e CMV

- Módulo Néctar com Curva ABC de produtos, produtos base e clientes; filtros de período, empresas, origens e situações.
- Histórico e atualização incremental de vendas por conexão Olist, com checkpoints e retomada de importações.
- Pareto interativo, detalhamento por pedido e exportação completa em CSV/Excel.
- Consolidação dos kits e aliases revisados, com origem rastreável e quantidades convertidas nas unidades documentadas.
- CMV da Olist 1 em cache, com histórico completo e custo vigente na data de cada operação. A tela não consulta o ERP a cada filtro.
- Custo de compra histórico como padrão, com seleção explícita de custo médio histórico.
- Valores monetários negativos preservados nos itens, totais e descontos dos pedidos.
- Custos informados zero ou negativos aceitos; a Fita Seios continua com custo zero. O CMV mantém o sinal e o rateio usa a magnitude dos custos; se todos forem zero, usa as quantidades dos componentes.
- Distinção entre custo zero informado e custo desconhecido; interface e exportações identificam as regras e as lacunas.
- Entradas de consulta v21 verificam a política do banco e identificam migração ausente ou substituída, sem atribuir o problema ao custo do produto.

### Ajustes de interface — 20/10/2026

- Filtros da Curva ABC começam compactos; opções extras e regras adicionais expandem separadamente.
- Regras da consolidação visíveis somente para administradores.
- Pareto completo, sem o corte de 60 entidades, com largura proporcional à quantidade de produtos e tabela paginada; requer a [v22](supabase/migration_v22_analytics_full_pareto.sql) após v21.
- Removidos subtítulos das telas e os textos de orientação e corte do gráfico.
- Calendários e menus de seleção compartilhados com React Aria, em português e no tema âmbar; campos de texto, caixas de seleção e estados de foco padronizados em todo o site.
- Cursores de controles ativos, campos e opções desabilitadas revisados; a linha inteira da Curva ABC abre os pedidos com clique, Enter ou Espaço.
- Detalhes de cada produto sem o texto de escopo e a seção Origem da composição.
- Modal de pedidos com seleção direta de página; mantém tabela e totais durante a navegação e em falhas, com indicador de carregamento e proteção contra respostas de produtos já fechados.

### Identificação da versão

- Versão do pacote e do lockfile alinhadas em `3.0.0`.
- Rodapé usa a versão do pacote por meio de `src/lib/app-version.ts`, sem outro número fixo no componente.
- Identificador exibido: **v3.0.0 - 10202600**. O código da entrega mantém o formato anterior: mês, dia, ano com dois dígitos e revisão do dia (`MMDDYYRR`).
- O número da migração SQL, a revisão do catálogo de composições e a versão do aplicativo têm finalidades distintas e continuam independentes.

### Ativação

Estas notas descrevem o código da entrega; não certificam a aplicação das migrações nem a publicação em produção. O aumento da versão não executa migrações ou deploy.

Em uma instalação atualizada até v19, manter a [v20](supabase/migration_v20_analytics_signed_item_amounts.sql) para itens monetários negativos e aplicar a [v21](supabase/migration_v21_analytics_zero_signed_costs.sql) para custos zero/negativos e totais negativos, publicando o aplicativo correspondente. Instalações anteriores devem seguir a ordem e os requisitos das migrações intermediárias; não reaplicar definições antigas sobre funções mais recentes.

Detalhes: [integração Nuvemshop](docs/integracao-nuvemshop.md), [permissões do Ninho](docs/ninho-permissoes-2026-10-19.md), [implantação da Curva ABC](docs/curva-abc-implantacao.md), [CMV histórico](docs/cmv-historico-padroes-2026-10-20.md) e [custos zero/negativos na v21](docs/cmv-zero-negativo-v21-2026-10-20.md).

## 2.1.1 — 18/08/2026

- Versão de referência exibida como `v2.1.1 - 08182600`.
- Ajustes de estado e reaproveitamento de dados de pedidos na preparação dos lotes.
- O pacote ainda declarava `1.0.0`; a versão 3.0.0 alinha essa identificação com a versão do aplicativo.
