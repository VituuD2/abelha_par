"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { AuthLayout } from "@/components/layout/auth-layout";
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
    <AuthLayout title="Crie uma nova senha" description="Defina sua nova senha para voltar à colmeia." icon={KeyRound}>

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
    </AuthLayout>
  );
}
