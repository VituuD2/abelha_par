# Nuvemshop + Olist — implantação e operação

Implementação local em 30/09/2026. Na checagem final, as tabelas e colunas das migrações v6/v7 e a função de finalização já estavam disponíveis no Supabase. Nenhuma migração foi executada por esta revisão no banco remoto. A loja `8255405` ainda não estava conectada, e os novos endpoints do aplicativo publicado retornavam 404; falta publicar esta versão e informar o token.

## Vínculo validado

| Identificador | Valor desta operação |
| --- | --- |
| Loja Nuvemshop, informado pelo operador | `8255405` |
| Pedido Nuvemshop — número visível | `116` |
| Pedido Nuvemshop — ID interno | `2083401789` |
| Pedido Olist — número visível | `10101` |
| Pedido Olist — ID interno, consultado pela API | `393310669` |
| Integração Nuvemshop na Olist | `23257` |
| Referência retornada pela Olist | `ecommerce.numeroPedidoEcommerce = "116"` |

O cruzamento usa a integração **e** o número do pedido da loja. IDs internos, números Olist, nomes de clientes e observações não são intercambiáveis. A leitura real da Olist confirmou o exemplo acima; a leitura real da Nuvemshop ainda deve ser validada após a conexão.

## Ativação

1. Termine e salve os lotes abertos na versão antiga. A sessão antiga existia apenas na memória do navegador.
2. Confira o banco de destino. Os objetos novos já foram encontrados no Supabase configurado localmente. Se o destino for outro ou faltar algum objeto, execute no SQL Editor, em uma janela de atualização, `supabase/migration_v6_nuvemshop_sessions.sql` e `supabase/migration_v7_olist_queue.sql`, nesta ordem. Elas pressupõem as migrações anteriores até v5. Os testes executam as duas migrações duas vezes para verificar repetição segura. **A v6 revoga a gravação direta de lotes pelo navegador: a versão antiga deixa de salvar lotes até a implantação do novo código.** Histórico e tokens existentes são preservados. Não aplique as migrações antigas novamente sem verificar o estado do projeto.
3. Configure no ambiente da Vercel e publique o novo código:

   ```dotenv
   NUVEMSHOP_STORE_ID=8255405
   OLIST_NUVEMSHOP_ECOMMERCE_ID=23257
   NUVEMSHOP_OLIST_REFERENCE_KIND=number
   NUVEMSHOP_OLIST_REFERENCE_FIELD=numeroPedidoEcommerce
   APP_URL=https://abelha-par.vercel.app
   ```

   Preserve `TOKEN_ENCRYPTION_KEY`, as configurações Supabase e as credenciais Tiny já utilizadas. Trocar a chave de criptografia impede a leitura das conexões existentes. As configurações não secretas acima foram adicionadas ao `.env` local; isso não altera a Vercel.
4. Na Nuvemshop, acesse **Aplicativos → Aplicativos sob medida**, crie **Abelha Par**, habilite leitura de pedidos e clientes e gere o token. Não é necessário criar um aplicativo de parceiros para esta conexão sob medida. O token deve ser copiado diretamente para a aplicação, sem chat, Git ou variáveis `NEXT_PUBLIC_`.
5. Entre no Abelha Par, abra **Pedidos do dia**, confira a loja `8255405` e cole o token em **Conectar com aplicativo sob medida**. O servidor valida o acesso à API antes de criptografar e salvar a credencial por usuário.
6. Busque um período que inclua o pedido `116`. Confirme sua correspondência com `10101` na Olist. Faça a primeira conferência com um lote pequeno e etiquetas reais, verificando também o histórico e a impressão.

As conexões continuam vinculadas ao usuário autenticado, como na arquitetura anterior. Um segundo usuário precisa conectar suas contas. Não foi criada uma organização compartilhada entre usuários.

## Fluxo diário

1. Busque os pedidos da Nuvemshop por criação ou atualização (padrão), em um período de até 31 dias. A API inteira é paginada; uma falha não transforma uma consulta parcial em lista confirmada. A seleção diária pode incluir pedidos antigos preparados hoje.
2. Pesquise por cliente, número ou ID. Filtre pagamento e envio, ordene a lista e selecione por checkbox ou clique na linha. **Shift + clique** seleciona ou desmarca o intervalo na página visível. O comando **Selecionar todos os aptos do filtro** abrange todas as páginas filtradas. Seleções fora do filtro continuam marcadas e são indicadas na tela.
3. Confirme a seleção. Alterar a seleção ou buscar novamente na Nuvemshop invalida a confirmação anterior. Somente pedidos pagos e não cancelados são elegíveis nesta etapa.
4. Busque os pedidos na Olist. Essa consulta pode acontecer antes ou depois da seleção Nuvemshop. A preparação é mantida ao navegar entre as abas e ao atualizar a página na mesma aba do navegador.
5. Revise as correspondências. Ausências, ambiguidades, cancelamentos ou rastreios duplicados bloqueiam o início. Pedidos Olist fora da seleção são ignorados. Se um pedido ainda não foi importado, aguarde e consulte novamente, ampliando o período quando necessário.
6. Informe o responsável e inicie a bipagem. O servidor refaz o cruzamento a partir dos caches próprios, sem aceitar nomes, rastreios ou estados de bipagem enviados pelo navegador. Dados de preparação com mais de duas horas precisam ser consultados novamente.
7. Cada bipagem é gravada antes da confirmação visual. Ao recarregar, a sessão é recuperada do servidor; o navegador guarda apenas seu identificador e o usuário. Pedidos sem código aguardam consultas periódicas à Olist, preservando os já bipados. Um código compartilhado por dois pedidos não é aceito.
8. Com todos os pedidos bipados, salve o lote. Repetir o salvamento da mesma sessão retorna o mesmo lote. **Novo lote** só é habilitado depois do salvamento. Histórico e impressão reconhecem pedidos Nuvemshop e lotes Yampi antigos.

