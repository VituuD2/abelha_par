export type CompositionKit = {
  sku: string;
  name: string;
  components: { sku: string; name: string; quantity: string }[];
  auxiliaryComponents?: string[];
  /** Explicit business approval to map this exact SKU even without an ERP catalog ID. */
  allowUnlinked?: boolean;
};
export type CompositionOptions = {
  baseProducts?: { sku: string; name: string; referenceCostCents?: string }[];
  pending?: Record<string, string>;
};
export type CompositionComponent = { target: string; name: string; factor: string };
export type CompositionRules = {
  version: string;
  rules: Record<string, CompositionComponent & { ignoredComponents?: string[] }>;
  bundles: Record<string, { components: CompositionComponent[]; ignoredComponents?: string[] }>;
  unlinkedRules: CompositionRules["rules"];
  unlinkedBundles: CompositionRules["bundles"];
  pending: Record<string, string>;
  ignoredComponentSkus: string[];
  revenuePolicy: "cost";
  referenceCosts: Record<string, string>;
  costSource?: CompositionCostSource;
};
export type CompositionCostSource = {
  kind?: "olist";
  name?: string;
  connectionId?: string | null;
  field?: string;
  policy?: "current_reference" | "effective_date";
  basis?: "average" | "purchase";
  granularity?: "day";
  dateBasis?: "orders" | "invoiced";
  lastSyncedAt?: string | null;
  lastError?: string | null;
  file?: string;
  sheet?: string;
  column?: string;
  sha256?: string;
};
export const compositionSku = (value: string) => value.trim().toUpperCase();

/** Multiply declared conversion factors without converting quantities to float. */
function multiply(a: string, b: string) {
  const [aw, af = ""] = a.split("."), [bw, bf = ""] = b.split(".");
  const scale = af.length + bf.length;
  const digits = (BigInt(aw + af) * BigInt(bw + bf)).toString().padStart(scale + 1, "0");
  return scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, "") : digits;
}
function add(a: string, b: string) {
  const [aw, af = ""] = a.split("."), [bw, bf = ""] = b.split(".");
  const scale = Math.max(af.length, bf.length);
  const value = (BigInt(aw + af.padEnd(scale, "0")) + BigInt(bw + bf.padEnd(scale, "0"))).toString().padStart(scale + 1, "0");
  return scale ? `${value.slice(0, -scale)}.${value.slice(-scale)}`.replace(/\.?0+$/, "") : value;
}

