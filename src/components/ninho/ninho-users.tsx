"use client";
import { LoadingRegion, RowsSkeleton } from "@/components/ui/loading-region";
import { Select } from "@/components/ui/select";


import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, ShieldCheck, UserPlus, Users } from "lucide-react";
import { NinhoSection } from "./ninho-section";

type Member = { user_id: string; display_name: string; email: string; role: "admin" | "operator"; active: boolean };

function MemberRow({ member, currentUserId, onSave, busy }: { member: Member; currentUserId: string; onSave: (user: Member) => Promise<void>; busy: boolean }) {
  const [role, setRole] = useState(member.role);
  const [active, setActive] = useState(member.active);
  useEffect(() => { setRole(member.role); setActive(member.active); }, [member.role, member.active]);
  const changed = role !== member.role || active !== member.active;
  return <tr className="border-t border-[var(--color-border-light)]">
    <td className="px-4 py-3"><p className="font-semibold">{member.display_name || member.email}{member.user_id === currentUserId && <span className="ml-2 text-xs font-normal text-[var(--color-text-tertiary)]">Você</span>}</p><p className="text-xs text-[var(--color-text-secondary)] mt-1 break-all">{member.email}</p></td>
    <td className="px-4 py-3"><Select aria-label={`Perfil de ${member.display_name || member.email}`} className="field min-w-36" disabled={busy} value={role} onValueChange={event => setRole(event as Member["role"])}><option value="operator">Operador</option><option value="admin">Administrador</option></Select></td>
    <td className="px-4 py-3"><label className="flex items-center gap-2 whitespace-nowrap"><input type="checkbox" checked={active} disabled={busy} onChange={event => setActive(event.target.checked)} />{active ? "Ativo" : "Bloqueado"}</label></td>
    <td className="px-4 py-3"><button className="btn-ghost text-[var(--color-accent-blue)]" disabled={busy || !changed} onClick={() => onSave({ ...member, role, active })}>Salvar</button></td>
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
    setLoading(true);
    try {
      const response = await fetch("/api/ninho/users", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar os usuários.");
      setUsers(data.users); setCurrentUserId(data.currentUserId);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load().catch(reason => setError(reason.message)); }, [load]);
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
  return <div className="min-w-0 space-y-4">
    <NinhoSection title="Perfis e permissões" icon={ShieldCheck} status={<span className="badge">2 perfis</span>}>
      <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-sm text-left"><caption className="sr-only">O que cada perfil pode fazer</caption><thead className="bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]"><tr><th scope="col" className="p-3">Acesso</th><th scope="col" className="p-3">Operador</th><th scope="col" className="p-3">Administrador</th></tr></thead><tbody><tr className="border-t border-[var(--color-border-light)]"><td className="p-3">Buscar pedidos, bipar e acessar lotes</td><td className="p-3">Sim</td><td className="p-3">Sim</td></tr><tr className="border-t border-[var(--color-border-light)]"><td className="p-3">Ninho: conexões, webhook, usuários e permissões</td><td className="p-3">Não</td><td className="p-3">Sim</td></tr></tbody></table></div>
    </NinhoSection>
    {error && <p role="alert" className="card p-4 text-[var(--color-accent-red)]">{error}</p>}
    {notice && <p role="status" className="card p-4 text-[var(--color-accent-green)]">{notice}</p>}
    <NinhoSection title="Equipe da colmeia" icon={Users}
      status={<span className="badge">{loading ? "Carregando…" : `${users.length} usuários`}</span>}
      actions={<button className="btn-ghost" disabled={busy || loading} onClick={() => { setError(null); load().catch(reason => setError(reason.message)); }}><RefreshCw aria-hidden="true" className="w-4 h-4" />Atualizar</button>}>
      <LoadingRegion label="Dados dos usuários" loading={loading} className="min-h-48 max-h-[560px]" skeleton={<RowsSkeleton rows={3} />}><div className="max-h-[560px] overflow-auto" tabIndex={0} role="region" aria-label="Lista de usuários"><table className="w-full min-w-[640px] text-sm text-left"><thead className="sticky top-0 z-10 bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]"><tr><th scope="col" className="p-4">Usuário</th><th scope="col" className="p-4">Perfil</th><th scope="col" className="p-4">Acesso</th><th scope="col" className="p-4"><span className="sr-only">Ações</span></th></tr></thead><tbody>{users.map(member => <MemberRow key={member.user_id} member={member} currentUserId={currentUserId} busy={busy} onSave={save} />)}</tbody></table></div></LoadingRegion>
    </NinhoSection>
    <NinhoSection title="Adicionar à colmeia" icon={UserPlus}>
      <form onSubmit={create} className="grid sm:grid-cols-2 gap-4"><label className="text-sm">Nome<input className="field mt-1" autoComplete="name" required minLength={2} maxLength={100} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label><label className="text-sm">E-mail de acesso<input className="field mt-1" type="email" autoComplete="email" required maxLength={254} value={email} disabled={busy} onChange={event => setEmail(event.target.value)} /></label><label className="text-sm">Senha inicial<input className="field mt-1" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /><span className="text-xs text-[var(--color-text-tertiary)]">Ao menos 12 caracteres.</span></label><div className="text-sm"><Select label="Perfil" className="field mt-1" value={role} disabled={busy} onValueChange={event => setRole(event as Member["role"])}><option value="operator">Operador</option><option value="admin">Administrador</option></Select></div><button className="btn-primary sm:col-span-2" disabled={busy}>{busy ? "Salvando…" : "Criar usuário"}</button></form>
    </NinhoSection>
  </div>;
}
