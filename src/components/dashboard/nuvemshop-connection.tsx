"use client";

import { useCallback, useEffect, useState } from "react";
import { usePreparationStore } from "@/stores/preparation-store";

export function NuvemshopConnection({ onConnected }: { onConnected: (connected: boolean) => void }) {
  const [connected, setConnected] = useState(false);
  const [storeId, setStoreId] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/nuvemshop/connection", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setConnected(data.connected); onConnected(data.connected);
      setStoreId(data.storeId || ""); usePreparationStore.getState().setMapping(data.mapping);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível verificar a conexão."); }
    finally { setChecking(false); }
  }, [onConnected]);
  useEffect(() => { void load(); }, [load]);
  const connect = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const response = await fetch("/api/nuvemshop/connection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId, token }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setToken(""); usePreparationStore.getState().reset(); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível conectar."); }
    finally { setBusy(false); }
  };
  return <section className="card p-5 mb-5">
    <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Loja Nuvemshop</h2><p className="text-sm text-[var(--color-text-secondary)]">{checking ? "Verificando conexão…" : connected ? `Loja ${storeId} conectada` : "Conecte a loja para selecionar os pedidos do dia."}</p></div><span className={`badge ${connected ? "badge-checked" : "badge-pending"}`}>{connected ? "Conectada" : "Aguardando conexão"}</span></div>
    <details className="mt-3" open={!checking && !connected}><summary className="cursor-pointer text-sm text-[var(--color-accent-blue)]">{connected ? "Alterar conexão" : "Conectar com aplicativo sob medida"}</summary>
      <form onSubmit={connect} className="mt-4 grid sm:grid-cols-2 gap-3">
        <label className="text-sm">ID da loja<input required inputMode="numeric" pattern="[0-9]+" value={storeId} onChange={event => setStoreId(event.target.value)} className="field mt-1" /></label>
        <label className="text-sm">Token de acesso<input required type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} className="field mt-1" /></label>
        <p className="text-xs text-[var(--color-text-secondary)] sm:col-span-2">Use o aplicativo Abelha Par criado em Aplicativos sob medida, com leitura de pedidos e clientes. O token é guardado de forma protegida no servidor.</p>
        <button disabled={busy || !token || !storeId} className="btn-primary sm:col-span-2">{busy ? "Validando conexão…" : "Conectar loja"}</button>
      </form>
    </details>
    {error && <p role="alert" className="mt-3 text-sm text-[var(--color-accent-red)]">{error}</p>}
  </section>;
}