## Sincronização e limites

- Nuvemshop: API `2025-03`, Bearer token, User-Agent, paginação de 100 pedidos, limite de consulta de 10.000 resultados e espera ao receber HTTP 429. Apenas dados necessários à conferência são armazenados; o token nunca retorna nos endpoints de consulta.
- Olist: listagem dividida por página e dia, detalhes em grupos de cinco, timeout e retomada limitada após HTTP 429. O espaçamento em memória reduz chamadas por processo; instâncias diferentes ou outros aplicativos da conta ainda podem atingir o limite do ERP. As respostas do provedor determinam a espera e nenhum limite de infraestrutura foi aumentado.
- Webhook Olist: aceita `dados.id`, registra a fila e responde antes de consultar o ERP. O processamento usa reserva com expiração e versão do evento, evitando perder um novo webhook recebido durante o processamento. A fila mantém falhas para nova tentativa.
- Descoberta periódica: mantém dia e página no banco. O cron atual da Vercel continua diário (`0 3 * * *`, UTC), processa uma página de descoberta por conta e até cinco pedidos por execução. **Não constitui sincronização contínua** e pode acumular atraso sem webhooks. Para volume maior, configure um agendador mais frequente conforme o plano de hospedagem; o fluxo manual não depende desse cron.
- Rastreio continua vindo de `transportador.codigoRastreamento` na Olist. A futura troca para Nuvem Envio precisa de um pedido real para validar se esse campo continuará preenchido. Múltiplos volumes e rastreios por pedido ainda exigem modelagem própria.
- Uma sessão iniciada usa o estado validado na preparação. Mudanças de pagamento/cancelamento posteriores não são monitoradas continuamente na Nuvemshop. Antes de iniciar um lote, atualize as buscas após mudanças na operação.
- A recuperação automática aponta para a última sessão deste navegador/usuário. Não existe ainda um painel de sessões antigas nem bloqueio global contra a inclusão do mesmo pedido em sessões diferentes.

## Verificação

```powershell
npm.cmd install
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd audit
```

Os testes cobrem o vínculo real com dados fictícios de cliente, cancelamentos, ambiguidades, rastreios duplicados, Shift e filtros, isolamento dos rascunhos por usuário, paginação, HTTP 429, falhas de gravação e rastreios tardios. Um PostgreSQL isolado em memória (PGlite, dependência apenas de desenvolvimento) executa as migrações e verifica permissões, finalização idempotente, revisões concorrentes e recuperação da fila. Ele não acessa o Supabase real.

O Next.js foi atualizado dentro da linha 15; o PostCSS transitivo usa override para a versão corrigida compatível com a linha 8. O build local pode usar SWC em WebAssembly quando a política do Windows bloquear o binário nativo.

Para abrir a nova versão localmente, use `npm.cmd run dev` e acesse `http://localhost:3000`. O comando usa o compilador Webpack, compatível com o fallback WebAssembly desta máquina. A conferência visual não foi executada nesta sessão porque não havia navegador conectado. O build de produção e sete verificações HTTP locais de login/proteção de rotas passaram; os 25 testes automatizados e a auditoria de dependências também passaram.

## Referências oficiais

- [Aplicativos sob medida e geração do token](https://atendimento.nuvemshop.com.br/pt_BR/aplicativos/como-criar-aplicativos-sob-medida-e-gerar-tokens-para-minha-loja-nuvemshop)
- [API Nuvemshop: autenticação, identificação e limites](https://tiendanube.github.io/api-documentation/intro)
- [Pedidos: campos, filtros e paginação](https://tiendanube.github.io/api-documentation/resources/order)
- [Fulfillment Orders para a evolução dos envios](https://tiendanube.github.io/api-documentation/resources/fulfillment-order)
- [Webhook Tiny/Olist](https://tiny.com.br/api-docs/api2-webhooks-tiny)
