import { useId, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { BrandMark } from "./brand-mark";

/** Shared presentation only: authentication stays in each page's existing form. */
export function AuthLayout({ title, description, icon: Icon, children }: {
  title: string;
  description: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  const titleId = useId();
  return <div className="auth-layout">
    <div className="auth-frame">
      <aside className="auth-context flex flex-col" aria-label="Abelha Par">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-accent-blue)] p-2.5"><BrandMark className="h-full w-full" /></span>
          <div><p className="text-lg font-semibold tracking-tight">Abelha Par</p><p className="text-xs text-[var(--color-text-secondary)]">Operação conectada</p></div>
        </div>
        <div className="hidden sm:block my-auto py-12">
          <p className="text-3xl font-semibold leading-tight tracking-tight">Da seleção<br />à conferência.</p>
          <p className="mt-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">Os pedidos da equipe, organizados em um só fluxo.</p>
          <ol className="mt-8 space-y-5 text-sm text-[var(--color-text-secondary)]">
            {["Selecione os pedidos do dia", "Cruze os pedidos com a Olist", "Confira e finalize o lote"].map((step, index) => <li key={step} className="flex items-center gap-3"><span className="workflow-step-number">{index + 1}</span>{step}</li>)}
          </ol>
        </div>
        <p className="hidden sm:block text-xs text-[var(--color-text-tertiary)]">Abelha Par Logística</p>
      </aside>
      <section className="auth-panel flex flex-col justify-center" aria-labelledby={titleId}>
        <span className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-bg-tertiary)] text-[var(--color-accent-blue)]"><Icon aria-hidden="true" className="h-5 w-5" /></span>
        <h1 id={titleId}>{title}</h1>
        <p className="page-description">{description}</p>
        <div className="mt-7">{children}</div>
      </section>
    </div>
  </div>;
}
