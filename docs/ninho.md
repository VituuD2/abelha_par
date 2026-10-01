# Ninho: conexões compartilhadas e acesso da equipe

O Ninho (`/ninho`) reúne Olist, Nuvemshop, o vínculo entre os pedidos, o webhook e os usuários. Somente administradores acessam essa página ou alteram configurações pelas APIs. Operadores podem consultar pedidos, iniciar e retomar conferências, bipar e consultar o histórico compartilhado.

## Ativação

1. No **SQL Editor do Supabase do Abelha Par**, execute todo o arquivo `supabase/migration_v9_ninho_workspaces.sql`, depois das migrações até a v8.
2. Publique/inicie esta versão da aplicação depois de executar o SQL. A nova versão depende das tabelas e funções da v9.
3. Entre com a conta que atualmente possui as integrações. Ela será o primeiro administrador e verá **Ninho** no menu, com um ícone de abelha e engrenagem.
4. Em **Ninho → Usuários e permissões**, crie os usuários e defina seus perfis. As demais contas existentes na primeira aplicação da migração entram como operadores. Contas criadas diretamente no Auth posteriormente precisam de liberação explícita e não recebem acesso automaticamente.

O SQL é transacional e pode ser reaplicado: preserva tokens cifrados, datas de expiração, vínculo da Nuvemshop, cache, fila, sessões e histórico. A loja recebe o UUID do dono original das integrações para manter a URL já cadastrada do webhook. Não é necessário reconectar as integrações por causa desta migração. O script recusa a migração se houver integrações de donos diferentes, para evitar juntar lojas sem uma decisão explícita.

As colunas antigas `owner_id` são mantidas para compatibilidade durante a publicação. As novas consultas usam `workspace_id`, e os registros de conferência preservam o usuário que iniciou e registram quem atualizou/finalizou. O vínculo das credenciais com `auth.users` é removido, de modo que o acesso da loja não dependa da conta pessoal do primeiro administrador.

## Permissões

| Ação | Operador ativo | Administrador ativo |
| --- | --- | --- |
| Buscar pedidos na Olist/Nuvemshop | Sim | Sim |
| Criar, retomar, bipar e finalizar lotes da loja | Sim | Sim |
| Consultar o histórico compartilhado | Sim | Sim |
| Acessar o Ninho | Não | Sim |
| Conectar, reconectar e remover integrações | Não | Sim |
| Alterar o vínculo entre plataformas | Não | Sim |
| Copiar/rotacionar a URL e pausar/ativar o webhook | Não | Sim |
| Criar usuários, alterar perfis e bloquear acessos | Não | Sim |

O perfil é consultado em `workspace_members` no servidor; metadados enviados pelo usuário não concedem privilégios. Bloquear um usuário impede novas operações mesmo que sua sessão de login continue aberta. A RLS do histórico também exige participação ativa na loja. Tokens permanecem acessíveis apenas ao servidor. As funções de alteração de permissões impedem remover o último administrador ativo e serializam alterações concorrentes.

Usuários são criados com e-mail confirmado e senha inicial definida pelo administrador. A senha é entregue à pessoa por um canal escolhido pelo administrador; a criação não dispara um e-mail. As páginas existentes de recuperação/troca de senha continuam disponíveis. O bloqueio de um usuário não desconecta a loja.

## Webhook e renovação

O recebimento pode ser pausado sem apagar a conexão Olist. Gerar uma nova URL invalida a antiga: copie a nova URL e atualize **Notificações de vendas** na Olist. Apenas a rotação altera a URL; a migração inicial conserva a assinatura existente.

O cron de renovação continua usando `supabase/setup_olist_token_cron.sql` e o mesmo `CRON_SECRET`. A renovação agora encontra as integrações por loja, independentemente de qual operador esteja conectado. Os segredos do aplicativo e a chave de criptografia continuam configurados no servidor.

## Verificação

Execute `npm test`, `npm run typecheck` e `npm run build`. Os testes específicos do Ninho exercitam permissões pelas APIs, leitura compartilhada pela RLS, migração repetida com preservação de credenciais, finalização entre operadores, proteção do último administrador e rotação do webhook em um PostgreSQL isolado.
