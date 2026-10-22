# Revisão de interface — Abelha Par

Direção: conservar a identidade âmbar e a linguagem operacional; dar prioridade à leitura, à ação seguinte e à estabilidade das listas. A skill UI Taste foi obtida pelo comando solicitado, com os playbooks `audit`, `operate`, `polish` e `craft` lidos do diretório de apoio informado pelo comando.

## Referência visual

Alvo gerado e inspecionado: `ui-taste/target.png`, 1536 × 1024 pixels. Os números são ilustrativos; não são dados de clientes. A referência serve à composição, hierarquia e acabamento. Os atalhos de período existentes continuam sendo botões. A variação de concentração continua neutra e calculada em percentual, conforme o contrato real do produto; não se reproduz a interpretação em pontos percentuais sugerida pela imagem.

## Cobertura e correções

| Superfície | Revisão aplicada |
| --- | --- |
| Sistema visual | Superfícies opacas, bordas e raios coerentes, menos sombras e gradientes, texto secundário mais legível, ação primária âmbar mais escura, botões estáveis sem deslocamento no hover. |
| Primeiro carregamento | A primeira resposta define a medida real antes de travar a altura nas atualizações seguintes; evita cortar indicadores e botões ao medir apenas o aviso vazio inicial. |
| Navegação | Marca original compartilhada; uma única hierarquia de título por página; `aria-current`, navegações nomeadas, link para pular ao conteúdo e espaço para a área segura no celular. |
| Colmeia | Etapas reais da preparação explicitadas; revisão de seleção visualmente subordinada depois da confirmação. |
| Pedidos do dia | Cabeçalho orientado à tarefa; confirmação posicionada acima da navegação móvel e da área segura. |
| Inspeção | Identidade e cabeçalho coerentes; estilo de paginação antes ausente; nomes e metadados longos podem quebrar linha. |
| Histórico | Instrução de busca antes referenciada mas ausente; datas e contagens quebram linha; nomes e rastreios longos deixam de depender de truncamento. |
| Néctar | Abas consistentes com o Ninho, cabeçalho com contexto, ícones de indicadores discretos e distribuição compacta; preservação dos skeletons, foco e rolagem. |
| Ninho | Mesma linguagem de abas, superfícies e controles, preservando status, permissões e ações de integração existentes. |
| Acesso | Apresentação compartilhada para login, envio de link e nova senha; remoção dos borrões decorativos; formulários e contratos de autenticação preservados. |

## Verificação

Os scripts de navegador usam componentes e CSS reais com dados sintéticos e integrações substituídas localmente. Não acessam contas, dados ou serviços de produção. `verify-loading-layout.cjs` verifica os comportamentos de foco, rolagem e skeletons. `verify-ui-taste.cjs` renderiza as rotas representativas, testa controles e salva capturas e medições em diretório temporário.

Resultados da rodada final:

- Build de produção concluído, com lint e validação de tipos; 45 testes de interface e comportamento aprovados.
- 27 combinações de rota e viewport aprovadas no Chrome isolado: nove rotas em 1536 × 1024, 768 × 1024 e 390 × 844, com a fonte Inter do build do projeto.
- Verificados transbordamento horizontal, título principal único, ausência de erros de execução, expansão de histórico e conexões, seleção de pedidos, abas do Ninho e abertura/fechamento do detalhe ABC.
- A verificação de carregamento confirmou as listas de produtos Olist, produtos base e clientes: ordenação, 25/50/100 linhas, paginação, busca, colunas, continuidade de foco/rolagem e skeletons até o fim das respostas relacionadas.
- Texto terciário sobre o painel branco: contraste medido de 5,22:1. Isso verifica essa combinação específica, não certifica todos os estados e cores do app.
- Capturas inspecionadas em contexto e comparadas com a direção visual. A correção da altura inicial eliminou o corte de indicadores e do botão de retomada do lote observado na primeira rodada.

Evidências preservadas no projeto: [análise no desktop](ui-taste/analytics-desktop.png), [Colmeia no celular](ui-taste/home-mobile.png), [login no desktop](ui-taste/login-desktop.png) e [resultados das 27 verificações](ui-taste/results.json).

A revisão cobre a interface web. Não equivale a auditoria de segurança do backend, certificação de acessibilidade, teste de hardware móvel ou validação das integrações em produção. As diferenças necessárias para respeitar os controles e dados reais impedem afirmar fidelidade pixel a pixel à imagem gerada.
