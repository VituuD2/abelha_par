"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, Users } from "lucide-react";

type Member = { user_id: string; display_name: string; email: string; role: "admin" | "operator"; active: boolean };

function MemberRow({ member, currentUserId, onSave, busy }: { member: Member; currentUserId: string; onSave: (user: Member) => Promise<void>; busy: boolean }) {
  const [role, setRole] = useState(member.role);
  const [active, setActive] = useState(member.active);
  useEffect(() => { setRole(member.role); setActive(member.active); }, [member.role, member.active]);
  const changed = role !== member.role || active !== member.active;
  return <tr className="border-t border-[var(--color-border-light)]">
    <td className="p-4"><p className="font-semibold">{member.display_name || member.email}{member.user_id === currentUserId && <span className="ml-2 text-xs font-normal text-[var(--color-text-tertiary)]">Você</span>}</p><p className="text-xs text-[var(--color-text-secondary)] mt-1 break-all">{member.email}</p></td>
    <td className="p-4"><select aria-label={`Perfil de ${member.display_name || member.email}`} className="field min-w-36" disabled={busy} value={role} onChange={event => setRole(event.target.value as Member["role"])}><option value="operator">Operador</option><option value="admin">Administrador</option></select></td>
    <td className="p-4"><label className="flex items-center gap-2 whitespace-nowrap"><input type="checkbox" checked={active} disabled={busy} onChange={event => setActive(event.target.checked)} />{active ? "Ativo" : "Bloqueado"}</label></td>
    <td className="p-4"><button className="btn-ghost text-[var(--color-accent-blue)]" disabled={busy || !changed} onClick={() => onSave({ ...member, role, active })}>Salvar</button></td>
  </tr>;
}

export function NinhoUsers() {
  const router = useRouter();
  const [users, setUsers] = useState<Member[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Member["role"]>("operator");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => {
    const response = await fetch("/api/ninho/users", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível carregar os usuários.");
    setUsers(data.users); setCurrentUserId(data.currentUserId);
  }, []);
  useEffect(() => { load().catch(reason => setError(reason.message)).finally(() => setLoading(false)); }, [load]);
  async function save(member: Member) {
    if (member.user_id === currentUserId && (member.role !== "admin" || !member.active)
      && !window.confirm("Esta alteração vai remover seu acesso ao Ninho. Continuar?")) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/ninho/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: member.user_id, role: member.role, active: member.active }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível alterar o usuário.");
      if (member.user_id === currentUserId && (member.role !== "admin" || !member.active)) { router.replace("/"); router.refresh(); return; }
      await load(); setNotice("Permissões atualizadas.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao alterar permissões."); }
    finally { setBusy(false); }
  }
  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/ninho/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, password, role }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível criar o usuário.");
      setPassword(""); setEmail(""); setName(""); setRole("operator");
      await load(); setNotice("Usuário criado. Entregue o e-mail e a senha à pessoa para ela entrar no Abelha Par.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao criar usuário."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-6">
    <section className="card p-6 sm:p-7"><h2 className="text-lg font-semibold mb-4">O que cada perfil pode fazer</h2><div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr className="text-[var(--color-text-secondary)]"><th className="p-3">Acesso</th><th className="p-3">Operador</th><th className="p-3">Administrador</th></tr></thead><tbody><tr className="border-t border-[var(--color-border-light)]"><td className="p-3">Buscar pedidos, bipar e acessar lotes</td><td className="p-3">Sim</td><td className="p-3">Sim</td></tr><tr className="border-t border-[var(--color-border-light)]"><td className="p-3">Ninho: conexões, webhook, usuários e permissões</td><td className="p-3">Não</td><td className="p-3">Sim</td></tr></tbody></table></div></section>
    {error && <p role="alert" className="card p-4 text-[var(--color-accent-red)]">{error}</p>}
    {notice && <p role="status" className="card p-4 text-[var(--color-accent-green)]">{notice}</p>}
    <section className="card overflow-hidden"><div className="p-6 flex items-center justify-between gap-3"><div className="flex items-center gap-3"><Users className="w-5 h-5 text-amber-700" /><h2 className="text-lg font-semibold">Equipe da colmeia</h2></div><button className="btn-ghost" disabled={busy || loading} onClick={() => { setError(null); load().catch(reason => setError(reason.message)); }}><RefreshCw className="w-4 h-4" />Atualizar</button></div><div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead className="bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)]"><tr><th className="p-4">Usuário</th><th className="p-4">Perfil</th><th className="p-4">Acesso</th><th className="p-4"><span className="sr-only">Ações</span></th></tr></thead><tbody>{users.map(member => <MemberRow key={member.user_id} member={member} currentUserId={currentUserId} busy={busy} onSave={save} />)}</tbody></table></div>{loading && <p className="p-6 text-sm">Carregando usuários…</p>}</section>
    <section className="card p-6 sm:p-7 space-y-5"><h2 className="text-lg font-semibold flex items-center gap-2"><Plus className="w-5 h-5" />Adicionar à colmeia</h2><form onSubmit={create} className="grid sm:grid-cols-2 gap-4"><label className="text-sm">Nome<input className="field mt-1" autoComplete="name" required minLength={2} maxLength={100} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label><label className="text-sm">E-mail de acesso<input className="field mt-1" type="email" autoComplete="email" required maxLength={254} value={email} disabled={busy} onChange={event => setEmail(event.target.value)} /></label><label className="text-sm">Senha inicial<input className="field mt-1" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /><span className="text-xs text-[var(--color-text-tertiary)]">Ao menos 12 caracteres.</span></label><label className="text-sm">Perfil<select className="field mt-1" value={role} disabled={busy} onChange={event => setRole(event.target.value as Member["role"])}><option value="operator">Operador</option><option value="admin">Administrador</option></select></label><button className="btn-primary sm:col-span-2" disabled={busy}>{busy ? "Salvando…" : "Criar usuário"}</button></form></section>
  </div>;
}
