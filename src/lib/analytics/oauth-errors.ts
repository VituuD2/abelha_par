/** Fixed messages shared by the callback and Ninho; provider payloads stay private. */
export const analyticsOAuthErrors = {
  authorization:
    "A autorização foi negada, expirou ou já foi utilizada. Clique em Autorizar esta conta para iniciar novamente.",
  credentials:
    "Não foi possível ler as credenciais protegidas. Salve novamente o aplicativo desta conexão e autorize a conta.",
  exchange:
    "A Olist recusou a troca do código por tokens. Confira o Client ID, o Client Secret e a URL de retorno do aplicativo desta empresa; depois autorize novamente.",
  token_request:
    "Não foi possível alcançar o servidor de autenticação da Olist. Clique em Autorizar esta conta para tentar novamente.",
  token_response:
    "O servidor de autenticação da Olist retornou uma resposta de tokens inválida. A conexão não foi salva; autorize novamente.",
  company:
    "O CNPJ retornado pela Olist difere da empresa escolhida. Entre na conta Olist desta empresa ao autorizar. Nenhuma credencial foi vinculada.",
  company_configuration:
    "Não foi possível consultar o CNPJ cadastrado da empresa. Confira o cadastro no Ninho e autorize novamente.",
  account_permission:
    "A autorização retornou da Olist, mas a consulta do CNPJ foi negada (HTTP 403). Habilite leitura de Informações da Conta no aplicativo desta empresa, atualize as credenciais se forem renovadas e autorize novamente.",
  account_authorization:
    "A autorização retornou da Olist, mas a consulta do CNPJ foi recusada (HTTP 401). Confira o acesso do usuário Olist a Informações da Conta e as permissões do aplicativo; depois autorize novamente.",
  account_rate_limit:
    "A Olist limitou a consulta do CNPJ (HTTP 429). Aguarde antes de clicar em Autorizar esta conta novamente.",
  account_unavailable:
    "A autorização retornou da Olist, mas a consulta do CNPJ falhou por timeout ou indisponibilidade, mesmo após nova tentativa. A conexão não foi salva; clique em Autorizar esta conta para tentar novamente.",
  account_response:
    "A consulta de Informações da Conta não retornou um CNPJ válido. Confira essa permissão no aplicativo e autorize novamente.",
  save:
    "A conexão mudou ou o banco não salvou a autorização. Clique em Autorizar esta conta para tentar novamente.",
  configuration:
    "Não foi possível concluir a autorização Olist. Clique em Autorizar esta conta para iniciar uma nova tentativa.",
};

export type AnalyticsOAuthErrorCode = keyof typeof analyticsOAuthErrors;
