"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let isMounted = true;

    const updateRecoveryState = (hasSession: boolean) => {
      if (!isMounted) return;
      setHasRecoverySession(hasSession);
      setError(hasSession ? null : "Este link de redefinição é inválido ou expirou. Solicite um novo link.");
      setIsLoading(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      updateRecoveryState(Boolean(session));
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      updateRecoveryState(Boolean(session));
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("A nova senha deve ter pelo menos 6 caracteres.");
      return;
    }
    if (password !== confirmation) {
      setError("As senhas não coincidem.");
      return;
    }

    setIsSaving(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError("Não foi possível atualizar a senha. Solicite um novo link e tente novamente.");
      setIsSaving(false);
      return;
    }

    await supabase.auth.signOut();
    setIsComplete(true);
    setIsSaving(false);
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-[var(--color-bg-primary)] p-5 sm:p-6">
      <div className="pointer-events-none absolute -right-56 -top-52 h-[32rem] w-[32rem] rounded-full bg-[var(--color-accent-yellow)]/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -left-48 h-[24rem] w-[24rem] rounded-full bg-[var(--color-accent-blue)]/10 blur-3xl" />
      <div className="relative card-elevated w-full max-w-md space-y-5 p-6 sm:p-9">
        <div className="text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-[18px] bg-gradient-to-br from-[var(--color-accent-yellow)] to-[var(--color-accent-blue)] shadow-md">
            <KeyRound className="h-6 w-6 text-white" />
          </div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.13em] text-[var(--color-accent-blue)]">Abelha Par</p>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">Crie uma nova senha</h1>
        </div>

        {isLoading ? (
          <p className="text-center text-sm text-[var(--color-text-secondary)]">Validando link de redefinição...</p>
        ) : isComplete ? (
          <div className="space-y-5 text-center">
            <p className="rounded-[var(--radius-md)] bg-[var(--color-accent-blue)]/10 p-4 text-sm text-[var(--color-text-primary)]">Senha atualizada com sucesso. Entre novamente para continuar.</p>
            <Link href="/login" className="btn-primary block w-full py-3">Ir para o login</Link>
          </div>
        ) : !hasRecoverySession ? (
          <div className="space-y-5 text-center">
            <p role="alert" className="text-sm text-[var(--color-accent-red)]">{error || "Não foi possível validar este link."}</p>
            <Link href="/forgot-password" className="btn-primary block w-full py-3">Solicitar novo link</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <p className="text-sm text-[var(--color-text-secondary)]">Escolha uma senha com pelo menos 6 caracteres.</p>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)]">
              Nova senha
              <input
                className="mt-2 w-full rounded-[var(--radius-md)] border border-[var(--color-border-medium)] bg-[var(--color-bg-elevated)] px-3.5 py-3 text-[var(--color-text-primary)] transition-colors focus:border-[var(--color-accent-blue)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-blue)]/20"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)]">
              Confirmar nova senha
              <input
                className="mt-2 w-full rounded-[var(--radius-md)] border border-[var(--color-border-medium)] bg-[var(--color-bg-elevated)] px-3.5 py-3 text-[var(--color-text-primary)] transition-colors focus:border-[var(--color-accent-blue)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-blue)]/20"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
            {error && <p role="alert" className="text-sm text-[var(--color-accent-red)]">{error}</p>}
            <button className="btn-primary w-full py-3" disabled={isSaving}>
              {isSaving ? "Atualizando..." : "Atualizar senha"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
