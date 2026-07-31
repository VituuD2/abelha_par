"use client";

import { ChevronRight } from "lucide-react";

interface HeaderProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: string[];
}

export function Header({ title, subtitle, breadcrumbs }: HeaderProps) {
  return (
    <div className="mb-10">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <div className="flex items-center gap-2 mb-3 text-[13px] text-[var(--color-text-tertiary)]">
          {breadcrumbs.map((crumb, index) => (
            <span key={index} className="flex items-center gap-2">
              {index > 0 && <ChevronRight className="w-3.5 h-3.5 opacity-50" />}
              <span className={index === breadcrumbs.length - 1 ? "text-[var(--color-text-secondary)] font-medium" : ""}>
                {crumb}
              </span>
            </span>
          ))}
        </div>
      )}
      <h1 className="text-[32px] font-bold text-[var(--color-text-primary)] tracking-tight">
        {title}
      </h1>
      {subtitle && (
        <p className="text-[16px] text-[var(--color-text-secondary)] mt-2">
          {subtitle}
        </p>
      )}
    </div>
  );
}
