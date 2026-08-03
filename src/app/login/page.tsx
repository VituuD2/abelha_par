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
    <div className="min-h-screen flex items-center justify-center p-6 bg-[var(--color-bg-primary)]">
      <form onSubmit={handleSubmit} className="card w-full max-w-md p-8 space-y-5">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--color-accent-blue)]/10 flex items-center justify-center">
            <LockKeyhole className="w-6 h-6 text-[var(--color-accent-blue)]" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Acesso do operador</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-2">Entre para acessar a conferência de pedidos.</p>
        </div>
        <label className="block text-sm font-medium text-[var(--color-text-secondary)]">E-mail
          <input className="mt-2 w-full rounded border p-3" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="block text-sm font-medium text-[var(--color-text-secondary)]">Senha
          <input className="mt-2 w-full rounded border p-3" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error && <p role="alert" className="text-sm text-[var(--color-accent-red)]">{error}</p>}
        <button className="btn-primary w-full py-3" disabled={isLoading}>{isLoading ? "Entrando..." : "Entrar"}</button>
      </form>
    </div>
  );
}
