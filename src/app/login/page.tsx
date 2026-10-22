"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { AuthLayout } from "@/components/layout/auth-layout";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
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
    // Start a new document so no layout or prefetched admin page survives a login.
    window.location.replace(next && /^\/(?![\\/])/.test(next) ? next : "/");
  };

  return (
    <AuthLayout title="Acesso do operador" description="Entre com seu e-mail para continuar a operação." icon={LockKeyhole}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <label className="block text-sm font-medium text-[var(--color-text-secondary)]">E-mail
          <input className="mt-2 w-full rounded-[var(--radius-md)] border border-[var(--color-border-medium)] bg-[var(--color-bg-elevated)] px-3.5 py-3 text-[var(--color-text-primary)] transition-colors focus:border-[var(--color-accent-blue)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-blue)]/20" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="block text-sm font-medium text-[var(--color-text-secondary)]">Senha
          <input className="mt-2 w-full rounded-[var(--radius-md)] border border-[var(--color-border-medium)] bg-[var(--color-bg-elevated)] px-3.5 py-3 text-[var(--color-text-primary)] transition-colors focus:border-[var(--color-accent-blue)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-blue)]/20" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <div className="-mt-2 text-right">
          <Link href="/forgot-password" className="text-sm font-medium text-[var(--color-accent-blue)] hover:underline">
            Esqueci minha senha
          </Link>
        </div>
        {error && <p role="alert" className="text-sm text-[var(--color-accent-red)]">{error}</p>}
        <button className="btn-primary w-full py-3" disabled={isLoading}>{isLoading ? "Entrando..." : "Entrar"}</button>
      </form>
    </AuthLayout>
  );
}
