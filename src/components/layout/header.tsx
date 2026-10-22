"use client";

import { ChevronRight } from "lucide-react";

interface HeaderProps {
  title: string;
  breadcrumbs?: string[];
  description?: string;
}

export function Header({ title, breadcrumbs, description }: HeaderProps) {
  return (
    <header className="page-header min-w-0">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Caminho da página" className="flex flex-wrap items-center gap-2 mb-3 text-xs text-[var(--color-text-tertiary)]">
          {breadcrumbs.map((crumb, index) => (
            <span key={index} className="flex items-center gap-2">
              {index > 0 && <ChevronRight aria-hidden="true" className="w-3.5 h-3.5" />}
              <span aria-current={index === breadcrumbs.length - 1 ? "page" : undefined} className={index === breadcrumbs.length - 1 ? "text-[var(--color-text-secondary)] font-medium" : ""}>
                {crumb}
              </span>
            </span>
          ))}
        </nav>
      )}
      <h1 className="text-[30px] sm:text-[34px] font-bold text-[var(--color-text-primary)] tracking-[-0.035em] leading-tight">
        {title}
      </h1>
      {description && <p className="page-description">{description}</p>}
    </header>
  );
}
