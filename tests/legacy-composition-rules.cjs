// Frozen spreadsheet costs are fixtures only for regression tests of pre-v18 RPCs.
require('./setup.cjs');
const catalog=require('../src/lib/analytics/data/composition-catalog.json');
const bases=require('../src/lib/analytics/data/base-products.json');
const {compositionRulesForWorkspace}=require('../src/lib/analytics/composition-server.ts');
exports.rules={
 ...compositionRulesForWorkspace(catalog.workspaceIds[0]),
 referenceCosts:Object.fromEntries(bases.products.filter(p=>p.eligible&&p.referenceCostCents&&/^\d+$/.test(p.referenceCostCents)&&BigInt(p.referenceCostCents)>0n).map(p=>[p.sku,p.referenceCostCents])),
 costSource:{file:bases.source.file,sheet:bases.source.sheet,column:bases.source.costColumn,sha256:bases.source.sha256},
};
