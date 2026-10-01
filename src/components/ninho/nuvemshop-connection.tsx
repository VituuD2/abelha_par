"use client";

import { useCallback, useEffect, useState } from "react";
import { Cloud } from "lucide-react";
import { usePreparationStore } from "@/stores/preparation-store";
import type { ReconciliationConfig } from "@/types";

export function NuvemshopConnection() {
  const [connected, setConnected] = useState(false);
  const [storeId, setStoreId] = useState("");
  const [token, setToken] = useState("");
  const [mapping, setMapping] = useState<ReconciliationConfig>({ ecommerceId: 0, referenceKind: "number", referenceField: "ecommerceOrderNumber" });
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => {
    const response = await fetch("/api/nuvemshop/connection", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível verificar a Nuvemshop.");
    setConnected(data.connected); setStoreId(data.storeId || "");
    if (data.mapping) setMapping(data.mapping);
  }, []);
  useEffect(() => { load().catch(reason => setError(reason.message)).finally(() => setChecking(false)); }, [load]);
  async function save(method: "POST" | "PATCH" | "DELETE") {
    if (method === "DELETE" && !window.confirm("Remover a conexão Nuvemshop para toda a equipe?")) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/nuvemshop/connection", { method, headers: { "Content-Type": "application/json" }, ...(method !== "DELETE" ? { body: JSON.stringify(method === "POST" ? { storeId, token } : mapping) } : {}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar a configuração.");
      setToken(""); usePreparationStore.getState().reset(); await load();
      setNotice(method === "DELETE" ? "Conexão removida da colmeia." : "Configuração salva para toda a equipe.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao configurar a Nuvemshop."); }
    finally { setBusy(false); }
  }
  return <section className="card p-6 sm:p-7 space-y-5">
    <div className="flex items-center gap-3"><div className="rounded-xl p-3 bg-[var(--color-accent-blue)]/10"><Cloud className="w-6 h-6 text-[var(--color-accent-blue)]" /></div><div className="flex-1"><h2 className="text-lg font-semibold">Nuvemshop</h2><p className="text-sm text-[var(--color-text-secondary)]">{checking ? "Verificando conexão…" : connected ? `Loja ${storeId} · compartilhada com a equipe` : "Conecte a loja para consultar pedidos."}</p></div><span className={`badge ${connected ? "badge-checked" : "badge-pending"}`}>{connected ? "Conectada" : "Desconectada"}</span></div>
    <details open={!checking && !connected}><summary className="cursor-pointer text-sm font-semibold text-[var(--color-accent-blue)]">{connected ? "Alterar conexão" : "Conectar loja"}</summary><form className="grid sm:grid-cols-2 gap-4 mt-4" onSubmit={event => { event.preventDefault(); void save("POST"); }}>
      <label className="text-sm">ID da loja<input required className="field mt-1" inputMode="numeric" pattern="[0-9]+" maxLength={20} value={storeId} disabled={busy} onChange={event => setStoreId(event.target.value)} /></label>
      <label className="text-sm">Token de acesso<input required className="field mt-1" type="password" autoComplete="off" maxLength={4096} value={token} disabled={busy} onChange={event => setToken(event.target.value)} /></label>
      <p className="sm:col-span-2 text-xs text-[var(--color-text-secondary)]">Use o aplicativo Abelha Par em Aplicativos sob medida, com leitura de pedidos e clientes. O token fica protegido e não é exibido aos operadores.</p>
      <button className="btn-primary sm:col-span-2" disabled={busy || !token || !storeId}>{busy ? "Validando…" : connected ? "Salvar nova conexão" : "Conectar Nuvemshop"}</button>
    </form></details>
    {connected && <form className="space-y-4 pt-5 border-t border-[var(--color-border-light)]" onSubmit={event => { event.preventDefault(); void save("PATCH"); }}>
      <div><h3 className="font-semibold">Vínculo com a Olist</h3><p className="text-xs text-[var(--color-text-secondary)] mt-1">Defina como os pedidos das duas plataformas se correspondem.</p></div>
      <label className="block text-sm">ID da integração Nuvemshop na Olist<input className="field mt-1" type="number" min="1" step="1" required value={mapping.ecommerceId || ""} disabled={busy} onChange={event => setMapping({ ...mapping, ecommerceId: Number(event.target.value) })} /></label>
      <div className="grid sm:grid-cols-2 gap-4"><label className="text-sm">Referência Nuvemshop<select className="field mt-1" value={mapping.referenceKind} disabled={busy} onChange={event => setMapping({ ...mapping, referenceKind: event.target.value as "id" | "number" })}><option value="number">Número do pedido</option><option value="id">ID interno do pedido</option></select></label><label className="text-sm">Campo correspondente na Olist<select className="field mt-1" value={mapping.referenceField} disabled={busy} onChange={event => setMapping({ ...mapping, referenceField: event.target.value as ReconciliationConfig["referenceField"] })}><option value="ecommerceOrderNumber">Número do pedido no e-commerce</option><option value="ecommerceChannelOrderNumber">Número do pedido no canal de venda</option></select></label></div>
      <div className="flex flex-wrap gap-3"><button className="btn-primary" disabled={busy || !mapping.ecommerceId}>Salvar vínculo</button><button type="button" className="btn-ghost text-[var(--color-accent-red)]" disabled={busy} onClick={() => save("DELETE")}>Remover conexão</button></div>
    </form>}
    {error && <p role="alert" className="text-sm text-[var(--color-accent-red)]">{error}</p>}
    {notice && <p role="status" className="text-sm text-[var(--color-accent-green)]">{notice}</p>}
  </section>;
}
