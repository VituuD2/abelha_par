"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SVGProps } from "react";
import { cn } from "@/lib/utils";
import { BrandMark } from "./brand-mark";
import { ListChecks } from "lucide-react";
import { BeeSettingsIcon } from "@/components/layout/bee-settings-icon";
import { NectarIcon } from "@/components/layout/nectar-icon";
import { NECTAR_MODULE } from "@/lib/analytics/config";
import { can, type Role } from "@/lib/permissions";
import { APP_VERSION_LABEL } from "@/lib/app-version";
import { ThemeToggle } from "./theme-toggle";

function BeehiveIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M8 9a4 4 0 0 1 8 0" />
      <path d="M6 13h12" />
      <path d="M5 17h14" />
      <path d="M7 21h10" />
      <path d="M7 9h10l2 8H5l2-8Z" />
      <path d="M12 13v.01" />
    </svg>
  );
}

function InspectionIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 629.89 509.7" fill="currentColor" stroke="currentColor" strokeWidth="16" strokeLinejoin="round" paintOrder="stroke fill" aria-hidden="true" {...props}>
      <path d="M401.97,176.85c-.01,10.8-15.52,20.47-28.91,15.12-6.83-2.73-12.95-9.12-13.79-17.4-.81-8.02,2.53-15.72,8.84-15.47,2.6.1,4.64,1.51,6.33,4.68l9.58-31.97c9.92-27.57,25.53-52.92,46.59-73.35,16.61-16.11,35.88-28.15,56.87-37.63,28.17-12.72,58.02-19.61,88.9-20.71,15.16-.54,29.79.68,44.52,3.97,6.25,1.4,9.93,7.28,8.8,12.97-1.26,6.36-7.27,9.98-13.68,8.54-14.1-3.16-27.71-4.74-42.39-4.22-47.31,1.67-96.57,20.4-130.76,53.61-14.75,14.32-26.34,31.28-35.14,49.88-6.87,14.52-11.51,29.22-16.07,44.78,2.56-.3,4.98-.55,7,1.09,1.37,1.11,3.32,3.13,3.31,6.09Z" />
      <path d="M227.99,176.02c.5-5.17,5.13-7.66,10.14-6.16l-4.15-13.51c-4.06-13.2-9.17-25.51-15.44-37.87-12.86-25.34-31.71-46.46-55.36-62.31-31.77-21.29-68.91-33.33-107.18-34.81-14.9-.58-28.7,1.08-42.98,4.27-3.7.83-7.43-.36-9.86-2.66S-.38,17.14.12,13.27C.8,8.07,5.27,4.89,10.3,3.79c63.61-13.9,147.8,11.59,192.98,58.88,20.08,21.02,34.62,45.84,43.66,73.37l8.28,27.73c1.52-2.64,3.23-4.46,5.73-4.66,2.91-.23,5.79.92,7.11,3.65,6.06,12.49-.98,26.59-13.69,30.02s-27.37-6.4-26.37-16.77Z" />
      <path d="M366.99,121.1c-13.06-3.37-25.87-5.28-39.09-6.34l-23.86-.16c-15.34.65-29.82,3.97-44.77,7.08-4.04.84-7.59-3.39-8.23-6.56-.78-3.88,1.09-8.65,5.29-9.78,26.52-7.13,51.56-9.28,79.02-6.87,12.18,1.07,23.67,3.55,35.56,6.05,3.57.75,6.28,2.23,7.41,5.39,1.21,3.4.21,6.57-2.27,9.05-2.62,2.62-5.31,3.1-9.06,2.13Z" />
      <path d="M528.56,226.45c-6.97-18.54-20.88-37.23-39.03-45.58-7.12-8.77-13.97-17.21-22.44-24.73-11.41-10.13-23.1-19.25-36.25-26.82-4.5-2.59-10.14-2.07-12.6,2.36-2.44,4.38-1.69,9.21,2.54,11.98l18.87,12.37c8.47,6.55,16.51,13.09,24.07,20.95-13.21,2.35-24.91,15.51-27.75,27.13l-5.09,20.81-15.34,102.71-1.44,14.75.02,11.2c.61,10.06,1.77,19.92,5.98,29.06,4.79,10.4,13.83,17.6,25.31,19.1-4.38,8.16-8.98,15.32-14.39,22.33l-7.7,9.96c-2.52,2.32-4.72,4.11-6.59,7.08-11.32,18-27.34,35.42-47.59,44.91,7.8-14.7,13.72-30.22,17.06-46.64.8-3.95-1.11-7.55-3.91-9.35-2.91-1.88-6.26-2.36-9.71-.73-36.58,17.31-78.09,17.44-114.86.48-3.73-1.72-7.23-2.06-10.5.21-2.68,1.86-4.83,5.65-3.78,9.28l7.13,24.71c2.23,7.73,9.79,21.95,9.9,21.61-.44,1.37-14.59-7.65-19.97-12.19-10.82-9.12-20.16-19.73-27.34-31.92-2.13-3.62-5.16-5.35-7.75-8.34-8.28-9.58-14.7-20.31-21.55-31.51,6.81-.85,12.83-3.47,17.94-8.32,13.8-13.1,15.47-40.8,12.82-59.49l-11.92-84.1-6.07-35.08c-2.96-17.11-13.25-33.9-30.94-37.98l9.66-8.87c10.49-9.63,21.76-17.63,34.07-24.69,4.09-2.34,4.08-7.85,2.16-11.22-1.97-3.47-6.66-5.26-10.84-3.42-7.54,3.3-14,8.36-20.82,13.3-15.2,11.01-28.34,23.76-39.48,38.89-34.71,16.85-49.7,61.24-47.5,97.81,2.15,35.69,15.6,72.74,39.84,99.3,8.3,9.09,18.28,15.79,29.42,21.55,8.57,15.39,17.87,30.1,28.21,44.44,1.78,2.47,4.14,3.82,6.41,5.27,18.91,29.2,46.88,56.51,82.65,60.27,3.31.35,6.35-.47,8.36-2.61,2.05-2.18,2.81-5.36,2.05-8.47-.76-3.08-2.96-5.02-4.95-7.37-9.79-11.57-16.58-25.05-21.16-39.48,33.19,10.99,69.19,11.31,101.59.07l-6.98,17.7c-4.29,9.12-9.61,17.23-16.3,24.74-2.7,3.03-3.8,7.35-1.81,11.05,1.59,2.96,5.12,5.38,8.93,4.69l13.04-2.35c31.73-9.65,51.62-30.94,69.94-57.58l6.05-5.02c10.81-14.56,20.29-29.63,28.93-45.74,19.3-9.31,32.55-22.49,44.03-40.58,24.17-38.07,33.37-89.2,17.34-131.86ZM172.53,383.17c-13.36-4.5-24.37-13.36-32.88-24.69-18.36-24.43-28.89-53.91-29.76-84.63-.64-22.8,6.58-48.35,21.84-65.15,6.25-6.89,13.73-12.1,22.67-14.64,14.49-4.11,23.34,11.07,25.42,24.58l16.15,104.86,1.52,15.3c1.35,13.54.78,37-10.95,43.85-4.28,2.5-9.46,2.06-14.01.52ZM519.48,279.15c-1.23,18.29-5.8,35.5-13.31,52.14-4.99,11.05-11.28,20.77-18.93,30.12-8.49,10.38-24.22,22.71-37.3,23.17-6.5.23-11.38-4.29-13.96-9.83-3.99-8.55-5.13-24.71-4.11-34.38l2.04-19.48,12.72-84.63,4.5-22.55c2.01-10.07,10.32-22.33,22.1-20.03,7.21,1.41,13.68,5.16,19.32,9.98,20.48,17.47,28.7,49.01,26.92,75.5Z" />
    </svg>
  );
}

function HoneycombIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="m8 3 3 1.75v3.5L8 10 5 8.25v-3.5L8 3Z" />
      <path d="m14 6 3 1.75v3.5L14 13l-3-1.75v-3.5L14 6Z" />
      <path d="m8 13 3 1.75v3.5L8 20l-3-1.75v-3.5L8 13Z" />
      <path d="m14 16 3 1.75v3.5L14 23l-3-1.75v-3.5L14 16Z" transform="translate(0 -2)" />
    </svg>
  );
}

const navItems = [
  { href: "/", label: "Colmeia", icon: BeehiveIcon },
  { href: "/orders", label: "Pedidos do dia", icon: ListChecks },
  { href: "/scanner", label: "Inspeção", icon: InspectionIcon },
  { href: "/history", label: "Favos de Mel", icon: HoneycombIcon },
  { href: NECTAR_MODULE.href, label: NECTAR_MODULE.name, icon: NectarIcon },
];

export function Sidebar({ role }: { role: Role | null }) {
  const pathname = usePathname();
  const items = can(role, "ninho:access") ? [...navItems, { href: "/ninho", label: "Ninho", icon: BeeSettingsIcon }] : navItems;

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex fixed left-0 top-0 bottom-0 w-[260px] flex-col z-40">
        <div className="app-sidebar-surface flex-1 px-4 py-7 flex flex-col">
          {/* Logo */}
          <div className="flex items-center gap-3.5 px-3 mb-9">
            <div className="w-11 h-11 p-2.5 rounded-xl bg-[var(--brand)] flex items-center justify-center shrink-0">
              <BrandMark className="h-full w-full dark:fill-[var(--color-bg-secondary)]" />
            </div>
            <div>
              <p className="text-[18px] font-bold text-[var(--color-text-primary)] tracking-tight leading-tight">
                Abelha Par
              </p>
              <p className="text-[12px] text-[var(--color-text-tertiary)] font-medium">
                bzzzzzzzzzzzzzzzzzzzz
              </p>
            </div>
          </div>

          {/* Navigation */}
          <nav aria-label="Navegação principal" className="flex flex-1 flex-col gap-1 pb-6">
            {items.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "app-nav-link",
                    item.href === "/ninho" && "mt-auto",
                    isActive
                      ? "text-[var(--color-accent-blue)]"
                      : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-black/[0.03]"
                  )}
                >
                  <Icon className="w-[22px] h-[22px] relative z-10" />
                  <span className="relative z-10">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="mt-auto flex items-end justify-between gap-2 px-3 pt-4 border-t border-[var(--color-border-light)]">
            <div><p className="text-[11px] text-[var(--color-text-tertiary)]">
              Abelha Par Logística
            </p>
            <p className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5">
              {APP_VERSION_LABEL}
            </p></div>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* Mobile Bottom Nav */}
      <nav aria-label="Navegação móvel" className="app-mobile-nav lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-[var(--color-border-light)]">
        <div className="flex items-center justify-around gap-1 px-2 py-2 max-w-lg mx-auto">
          {items.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                title={item.label}
                className={cn(
                  "app-mobile-link",
                  isActive
                    ? "text-[var(--color-accent-blue)]"
                    : "text-[var(--color-text-tertiary)]"
                )}
              >
                <Icon className="w-5 h-5 relative z-10" />
                <span className="text-[10px] font-semibold relative z-10 w-full text-center leading-tight">
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
        <div className="mx-auto flex max-w-lg justify-end px-3 pb-2">
          <ThemeToggle />
        </div>
      </nav>
    </>
  );
}
