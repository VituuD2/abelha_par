"use client";
import { Select } from "@/components/ui/select";
import { LoadingRegion, RowsSkeleton } from "@/components/ui/loading-region";
import { ANALYTICS_REQUEST_TIMEOUT_MS } from "@/lib/request-timeouts";
import { DatePicker } from "@/components/ui/date-picker";

import { useCallback, useEffect, useRef, useState } from "react";
import { Building2, RefreshCw, Database } from "lucide-react";
import { ConnectionProgress } from "@/components/analytics/connection-progress";
import { OlistApiMonitor, useOlistApiUsage } from "./olist-api-monitor";
import { connectionHealth, type ConnectionHealth } from "@/lib/connection-status";
import { ConnectionStatus } from "@/components/ui/connection-status";
import { NinhoSection } from "./ninho-section";
import type { CoverageJob } from "@/lib/analytics/coverage";
import type { CostSyncStatus } from "@/lib/analytics/types";
import {
  analyticsOAuthErrors,
  type AnalyticsOAuthErrorCode,
} from "@/lib/analytics/oauth-errors";
type Company = { id: string; name: string; tax_id: string | null };
type Connection = {
  id: string;
  company_id: string;
  name: string;
  enabled: boolean;
  credential_kind: string;
  legacy_integration_id?: string | null;
  error_code?: string | null;
  verified_tax_id: string | null;
  verified_at: string | null;
  client_id: string | null;
  expires_at: string | null;
  refresh_expires_at?: string | null;
  health?: ConnectionHealth;
  last_synced_at: string | null;
  last_error: string | null;
};
type Source = {
  id: string;
  name: string;
  connection_id: string;
  kind: string;
  marketplace: string | null;
  store: string | null;
  external_account: string | null;
};
type Job = {
  id: string;
  connection_id: string;
  mode: string;
  from_date: string;
  to_date: string;
  cursor_date: string;
  page_offset: number;
  processed: number;
  pages: number;
  status: string;
  last_error: string | null;
  next_at: string;
  error_code?: string | null;
};
type State = {
  companies: Company[];
  connections: Connection[];
  sources: Source[];
  jobs: Job[];
  coverage?: CoverageJob[];
  costSync?: CostSyncStatus | null;
};
async function call(path: string, body?: unknown) {
  const response = await fetch(
    path,
    body === undefined
      ? { cache: "no-store", signal: AbortSignal.timeout(ANALYTICS_REQUEST_TIMEOUT_MS) }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(ANALYTICS_REQUEST_TIMEOUT_MS),
        },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Operação indisponível.");
  return data;
}
function SourceForm({
  source,
  name,
  save,
}: {
  source: Source;
  name: string;
  save: (body: unknown) => Promise<void>;
}) {
  const [kind, setKind] = useState(source.kind),
    [marketplace, setMarketplace] = useState(source.marketplace || ""),
    [store, setStore] = useState(source.store || ""),
    [account, setAccount] = useState(source.external_account || "");
  const [confirmed, setConfirmed] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save({
          action: "source",
          id: source.id,
          kind,
          marketplace,
          store,
          account,
          confirmAccount: confirmed,
        });
      }}
      className="rounded-xl border border-[var(--color-border-light)] p-4 space-y-3"
    >
      <h4 className="text-sm font-semibold">
        {source.name} · {name}
      </h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="text-xs">
          <Select
            label="Tipo"
            className="field mt-1"
            value={kind}
            onValueChange={(e) => setKind(e)}
          >
            <option value="unknown">Não classificado</option>
            <option value="marketplace">Marketplace</option>
            <option value="site">Site</option>
            <option value="direct">Venda direta</option>
            <option value="other">Outro</option>
          </Select>
        </div>
        <label className="text-xs">
          Marketplace
          <input
            className="field mt-1"
            value={marketplace}
            maxLength={160}
            onChange={(e) => setMarketplace(e.target.value)}
          />
        </label>
        <label className="text-xs">
          Loja
          <input
            className="field mt-1"
            value={store}
            maxLength={160}
            onChange={(e) => setStore(e.target.value)}
          />
        </label>
        <label className="text-xs">
          Conta externa canônica
          <input
            className="field mt-1"
            value={account}
            maxLength={160}
            onChange={(e) => {
              setAccount(e.target.value);
              setConfirmed(false);
            }}
          />
        </label>
      </div>

      {account !== (source.external_account || "") && (
        <label className="text-xs flex items-start gap-2">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          Confirmei que esta identidade representa a mesma conta externa.
          Autorizar reconciliação das referências de pedidos já importados.
        </label>
      )}
      <button className="btn-ghost" type="submit">
        Salvar classificação
      </button>
    </form>
  );
}
export function AnalyticsConnections({ onRefreshWebhooks }: { onRefreshWebhooks?: () => Promise<void> }) {
  const usage = useOlistApiUsage();
  const [state, setState] = useState<State | null>(null),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const [companyId, setCompanyId] = useState(""),
    [companyName, setCompanyName] = useState(""),
    [taxId, setTaxId] = useState("");
  const [newCompany, setNewCompany] = useState(""),
    [name, setName] = useState(""),
    [clientId, setClientId] = useState(""),
    [clientSecret, setClientSecret] = useState(""),
    [credentialConnection, setCredentialConnection] = useState("");
  const [importConnection, setImportConnection] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const [callbackOrigin, setCallbackOrigin] = useState("");
  const applicationForm = useRef<HTMLDetailsElement>(null);
  const loadVersion = useRef(0);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const configureApplication = (connection: Connection) => {
    setCredentialConnection(connection.id);
    setClientId(connection.client_id || "");
    setClientSecret("");
    if (applicationForm.current) {
      applicationForm.current.open = true;
      applicationForm.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  };
  const load = useCallback(async (foreground = false, refreshWebhooks = false) => {
    if (foreground) setConnectionsLoading(true);
    const version = ++loadVersion.current;
    try {
      const [next] = await Promise.all([call("/api/analytics/connections"), refreshWebhooks ? onRefreshWebhooks?.() : undefined]);
      if (version === loadVersion.current) setState(next);
    } catch (e) {
      if (version === loadVersion.current) setError(
        e instanceof Error ? e.message : "Camada analítica indisponível.",
      );
    } finally { if (foreground) setConnectionsLoading(false); }
  }, [onRefreshWebhooks]);
  useEffect(() => {
    setCallbackOrigin(window.location.origin);
    void load();
    const query = new URLSearchParams(window.location.search);
    const code = query.get("analyticsError");
    if (code !== null)
      setError(
        Object.hasOwn(analyticsOAuthErrors, code)
          ? analyticsOAuthErrors[code as AnalyticsOAuthErrorCode]
          : analyticsOAuthErrors.configuration,
      );
    if (query.has("analyticsConnected"))
      setNotice("Conta autorizada e CNPJ validado.");
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void load(false, true);
    }, 15000);
    return () => clearInterval(timer);
  }, [load]);
  const save = async (body: unknown) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await call("/api/analytics/connections", body);
      setNotice(saved?.scheduled
        ? "Atualização do CMV agendada."
        : "Configuração salva.");
      await load(true, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao configurar.");
    } finally {
      setBusy(false);
    }
  };
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await call("/api/analytics/sync", {
        action: "import",
        connection: importConnection,
        from,
        to,
      });
      setNotice("Importação agendada.");
      await load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao importar.");
    } finally {
      setBusy(false);
    }
  };
  const retry = async (job: string) => {
    setBusy(true);
    setError(null);
    try {
      await call("/api/analytics/sync", { action: "retry", job });
      await load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao retomar.");
    } finally {
      setBusy(false);
    }
  };
  const attention = state?.connections.filter(c => !["connected", "paused"].includes((c.health || connectionHealth(c)).code)).length || 0;
  return (
    <NinhoSection title="Conexões da Curva ABC" icon={Building2}
      status={<span className={`badge ${error || attention ? "badge-pending" : ""}`}>
        {error ? "Verificar" : !state ? "Verificando…" : attention ? `${attention} ${attention === 1 ? "pendência" : "pendências"}` : `${state.connections.length} contas`}
      </span>}
      actions={
        <button
          aria-label="Atualizar conexões analíticas"
          className="btn-ghost"
          disabled={connectionsLoading}
          onClick={() => void load(true, true)}
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      }>
      {error && (
        <p role="alert" className="text-sm text-[var(--color-accent-red)]">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-[var(--color-accent-green)]">
          {notice}
        </p>
      )}
      <LoadingRegion label="Contas e conexões analíticas" loading={connectionsLoading || (!state && !error)} preserveHeight={!!state} className="min-h-80" skeleton={<RowsSkeleton rows={5} />}>
      <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {state?.connections.map((c) => {
          const health = c.health || connectionHealth(c);
          const company = state.companies.find(company => company.id === c.company_id);
          const authorized = !["configure", "authorize", "reconnect", "relink"].includes(health.action || "") && health.code !== "unavailable";
          const costs = state.costSync?.connection_id === c.id ? state.costSync : null;
          const pendingJobs = state.jobs.filter(job => job.connection_id === c.id && job.status !== "completed").length;
          return (
            <article key={c.id} aria-label={`Conexão ${c.name}`} className="min-w-0 rounded-2xl border border-[var(--color-border-medium)] bg-[var(--color-bg-secondary)] p-4 space-y-4">
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 basis-32">
                  <h3 className="break-words text-base font-semibold">{c.name}</h3>
                  {company?.name !== c.name && <p className="break-words text-xs text-[var(--color-text-secondary)]">{company?.name}</p>}
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)]">CNPJ {c.verified_tax_id || company?.tax_id || "pendente"}{c.verified_at && " · validado"}</p>
                </div>
                <ConnectionStatus health={health} />
              </header>
              {health.code !== "connected" && health.code !== "paused" && c.last_error && <p className="break-words text-xs text-[var(--color-accent-orange)]" role="status">{c.last_error}</p>}
              <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-y border-[var(--color-border-light)] py-3 text-xs">
                <div className="min-w-0"><dt className="text-[var(--color-text-secondary)]">Última importação</dt><dd className="mt-1 font-medium tabular-nums">{c.last_synced_at ? new Date(c.last_synced_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "aguardando"}</dd></div>
                <div className="text-right"><dt className="text-[var(--color-text-secondary)]">Fila de importação</dt><dd className="mt-1 font-medium tabular-nums">{pendingJobs} {pendingJobs === 1 ? "tarefa" : "tarefas"}</dd></div>
              </dl>
              <div className="[&_summary]:py-2 [&_summary]:text-xs [&>div>div:first-child]:bg-[var(--color-bg-elevated)]">
                <ConnectionProgress compact enabled={c.enabled} connection={c.id} jobs={state.jobs} coverage={state.coverage || []} onRetry={job => void retry(job)} busy={busy} />
              </div>
              <OlistApiMonitor connectionId={c.id} usage={usage} />
              {costs && <details className="border-t border-[var(--color-border-light)] pt-3 text-xs">
                <summary className="cursor-pointer py-2 font-medium">CMV · {costs.history ? `${costs.history.completed}/${costs.history.total} produtos` : "aguardando"}{costs.history?.pending ? ` · ${costs.history.pending} pendentes` : ""}</summary>
                <div className="mt-3 space-y-2">
                  <p className="text-[var(--color-text-secondary)]">Atualizado: {costs.history?.last_synced_at ? new Date(costs.history.last_synced_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "aguardando"}</p>
                  {(costs.last_error || costs.history?.last_error) && <p role="status" className="text-[var(--color-accent-orange)]">{costs.last_error || costs.history?.last_error}</p>}
                  <button className="btn-ghost" disabled={busy || !c.enabled || !authorized} onClick={() => save({ action: "refresh-costs" })}>Atualizar CMV</button>
                </div>
              </details>}
              <footer className="flex flex-wrap gap-2 border-t border-[var(--color-border-light)] pt-3">
                {health.action === "configure" && <button disabled={busy} className="btn-primary" onClick={() => configureApplication(c)}>Configurar aplicativo</button>}
                {health.action === "relink" && <button disabled={busy} className="btn-primary" onClick={() => save({ action: "relink", id: c.id })}>Restabelecer vínculo operacional</button>}
                {(health.action === "authorize" || health.action === "reconnect") && <a href={c.credential_kind === "legacy" ? "/api/auth/login" : `/api/analytics/oauth/login?connection=${c.id}`} className={`btn-primary ${busy ? "pointer-events-none opacity-50" : ""}`} aria-disabled={busy}>{health.action === "authorize" ? "Autorizar esta conta" : "Reconectar esta conta"}</a>}
                {health.action === "verify" && <button disabled={busy} className="btn-primary" onClick={() => save({ action: "verify", id: c.id })}>Validar CNPJ na API</button>}
                <details className="w-full text-xs">
                  <summary className="cursor-pointer py-2 font-medium">Gerenciar conexão</summary>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <button disabled={busy} className="btn-ghost" onClick={() => save({ action: c.enabled ? "pause" : "resume", id: c.id })}>{c.enabled ? "Pausar análise" : "Ativar análise"}</button>
                    {health.action !== "verify" && <button disabled={busy || !c.enabled || !authorized} className="btn-ghost" onClick={() => save({ action: "verify", id: c.id })}>Validar CNPJ na API</button>}
                    {c.credential_kind !== "legacy" && <button disabled={busy} className="btn-ghost" onClick={() => configureApplication(c)}>Alterar aplicativo</button>}
                  </div>
                </details>
              </footer>
            </article>
          );
        })}
      </div>
      {state && !state.connections.length && <p className="py-4 text-sm text-[var(--color-text-secondary)]">Nenhuma conta analítica cadastrada. Adicione uma conta Olist nas configurações abaixo.</p>}
      </LoadingRegion>
      <div className="space-y-3 border-t border-[var(--color-border-light)] pt-5">
      <h3 className="text-sm font-semibold">Configuração e importação</h3>
      <div className="grid items-start gap-3 lg:grid-cols-2">
      <details className="min-w-0 rounded-xl border border-[var(--color-border-light)] p-4 open:lg:col-span-2">
        <summary className="cursor-pointer font-medium text-sm">
          Cadastrar ou identificar empresa
        </summary>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save({
              action: "company",
              id: companyId || undefined,
              name: companyName,
              taxId,
            });
          }}
        >
          <div className="text-sm block">
            <Select
              label="Empresa"
              className="field mt-1"
              value={companyId}
              onValueChange={(e) => {
                setCompanyId(e);
                const c = state?.companies.find((c) => c.id === e);
                setCompanyName(c?.name || "");
                setTaxId(c?.tax_id || "");
              }}
            >
              <option value="">Nova empresa</option>
              {state?.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Nome
              <input
                required
                maxLength={120}
                className="field mt-1"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </label>
            <label className="text-sm">
              CNPJ
              <input
                required
                maxLength={18}
                className="field mt-1"
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
              />
            </label>
          </div>
          <button disabled={busy} className="btn-primary" type="submit">
            Salvar empresa
          </button>
        </form>
      </details>
      <details ref={applicationForm} className="min-w-0 rounded-xl border border-[var(--color-border-light)] p-4 open:lg:col-span-2">
        <summary className="cursor-pointer font-medium text-sm">
          Adicionar conta Olist ou atualizar aplicativo
        </summary>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save(
              credentialConnection
                ? {
                    action: "credentials",
                    id: credentialConnection,
                    clientId,
                    clientSecret,
                  }
                : {
                    action: "create",
                    company: newCompany,
                    name,
                    clientId,
                    clientSecret,
                  },
            ).then(() => setClientSecret(""));
          }}
        >
          <p className="text-xs text-[var(--color-text-secondary)]">
            Permissões: pedidos, produtos, notas e informações da conta.
          </p>
          <input
            aria-label="URL de retorno OAuth analítico"
            readOnly
            className="field text-xs"
            value={`${callbackOrigin}/api/analytics/oauth/callback`}
          />
          <div className="block text-sm">
            <Select
              label="Aplicativo"
              className="field mt-1"
              value={credentialConnection}
              onValueChange={(e) => setCredentialConnection(e)}
            >
              <option value="">Nova conexão</option>
              {state?.connections
                .filter((c) => c.credential_kind !== "legacy")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </div>
          {!credentialConnection && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="text-sm">
                <Select
                  label="Empresa"
                  required
                  className="field mt-1"
                  value={newCompany}
                  onValueChange={(e) => setNewCompany(e)}
                >
                  <option value="">Selecionar…</option>
                  {state?.companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <label className="text-sm">
                Nome da conexão
                <input
                  required
                  className="field mt-1"
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Client ID
              <input
                required
                className="field mt-1"
                value={clientId}
                maxLength={200}
                onChange={(e) => setClientId(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="text-sm">
              Client Secret
              <input
                required
                type="password"
                className="field mt-1"
                value={clientSecret}
                maxLength={2000}
                onChange={(e) => setClientSecret(e.target.value)}
                autoComplete="new-password"
              />
            </label>
          </div>
          {credentialConnection && (
            <p className="text-xs text-[var(--color-accent-orange)]">
              Salvar novas credenciais invalida a autorização desta conexão
              analítica. Será necessário autorizar novamente.
            </p>
          )}
          <button disabled={busy} className="btn-primary" type="submit">
            Salvar aplicativo
          </button>
        </form>
      </details>
      <details className="min-w-0 rounded-xl border border-[var(--color-border-light)] p-4 open:lg:col-span-2">
        <summary className="cursor-pointer font-medium text-sm">
          Classificar integrações, lojas e marketplaces
        </summary>
        <div className="mt-4 space-y-3">
          {state?.sources.length ? (
            state.sources.map((source) => (
              <SourceForm
                key={source.id}
                source={source}
                name={
                  state.connections.find((c) => c.id === source.connection_id)
                    ?.name || ""
                }
                save={save}
              />
            ))
          ) : (
            <p className="text-sm">
              As integrações aparecerão após importar os primeiros pedidos.
              Nenhuma lista fixa de marketplace é utilizada.
            </p>
          )}
        </div>
      </details>
      <details className="min-w-0 rounded-xl border border-[var(--color-border-light)] p-4 space-y-4 open:lg:col-span-2">
        <summary className="cursor-pointer font-medium text-sm">
          <Database aria-hidden="true" className="mr-2 inline h-4 w-4" />
          Importar outro período
        </summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
          className="grid gap-3 sm:grid-cols-3"
        >
          <div className="text-sm">
            <Select
              label="Conexão"
              required
              className="field mt-1"
              value={importConnection}
              onValueChange={(e) => setImportConnection(e)}
            >
              <option value="">Selecionar…</option>
              {state?.connections
                .filter((c) => c.enabled)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </div>
          <div className="text-sm">
            <DatePicker
              label="De"
              required
              className="field mt-1"
              value={from}
              max={to || undefined}
              onValueChange={(e) => setFrom(e)}
            />
          </div>
          <div className="text-sm">
            <DatePicker
              label="Até"
              required
              className="field mt-1"
              value={to}
              min={from || undefined}
              onValueChange={(e) => setTo(e)}
            />
          </div>
          <div className="sm:col-span-3 flex flex-wrap gap-3">
            <button className="btn-primary" disabled={busy}>Importar período</button>
          </div>
        </form>

      </details>
      </div>
      </div>
    </NinhoSection>
  );
}
