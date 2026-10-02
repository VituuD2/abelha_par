"use client";
import { useCallback, useEffect, useState } from "react";
import { Building2, RefreshCw, Database } from "lucide-react";
type Company = { id: string; name: string; tax_id: string | null };
type Connection = {
  id: string;
  company_id: string;
  name: string;
  enabled: boolean;
  credential_kind: string;
  verified_tax_id: string | null;
  verified_at: string | null;
  client_id: string | null;
  expires_at: string | null;
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
};
type State = {
  companies: Company[];
  connections: Connection[];
  sources: Source[];
  jobs: Job[];
};
const errors: Record<string, string> = {
  authorization:
    "A autorização foi negada, expirou ou já foi utilizada. Inicie novamente.",
  exchange:
    "O aplicativo não autorizou a troca de código. Confira as credenciais e a URL de retorno.",
  company:
    "O CNPJ retornado pela Olist difere da empresa escolhida. Nenhuma credencial foi vinculada.",
  save: "A conexão mudou ou o banco não salvou a autorização. Tente novamente.",
  configuration:
    "Não foi possível concluir ou validar a conta. Confira as permissões do aplicativo e tente novamente.",
};
async function call(path: string, body?: unknown) {
  const response = await fetch(
    path,
    body === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
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
        <label className="text-xs">
          Tipo
          <select
            className="field mt-1"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="unknown">Não classificado</option>
            <option value="marketplace">Marketplace</option>
            <option value="site">Site</option>
            <option value="direct">Venda direta</option>
            <option value="other">Outro</option>
          </select>
        </label>
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
      <p className="text-xs text-[var(--color-text-secondary)]">
        A mesma conta canônica permite deduplicar referências de pedidos entre
        conexões. Preencha somente com identidade externa comprovada. A
        reconciliação preserva uma origem determinística por venda e seus
        identificadores de importação.
      </p>
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
export function AnalyticsConnections() {
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
  const load = useCallback(async () => {
    try {
      setState(await call("/api/analytics/connections"));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Camada analítica indisponível.",
      );
    }
  }, []);
  useEffect(() => {
    setCallbackOrigin(window.location.origin);
    void load();
    const query = new URLSearchParams(window.location.search);
    if (query.has("analyticsError"))
      setError(errors[query.get("analyticsError")!] || errors.configuration);
    if (query.has("analyticsConnected"))
      setNotice("Conexão da Curva ABC autorizada e CNPJ validado.");
  }, [load]);
  const pending = state?.jobs.some((j) =>
    ["queued", "running", "retry"].includes(j.status),
  );
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      void load();
    }, 5000);
    return () => clearInterval(timer);
  }, [pending, load]);
  const save = async (body: unknown) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await call("/api/analytics/connections", body);
      setNotice("Configuração analítica salva.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao configurar.");
    } finally {
      setBusy(false);
    }
  };
  const run = async (action: "import" | "continue") => {
    setBusy(true);
    setError(null);
    try {
      await call("/api/analytics/sync", {
        action,
        connection: importConnection,
        from,
        to,
      });
      setNotice(
        "Importação programada. O progresso será atualizado abaixo; a rotina do servidor continua pelos checkpoints.",
      );
      await load();
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
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao retomar.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card p-5 sm:p-7 space-y-5">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-amber-100 p-3">
          <Building2 className="w-6 h-6 text-amber-700" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold">Conexões da Curva ABC</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Empresas, contas Olist e histórico de todas as origens.
          </p>
        </div>
        <button
          aria-label="Atualizar conexões analíticas"
          className="btn-ghost"
          onClick={load}
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-green-800">
          {notice}
        </p>
      )}
      <div className="space-y-3">
        {state?.connections.map((c) => (
          <div
            key={c.id}
            className="rounded-xl border border-[var(--color-border-light)] p-4 space-y-2"
          >
            <div className="flex flex-wrap justify-between gap-2">
              <h3 className="font-semibold">
                {c.name} ·{" "}
                {
                  state.companies.find((company) => company.id === c.company_id)
                    ?.name
                }
              </h3>
              <span className="badge">
                {!c.enabled
                  ? "Pausada"
                  : c.verified_at
                    ? "CNPJ validado"
                    : "Validação pendente"}
              </span>
            </div>
            <p className="text-xs text-[var(--color-text-secondary)]">
              CNPJ:{" "}
              {c.verified_tax_id ||
                state.companies.find((company) => company.id === c.company_id)
                  ?.tax_id ||
                "Informe o CNPJ da empresa"}{" "}
              ·{" "}
              {c.last_synced_at
                ? `Importado em ${new Date(c.last_synced_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
                : "Histórico pendente"}
            </p>
            {c.last_error && (
              <p className="text-xs text-red-800">{c.last_error}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {c.credential_kind === "legacy" ? (
                <span className="text-xs py-3">
                  Usa a autorização Olist operacional atual.
                </span>
              ) : (
                <a
                  href={`/api/analytics/oauth/login?connection=${c.id}`}
                  className="btn-primary"
                >
                  Autorizar esta conta
                </a>
              )}
              <button
                disabled={busy}
                className="btn-ghost"
                onClick={() => save({ action: "verify", id: c.id })}
              >
                Validar CNPJ na API
              </button>
              <button
                disabled={busy}
                className="btn-ghost"
                onClick={() =>
                  save({ action: c.enabled ? "pause" : "resume", id: c.id })
                }
              >
                {c.enabled ? "Pausar análise" : "Ativar análise"}
              </button>
            </div>
          </div>
        ))}
      </div>
      <details>
        <summary className="cursor-pointer font-semibold text-sm">
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
          <label className="text-sm block">
            Empresa
            <select
              className="field mt-1"
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                const c = state?.companies.find((c) => c.id === e.target.value);
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
            </select>
          </label>
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
      <details>
        <summary className="cursor-pointer font-semibold text-sm">
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
            Crie o aplicativo privado dentro da conta da empresa. Cadastre a URL
            de retorno abaixo e permita leitura de pedidos, produtos, notas e
            informações da conta. Depois salve e autorize a conexão.
          </p>
          <input
            aria-label="URL de retorno OAuth analítico"
            readOnly
            className="field text-xs"
            value={`${callbackOrigin}/api/analytics/oauth/callback`}
          />
          <label className="block text-sm">
            Aplicativo
            <select
              className="field mt-1"
              value={credentialConnection}
              onChange={(e) => setCredentialConnection(e.target.value)}
            >
              <option value="">Nova conexão</option>
              {state?.connections
                .filter((c) => c.credential_kind !== "legacy")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          {!credentialConnection && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Empresa
                <select
                  required
                  className="field mt-1"
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                >
                  <option value="">Selecionar…</option>
                  {state?.companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
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
            <p className="text-xs text-amber-800">
              Salvar novas credenciais invalida a autorização desta conexão
              analítica. Será necessário autorizar novamente.
            </p>
          )}
          <button disabled={busy} className="btn-primary" type="submit">
            Salvar aplicativo
          </button>
        </form>
      </details>
      <details>
        <summary className="cursor-pointer font-semibold text-sm">
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
      <div className="border-t border-[var(--color-border-light)] pt-5 space-y-4">
        <h3 className="font-semibold flex gap-2 items-center">
          <Database className="w-4 h-4" />
          Importação histórica e progresso
        </h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run("import");
          }}
          className="grid gap-3 sm:grid-cols-3"
        >
          <label className="text-sm">
            Conexão
            <select
              required
              className="field mt-1"
              value={importConnection}
              onChange={(e) => setImportConnection(e.target.value)}
            >
              <option value="">Selecionar…</option>
              {state?.connections
                .filter((c) => c.enabled)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-sm">
            De
            <input
              required
              type="date"
              className="field mt-1"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Até
            <input
              required
              type="date"
              className="field mt-1"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <div className="sm:col-span-3 flex flex-wrap gap-3">
            <button className="btn-primary" disabled={busy}>
              Importar período
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy || !pending}
              onClick={() => run("continue")}
            >
              Processar próximo lote
            </button>
          </div>
        </form>
        <p className="text-xs text-[var(--color-text-secondary)]">
          Importação retomável; alterações e cancelamentos são atualizados pela
          rotina incremental. Para continuar com o navegador fechado, configure
          a rotina analítica do servidor conforme a documentação de implantação.
        </p>
        <div className="max-h-80 overflow-auto space-y-3">
          {state?.jobs.slice(0, 30).map((j) => (
            <div key={j.id} className="rounded-xl bg-black/[0.025] p-3 text-xs">
              <p className="font-semibold">
                {state.connections.find((c) => c.id === j.connection_id)?.name}{" "}
                · {j.mode === "backfill" ? "Histórico" : "Atualizações"} ·{" "}
                {j.status}
              </p>
              <p className="mt-1">
                {j.from_date} a {j.to_date} · cursor {j.cursor_date} · {j.pages}{" "}
                páginas · {j.processed} pedidos processados
              </p>
              {j.last_error && (
                <p className="mt-1 text-red-800">{j.last_error}</p>
              )}
              {j.status === "failed" && (
                <button
                  className="btn-ghost mt-2"
                  disabled={busy}
                  onClick={() => retry(j.id)}
                >
                  Retomar este checkpoint
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
