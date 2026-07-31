"use client";

import { ChevronRight } from "lucide-react";

interface HeaderProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: string[];
}

export function Header({ title, subtitle, breadcrumbs }: HeaderProps) {
  return (
    <div className="mb-6">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <div className="flex items-center gap-1.5 mb-2 text-[12px] text-[var(--color-text-tertiary)]">
          {breadcrumbs.map((crumb, index) => (
            <span key={index} className="flex items-center gap-1.5">
              {index > 0 && <ChevronRight className="w-3 h-3" />}
              <span className={index === breadcrumbs.length - 1 ? "text-[var(--color-text-secondary)]" : ""}>
                {crumb}
              </span>
            </span>
          ))}
        </div>
      )}
      <h1 className="text-[28px] font-bold text-[var(--color-text-primary)] tracking-tight">
        {title}
      </h1>
      {subtitle && (
        <p className="text-[15px] text-[var(--color-text-secondary)] mt-1">
          {subtitle}
        </p>
      )}
    </div>
  );
}
