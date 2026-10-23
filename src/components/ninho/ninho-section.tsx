"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";

export function NinhoSection({ title, icon: Icon, iconClassName = "bg-[var(--color-accent-soft)] text-[var(--color-accent-blue)]", status, actions, children }: {
  title: string;
  icon: LucideIcon;
  iconClassName?: string;
  status?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return <section className="card min-w-0 overflow-hidden" aria-label={title}>
    <header className="flex flex-wrap items-center gap-3 p-4 sm:px-5">
      <h2 className="min-w-0 flex-1 basis-56">
        <button id={`${id}-toggle`} type="button" aria-label={title} aria-expanded={expanded} aria-controls={`${id}-panel`}
          onClick={() => setExpanded(value => !value)}
          className="flex w-full items-center gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent-blue)]">
          <span aria-hidden="true" className={`shrink-0 rounded-xl p-2.5 ${iconClassName}`}><Icon className="h-5 w-5" /></span>
          <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
            <span className="break-words text-base font-semibold sm:text-lg">{title}</span>
            {status}
          </span>
          <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-[var(--color-text-secondary)] transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} />
        </button>
      </h2>
      {actions && <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
    <div id={`${id}-panel`} role="region" aria-labelledby={`${id}-toggle`} hidden={!expanded}
      className="space-y-5 border-t border-[var(--color-border-light)] p-4 sm:p-5">
      {children}
    </div>
  </section>;
}
