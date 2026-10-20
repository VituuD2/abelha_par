import "server-only";
import catalog from "./data/composition-catalog.json";
import baseCatalog from "./data/base-products.json";
import classification from "./data/composition-classification.json";
import { buildCompositionRules } from "./composition";

const rules = buildCompositionRules(
  [...catalog.kits, ...catalog.manual, ...classification.aliases],
  catalog.version,
  catalog.ignoredComponentSkus,
  {
    baseProducts: baseCatalog.products.filter(product => product.eligible).map(({ sku, name }) => ({ sku, name })),
    pending: Object.fromEntries(classification.pending.map(item => [item.sku, item.reason])),
  },
);

/** This catalog belongs to one operation. Identical SKUs in other workspaces are unrelated. */
export function hasCompositionCatalog(workspaceId: string) {
  return catalog.workspaceIds.includes(workspaceId);
}

export function compositionRulesForWorkspace(workspaceId: string) {
  if (!hasCompositionCatalog(workspaceId))
    throw new Error("Ainda não há regras de composição revisadas para este espaço de trabalho.");
  return rules;
}
