// Local reporting: supplied catalog + existing read-only snapshot; no production writes.
require('../tests/setup.cjs');
const fs=require('node:fs');
const catalog=require('../src/lib/analytics/data/composition-catalog.json');
const bases=require('../src/lib/analytics/data/base-products.json');
const review=require('../src/lib/analytics/data/composition-classification.json');
const {compositionSku}=require('../src/lib/analytics/composition.ts');
const {compositionRulesForWorkspace}=require('../src/lib/analytics/composition-server.ts');
const evidence='docs/evidencias/curva-abc-2026-10-19';
const snapshot=JSON.parse(fs.readFileSync(`${evidence}/produtos-classificacao-snapshot.json`,'utf8'));
const rules=compositionRulesForWorkspace(catalog.workspaceIds[0]);
const kits=[...catalog.kits,...catalog.manual,...review.aliases];
const known=new Map(kits.map(k=>[compositionSku(k.sku),k]));
const registered=snapshot.products.filter(p=>!p.external_id.startsWith('order:'));
const observed=new Map(registered.map(p=>[compositionSku(p.sku||''),p]));
const mapped=sku=>Boolean(rules.rules[sku]||rules.bundles[sku]);
const sorted=list=>list.sort((a,b)=>a.sku.localeCompare(b.sku));
const pending=sorted(Object.entries(rules.pending).map(([sku,reason])=>({sku,reason,name:observed.get(sku)?.name||known.get(sku)?.name||bases.products.find(p=>p.sku===sku)?.name||sku,observed:observed.has(sku)})));
const unresolved=[...observed.keys()].filter(sku=>!mapped(sku));
if(unresolved.some(sku=>!rules.pending[sku]))throw Error('Unexplained product in snapshot');
const mixed=sorted(Object.entries(rules.bundles).map(([sku,b])=>({sku,name:known.get(sku)?.name||sku,...b,missingCostSkus:b.components.filter(c=>!rules.referenceCosts[c.target]).map(c=>c.target)})));
const missingCosts=[...new Set(mixed.flatMap(b=>b.missingCostSkus))].sort().map(sku=>({sku,name:bases.products.find(p=>p.sku===sku)?.name||sku,sourceRow:bases.products.find(p=>p.sku===sku)?.sourceRow,affectedSkus:mixed.filter(b=>b.missingCostSkus.includes(sku)).map(b=>b.sku),decision:review.costDecisions?.[sku]}));
const summary={generatedAt:new Date().toISOString(),catalogVersion:catalog.version,snapshotAt:snapshot.at,source:bases.source,simpleProducts:bases.products.length,acceptedSimpleProducts:bases.products.filter(p=>p.eligible).length,acceptedKits:kits.filter(k=>mapped(k.sku)).length,executableSingleRules:Object.keys(rules.rules).length,mixedKits:mixed.length,mixedKitsWithValidCMV:mixed.filter(b=>!b.missingCostSkus.length).length,importedProductRecords:snapshot.products.length,unlinkedRecords:snapshot.products.length-registered.length,registeredRecords:registered.length,matchedRegisteredRecords:registered.filter(p=>mapped(compositionSku(p.sku||''))).length,observedUnresolvedSkus:unresolved.length,pendingCatalogSkus:pending.length,remaining:pending,missingCosts,mixed,unitDecisions:review.unitDecisions,warnings:review.warnings};
fs.writeFileSync(`${evidence}/classificacao-produtos.json`,JSON.stringify(summary,null,2)+'\n');
const cell=v=>String(v??'').replaceAll('|','\\|').replace(/\r?\n/g,' ');
const money=c=>c===undefined?'CMV pendente':`R$ ${(Number(c)/100).toFixed(2).replace('.',',')}`;
const source=`Fonte: ${bases.source.file}; aba ${bases.source.sheet}; coluna L (${bases.source.costHeader}); SHA-256 ${bases.source.sha256}.`;
const pendingTable=['| SKU | Produto | O que falta | No snapshot |','| --- | --- | --- | --- |',...pending.map(p=>`| ${p.sku} | ${cell(p.name)} | ${cell(p.reason)} | ${p.observed?'Sim':'Não'} |`)];
const costTable=['| SKU | Produto | Custo na coluna L | Linha | Combos afetados |','| --- | --- | --- | --- | --- |',...missingCosts.map(p=>`| ${p.sku} | ${p.name} | ${p.decision?.decision==='maintain_zero'?'Mantido zerado por decisão do responsável':'Zero; confirmar CMV se necessário'} | ${p.sourceRow} | ${p.affectedSkus.join(', ')} |`)];
const units=[
 '- ACTM001-K052 → 1 × ACBF000-K050 + 1 × ACTM001-K002. O silicone é um par de estoque; não multiplicar novamente por dois.',
 '- CMPO0BC-K002 → 1 × CMPO00B-K001 + 1 × CMPO00C-K001.',
 '- HBCOMAX-K003/K004/K006 → respectivamente 3, 4 e 6 bisnagas de HBCOMAX-K001. A caixa do fornecedor contém duas bisnagas; a unidade da análise é a bisnaga.',
 '- EBBF001-001 continua excluída como embalagem auxiliar nos kits aprovados; os SKUs de origem são preservados.',
 '- KITGR-M001S e AKGMR-R001 → 1 × SBGF00M-K001 (Garrafa SoulBM Martelada) + 1 × SBLL001-K001 (Raspador PREMIUM).',
 '- KITGR-G001S → 1 × SBGF00G-K001 (Garrafa SoulBM Grafias) + 1 × SBLL001-K001 (Raspador PREMIUM).',
 '- CMNV150-K002 → 2 × CMNV150-K001 (Nivea 150g), inclusive nos itens sem vínculo de catálogo explicitamente confirmados pelo responsável.',
 '- 2165 → 1 × DDCO00N-K001 (Colbert Noir), inclusive nos itens sem vínculo de catálogo explicitamente confirmados pelo responsável.',
];
const allocation=[
 'Peso de cada produto = quantidade na composição × CMV unitário do produto simples. Valor atribuído = valor bruto vendido do kit × peso do produto ÷ soma dos pesos. A quantidade vendida do kit multiplica a quantidade de cada componente.', '',
 'Cada linha original é rateada separadamente com aritmética decimal exata. Os centavos restantes vão para os maiores restos, com desempate pelo SKU. Com custos completos, a soma reproduz integralmente o valor vendido.', '',
 'Exemplo: um kit de fita (CMV R$ 5,00) + um par de silicone (CMV R$ 3,60), vendido por R$ 100,00, atribui R$ 58,14 à fita e R$ 41,86 ao silicone. Gera uma unidade de estoque de cada SKU.', '',
 'É um rateio gerencial pelo custo de referência da exportação, não o CMV histórico de cada pedido nem cálculo de margem. Vendas com destino único preservam integralmente o valor e dispensam CMV para o rateio.', '',
 'Sem custo válido de todos os componentes, o valor inteiro da linha fica sinalizado como não rateado. A Curva por valor pede o CMV faltante; a Curva por quantidade mantém as unidades completas, informa o valor original/sem rateio e mostra apenas o valor já atribuído aos produtos. Zero não é interpretado como custo gratuito.',
];
const application='Se a última migração aplicada ainda é a v13, executar primeiro [migration_v14_v15_analytics_complete.sql](../supabase/migration_v14_v15_analytics_complete.sql), inteiro, no SQL Editor do Supabase. Se v15 já foi aplicada, não precisa reaplicar esse consolidado. Em seguida, executar [migration_v16_analytics_confirmed_unlinked.sql](../supabase/migration_v16_analytics_confirmed_unlinked.sql) para permitir apenas os vínculos explicitamente confirmados de itens sem catálogo, e publicar o aplicativo correspondente. A v16 preserva os dados e checkpoints originais. As novas rotas de consulta exigem a v16 para não ignorar silenciosamente as regras. Nenhuma migração ou publicação foi executada em produção nesta entrega.';
const write=(path,lines)=>fs.writeFileSync(path,lines.join('\n')+'\n');
write('docs/curva-abc-composicoes-pendentes.md',[
 '# Composições pendentes','',`Atualização: 19/10/2026. Catálogo ${catalog.version}. ${source}`,'',
 `Os ${mixed.length} combos documentados com componentes diferentes agora são desmembrados nos produtos simples. Os três Corega foram confirmados em bisnagas, e os três kits de garrafa foram confirmados com garrafas SoulBM e raspador premium. Restam **${pending.length} cadastros para revisão**, dos quais ${unresolved.length} aparecem no snapshot de ${snapshot.at}.`,'',...pendingTable,'',
 '## Custo mantido zerado','',...costTable,'','O responsável solicitou manter a Fita Seios zerada, pois acredita que não há vendas. Essa ausência de vendas não foi comprovada por nova consulta. Se aparecer venda de combo afetado, suas quantidades continuam disponíveis e o valor fica sinalizado como não rateado; não atribuir custo por suposição.','',
 '## Unidades confirmadas','',...units,'','## Alerta histórico separado','',...review.warnings.map(w=>`- ${w.sku}: ${w.reason} Afeta ${w.affectedSkus.join(', ')}. Sem substituir por outro modelo.`),'',
 `${summary.unlinkedRecords} registros sem vínculo ao catálogo no snapshot mantêm a identidade original por pedido/posição; não representam necessariamente produtos físicos distintos. Na visão Produtos base, apenas SKUs com allowUnlinked=true, confirmados pelo responsável, podem contribuir para o produto padrão. Os demais continuam separados.`,'','Detalhes: [componentes e CMV](curva-abc-componentes-cmv-2026-10-19.md).',
]);
write('docs/curva-abc-produtos-base.md',[
 '# Produtos base e custos de referência','',source,'','119 cadastros comerciais e um TESTE. Venda direta equivale a uma unidade de estoque: ACTM001-K002 é um par; HBCOMAX-K001 é uma bisnaga. Os custos são de referência da exportação, não históricos de cada venda.','',
 '| SKU | Produto | Unidade declarada | Linha | CMV de referência | Tratamento |','| --- | --- | --- | --- | --- | --- |',
 ...bases.products.map(p=>`| ${p.sku} | ${cell(p.name)} | ${cell(p.unit)} | ${p.sourceRow} | ${money(p.referenceCostCents)} | ${!p.eligible?'TESTE: revisão':p.referenceCostCents==='0'?'Custo zerado; confirmar se necessário ao rateio':'Produto base; fator 1'} |`),'',
 'A referência histórica ACESG15-K001 não consta nesta exportação e permanece sinalizada separadamente. A planilha original foi somente lida.',
]);
write('docs/curva-abc-componentes-cmv-2026-10-19.md',[
 '# Componentes e rateio pelo CMV — 19/10/2026','',`Catálogo ${catalog.version}: ${mixed.length} combos com vários componentes; ${summary.mixedKitsWithValidCMV} com todos os custos válidos.`,'',source,'','## Regra aplicada','',...allocation,'','## CMV pendente','',...costTable,'','## Unidades de estoque','',...units,'','## Composições resolvidas','',
 '| Kit/variação | Componentes | CMV unitário | Rateio |','| --- | --- | --- | --- |',...mixed.map(b=>`| ${b.sku} | ${b.components.map(c=>`${c.factor} × ${c.target} (${cell(c.name)})`).join('; ')} | ${b.components.map(c=>`${c.target}: ${money(rules.referenceCosts[c.target])}`).join('; ')} | ${b.missingCostSkus.length?'CMV pendente: '+b.missingCostSkus.join(', '):'Por CMV × quantidade'} |`),'','## Aplicação','',application,'',
 'Os filtros continuam incidindo sobre os itens originais antes do desmembramento. O total usa pedidos distintos. Produtos sem composição confirmada continuam separados, com seu valor original; essa pendência difere da falta de CMV de uma composição conhecida.',
]);
write('docs/curva-abc-classificacao-produtos-2026-10-19.md',[
 '# Classificação dos produtos — 19/10/2026','',`Catálogo ${catalog.version}. Cruzamento de ${bases.products.length} produtos simples, 425 kits antigos, três vínculos manuais, ${review.aliases.length} aliases revisados e ${snapshot.products.length} registros do snapshot de leitura ${snapshot.at}.`,'',
 `Resultado: ${summary.acceptedSimpleProducts} produtos base comerciais, ${summary.acceptedKits} vínculos de kits/variações aceitos, ${summary.executableSingleRules} regras com destino único e ${summary.mixedKits} combos com vários destinos. Restam ${pending.length} cadastros para revisão e ${missingCosts.length} produto simples sem CMV positivo necessário aos combos.`,'',
 'Camel Toe K002 converte em duas unidades de ACAI000-K001. Os fatores respeitam unidade de estoque, modelo, tamanho e sabor. Nenhum sufixo é removido globalmente. Os vínculos revisados e suas evidências permanecem em composition-classification.json. Os kits de garrafa foram confirmados pelo responsável como uma garrafa SoulBM do respectivo modelo e um raspador premium.','',
 'As decisões do usuário confirmam desmembramento de kits mistos, silicone por par, Corega por bisnaga e rateio pelo CMV × quantidade. Os três Corega anteriormente suspensos voltam à consolidação com fatores 3/4/6. Ter vários produtos na composição já não é motivo de pendência.','',
 '## Pendências restantes','',...pendingTable,'',...costTable,'','ACESG15-K001 segue como referência histórica ausente da exportação atual, sem substituir pelo espelho de outro tamanho.','',
 '## Rastreabilidade e aplicação','',source,'','As linhas de origem e custos inteiros em centavos estão em base-products.json. As regras são compiladas no servidor e limitadas ao workspace revisado; regras enviadas pelo navegador não são aceitas. Quantidades, rateio e ranking são calculados em SQL; a exportação usa o ranking completo.','',application,'',
 'Ver [produtos base](curva-abc-produtos-base.md), [pendências](curva-abc-composicoes-pendentes.md), [componentes e CMV](curva-abc-componentes-cmv-2026-10-19.md) e [evidência estruturada](evidencias/curva-abc-2026-10-19/classificacao-produtos.json).',
 '', '## Validação desta atualização', '',
 'Build e TypeScript aprovados. Lint sem erros, com os seis avisos anteriores. Suíte completa: 192 aprovados em 194; permanecem as duas falhas anteriores de progresso/cobertura da importação. Os dez testes novos passaram, cobrindo kits mistos, fatores por unidade de estoque, centavos, linhas repetidas, CMV ausente/zerado, erro acionável e apresentação do valor atribuído/original. A v15 foi aplicada duas vezes no banco isolado de testes, e as funções foram consultadas em transação somente leitura.', '',
 'Evidências: [testes-componentes-cmv.json](evidencias/curva-abc-2026-10-19/testes-componentes-cmv.json), [saída TAP](evidencias/curva-abc-2026-10-19/testes-componentes-cmv.tap) e [build-componentes-cmv.json](evidencias/curva-abc-2026-10-19/build-componentes-cmv.json). A validação de interface usa DOM simulado; não houve inspeção visual em navegador real nesta atualização.',
 '', 'Atualização do catálogo 2026-10-19.5: os três kits de garrafa passaram a apontar para uma garrafa SoulBM e um raspador premium. Os 23 testes direcionados de classificação/composição passaram com esse catálogo, incluindo a aplicação/reaplicação da migração consolidada. Essa alteração de catálogo não exige novo SQL; o arquivo consolidado v14 + v15 continua sendo o mesmo.',
 '', 'Atualização do catálogo 2026-10-19.6: CMNV150-K002 foi confirmado como 2 × CMNV150-K001, e 2165 como 1 × DDCO00N-K001. allowUnlinked=true permite exclusivamente esses SKUs mesmo sem ID de catálogo Olist. A permissão não se propaga aos produtos base ou a outros aliases. O histórico original é preservado; a conversão só ocorre na consulta. Exige v16 após v15. Os 32 testes direcionados de classificação, composição e API passaram, com aplicação e reaplicação da v16 em banco isolado, filtros, pedidos distintos, faturamento e proteção das demais identidades sem catálogo.',
]);
console.log(JSON.stringify({acceptedKits:summary.acceptedKits,singleRules:summary.executableSingleRules,mixedKits:mixed.length,mixedWithCMV:summary.mixedKitsWithValidCMV,pendingCatalog:pending.length,pendingObserved:unresolved.length,missingCosts}));
