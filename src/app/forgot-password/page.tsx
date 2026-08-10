"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSent, setIsSent] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsLoading(true);

    const redirectTo = new URL("/reset-password", window.location.origin).toString();
    const { error: resetError } = await createClient().auth.resetPasswordForEmail(email, { redirectTo });

    if (resetError) {
      setError("Não foi possível enviar o link agora. Tente novamente em instantes.");
      setIsLoading(false);
      return;
    }

    setIsSent(true);
    setIsLoading(false);
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-[var(--color-bg-primary)] p-5 sm:p-6">
      <div className="pointer-events-none absolute -right-56 -top-52 h-[32rem] w-[32rem] rounded-full bg-[var(--color-accent-yellow)]/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -left-48 h-[24rem] w-[24rem] rounded-full bg-[var(--color-accent-blue)]/10 blur-3xl" />
      <div className="relative card-elevated w-full max-w-md space-y-5 p-6 sm:p-9">
        <div className="text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-[18px] bg-gradient-to-br from-[var(--color-accent-yellow)] to-[var(--color-accent-blue)] shadow-md">
            <Mail className="h-6 w-6 text-white" />
          </div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.13em] text-[var(--color-accent-blue)]">Abelha Par</p>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">Redefinir senha</h1>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Enviaremos um link seguro para você criar uma nova senha.</p>
        </div>

        {isSent ? (
          <div className="space-y-5 text-center">
            <p className="rounded-[var(--radius-md)] bg-[var(--color-accent-blue)]/10 p-4 text-sm text-[var(--color-text-primary)]">
              Se houver uma conta com este e-mail, você receberá as instruções para redefinir a senha.
            </p>
            <Link href="/login" className="btn-primary block w-full py-3">Voltar para o login</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <label className="block text-sm font-medium text-[var(--color-text-secondary)]">
              E-mail
              <input
                className="mt-2 w-full rounded-[var(--radius-md)] border border-[var(--color-border-medium)] bg-[var(--color-bg-elevated)] px-3.5 py-3 text-[var(--color-text-primary)] transition-colors focus:border-[var(--color-accent-blue)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-blue)]/20"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            {error && <p role="alert" className="text-sm text-[var(--color-accent-red)]">{error}</p>}
            <button className="btn-primary w-full py-3" disabled={isLoading}>
              {isLoading ? "Enviando..." : "Enviar link de redefinição"}
            </button>
            <p className="text-center text-sm text-[var(--color-text-secondary)]">
              <Link href="/login" className="font-medium text-[var(--color-accent-blue)] hover:underline">Voltar para o login</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
