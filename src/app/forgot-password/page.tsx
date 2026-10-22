"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { Mail } from "lucide-react";
import { AuthLayout } from "@/components/layout/auth-layout";
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
    <AuthLayout title="Redefinir senha" description="Receba um link para recuperar o acesso à sua conta." icon={Mail}>

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
    </AuthLayout>
  );
}
