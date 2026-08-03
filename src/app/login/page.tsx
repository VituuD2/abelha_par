"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    const { error: signInError } = await createClient().auth.signInWithPassword({ email, password });
    if (signInError) {
      setError("E-mail ou senha inválidos.");
      setIsLoading(false);
      return;
    }
    const next = new URLSearchParams(window.location.search).get("next");
    router.replace(next && next.startsWith("/") ? next : "/");
    router.refresh();
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center p-5 sm:p-6 bg-[var(--color-bg-primary)] overflow-hidden">
      <div className="absolute w-[32rem] h-[32rem] -right-56 -top-52 rounded-full bg-[var(--color-accent-yellow)]/20 blur-3xl pointer-events-none" />
      <div className="absolute w-[24rem] h-[24rem] -left-48 -bottom-40 rounded-full bg-[var(--color-accent-blue)]/10 blur-3xl pointer-events-none" />
      <form onSubmit={handleSubmit} className="relative card-elevated w-full max-w-md p-6 sm:p-9 space-y-5">
        <div className="text-center">
          <div className="w-14 h-14 mx-auto mb-5 rounded-[18px] bg-gradient-to-br from-[var(--color-accent-yellow)] to-[var(--color-accent-blue)] shadow-md flex items-center justify-center">
            <LockKeyhole className="w-6 h-6 text-white" />
          </div>
          <p className="text-[11px] font-bold uppercase tracking-[0.13em] text-[var(--color-accent-blue)] mb-2">Abelha Par</p>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">Acesso do operador</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-2">Entre para acessar a conferência de pedidos.</p>
        </div>
        <label className="block text-sm font-medium text-[var(--color-text-secondary)]">E-mail
          <input className="mt-2 w-full rounded-[var(--radius-md)] border border-[var(--color-border-medium)] bg-[var(--color-bg-elevated)] px-3.5 py-3 text-[var(--color-text-primary)] transition-colors focus:border-[var(--color-accent-blue)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-blue)]/20" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="block text-sm font-medium text-[var(--color-text-secondary)]">Senha
          <input className="mt-2 w-full rounded-[var(--radius-md)] border border-[var(--color-border-medium)] bg-[var(--color-bg-elevated)] px-3.5 py-3 text-[var(--color-text-primary)] transition-colors focus:border-[var(--color-accent-blue)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-blue)]/20" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error && <p role="alert" className="text-sm text-[var(--color-accent-red)]">{error}</p>}
        <button className="btn-primary w-full py-3" disabled={isLoading}>{isLoading ? "Entrando..." : "Entrar"}</button>
      </form>
    </div>
  );
}
