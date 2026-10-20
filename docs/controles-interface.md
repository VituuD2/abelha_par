# Controles compartilhados

Os calendários e selects usam [React Aria Components](https://react-aria.adobe.com/DatePicker), com menus próprios e estilos no tema do aplicativo em `src/app/globals.css`. Foram substituídos os controles nativos visíveis das telas de pedidos, Curva ABC, busca de vendas e configurações do Ninho.

## Datas

```tsx
import { DatePicker } from "@/components/ui/date-picker";

<DatePicker label="De" value={from} onValueChange={setFrom} max={to} required />
```

A apresentação usa português brasileiro, com edição por teclado, calendário e seleção de mês/ano. O valor continua sendo uma string `YYYY-MM-DD`, sem conversão de fuso. `min`, `max`, `disabled`, `required` e `name` preservam limites e integração com formulários. Campos opcionais permitem limpar; o atalho Hoje respeita os limites.

## Seleções

```tsx
import { Select } from "@/components/ui/select";

<Select label="Pagamento" value={payment} onValueChange={setPayment}>
  <option value="">Todos os pagamentos</option>
  <option value="paid">Pago</option>
</Select>
```

O componente recebe opções, mas apresenta uma lista personalizada com busca por digitação, navegação por teclado e estados de foco, seleção e bloqueio. Use `label` ou `aria-label`; as opções podem ser `disabled`. O campo nativo oculto serve à acessibilidade e ao envio de formulários, sem exibir o menu do navegador.

Dentro de um `<dialog>` nativo, passe seu elemento em `popoverContainer` para que o menu permaneça na camada do modal e receba os cliques.

Campos de texto, senhas, números, busca, caixas de seleção e rádios herdam o tema global. Controles ativos mostram cursor de ação, edição usa cursor de texto e controles bloqueados indicam indisponibilidade.

Na Curva ABC, todas as células da linha abrem o mesmo detalhe de pedidos. Enter e Espaço também abrem a linha em foco; o botão do nome impede a propagação do clique para evitar abertura duplicada.

O modal permite escolher diretamente uma página de pedidos, além de avançar e voltar. Durante a troca, mantém a tabela e os totais atuais, informa a página que está sendo carregada e bloqueia os controles de paginação até concluir. Se houver falha, preserva a página exibida e permite tentar novamente. Ao abrir outro produto ou mudar o escopo, os dados anteriores deixam de ser apresentados; respostas de consultas canceladas são ignoradas.

Esta alteração é de interface e não exige nova migração SQL. A remoção anterior do limite de produtos no gráfico continua dependendo da v22.