/** Compile declared BOMs and reviewed catalog links; never infer new links from names/suffixes at runtime. */
export function buildCompositionRules(kits: CompositionKit[], version: string, ignoredComponentSkus: string[] = [], options: CompositionOptions = {}): CompositionRules {
  const ignored = new Set(ignoredComponentSkus.map(compositionSku));
  const result: CompositionRules = {
    version, rules: {}, bundles: {}, unlinkedRules: {}, unlinkedBundles: {}, pending: Object.fromEntries(Object.entries(options.pending || {}).map(([sku, reason]) => [compositionSku(sku), reason])),
    ignoredComponentSkus: [...ignored], revenuePolicy: "cost",
    referenceCosts: Object.fromEntries((options.baseProducts || []).filter(p => p.referenceCostCents && /^\d+$/.test(p.referenceCostCents) && BigInt(p.referenceCostCents) > BigInt(0)).map(p => [compositionSku(p.sku), p.referenceCostCents!])),
  };
  const sources = new Map<string, CompositionKit>();
  const canonicalNames = new Map<string, string>();
  for (const product of options.baseProducts || []) canonicalNames.set(compositionSku(product.sku), product.name);
  for (const original of kits) {
    const sku = compositionSku(original.sku);
    if (!sku || sku.length > 200) throw new Error("SKU de composição inválido.");
    const kit = { ...original, sku, components: original.components.map(c => ({ ...c, sku: compositionSku(c.sku) })) };
    const previous = sources.get(sku);
    if (previous && JSON.stringify(previous.components) !== JSON.stringify(kit.components))
      result.pending[sku] = "Composições conflitantes";
    else sources.set(sku, kit);
    for (const component of kit.components)
      if (component.sku && !canonicalNames.has(component.sku)) canonicalNames.set(component.sku, component.name || component.sku);
  }
  const visiting = new Set<string>();
  const resolved = new Map<string, { components: CompositionComponent[]; ignoredComponents?: string[] }>();
  function resolve(sku: string, depth = 0): { components: CompositionComponent[]; ignoredComponents?: string[] } | null {
    if (result.pending[sku]) return null;
    if (resolved.has(sku)) return resolved.get(sku)!;
    if (visiting.has(sku) || depth > 32) { result.pending[sku] = "Composição circular ou muito profunda"; return null; }
    const kit = sources.get(sku);
    if (!kit) return { components: [{ target: sku, name: canonicalNames.get(sku) || sku, factor: "1" }] };
    const auxiliary = (kit.auxiliaryComponents || []).map(compositionSku);
    if (auxiliary.some(component => !ignored.has(component))) {
      result.pending[sku] = "Produto com componente auxiliar: revisar política antes de consolidar"; return null;
    }
    const components = kit.components.filter(c => !ignored.has(c.sku));
    const ignoredHere = [...kit.components.filter(c => ignored.has(c.sku)).map(c => c.sku), ...auxiliary];
    if (!components.length) { result.pending[sku] = "Nenhum produto base após excluir os componentes auxiliares"; return null; }
    if (components.some(component => !component.sku || component.sku.length > 200 || !/^\d+(?:\.\d{1,6})?$/.test(component.quantity) || !/[1-9]/.test(component.quantity))) {
      result.pending[sku] = "Componente ou quantidade inválida"; return null;
    }
    visiting.add(sku);
    const totals = new Map<string, CompositionComponent>();
    const omitted = new Set(ignoredHere);
    let complete = true;
    for (const component of components) {
      const leaf = resolve(component.sku, depth + 1);
      if (!leaf) { complete = false; break; }
      for (const auxiliary of leaf.ignoredComponents || []) omitted.add(auxiliary);
      for (const simple of leaf.components) {
        const factor = multiply(component.quantity, simple.factor);
        const previous = totals.get(simple.target);
        totals.set(simple.target, { ...simple, factor: previous ? add(previous.factor, factor) : factor });
      }
    }
    visiting.delete(sku);
    if (!complete) { result.pending[sku] ||= "Componente com regra pendente"; return null; }
    const composition = { components: [...totals.values()].sort((a, b) => a.target < b.target ? -1 : a.target > b.target ? 1 : 0), ...(omitted.size ? { ignoredComponents: [...omitted] } : {}) };
    resolved.set(sku, composition);
    return composition;
  }
  for (const sku of sources.keys()) resolve(sku);
  for (const [sku, composition] of resolved) {
    if (composition.components.length === 1)
      result.rules[sku] = { ...composition.components[0], ...(composition.ignoredComponents ? { ignoredComponents: composition.ignoredComponents } : {}) };
    else result.bundles[sku] = composition;
  }
  // Direct sales of an explicitly identified base product share its canonical identity.
  for (const rule of [...Object.values(result.rules), ...Object.values(result.bundles).flatMap(bundle => bundle.components)])
    result.rules[rule.target] ||= { target: rule.target, name: rule.name, factor: "1" };
  // A simple catalog product is one stock unit, even when its SKU/name describes a pack.
  for (const product of options.baseProducts || []) {
    const sku = compositionSku(product.sku);
    if (!sources.has(sku) && !result.pending[sku]) result.rules[sku] ||= { target: sku, name: product.name, factor: "1" };
  }
  // Approval never propagates to other SKUs, nested sources or base identities.
  for (const [sku, source] of sources) {
    if (source.allowUnlinked !== true || result.pending[sku]) continue;
    if (result.rules[sku]) result.unlinkedRules[sku] = result.rules[sku];
    if (result.bundles[sku]) result.unlinkedBundles[sku] = result.bundles[sku];
  }
  return result;
}
