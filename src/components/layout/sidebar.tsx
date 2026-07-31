"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ScanBarcode, Clock, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

const navItems = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/scanner", label: "Scanner", icon: ScanBarcode },
  { href: "/history", label: "Histórico", icon: Clock },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex fixed left-0 top-0 bottom-0 w-[260px] flex-col z-40">
        <div className="flex-1 glass border-r border-[var(--color-border-light)] px-4 py-6 flex flex-col">
          {/* Logo */}
          <div className="flex items-center gap-4 px-4 mb-8">
            <div className="w-14 h-14 p-2.5 rounded-[var(--radius-md)] bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-md shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 text-white">
                <path d="M2 13v-2a2 2 0 0 1 2-2h1.5l1.5-1.5A3.5 3.5 0 0 1 9.5 6.5h3A3.5 3.5 0 0 1 15 7.5l1.5 1.5H18a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1.5l-1.5 1.5a3.5 3.5 0 0 1-2.5 1h-3a3.5 3.5 0 0 1-2.5-1L5.5 15H4a2 2 0 0 1-2-2z"/>
                <path d="M12 16v-4"/>
                <path d="M9 16v-4"/>
                <path d="M15 16v-4"/>
                <path d="M10 6v-2a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2"/>
                <path d="M4 11h2"/>
                <path d="M18 11h2"/>
              </svg>
            </div>
            <div>
              <h1 className="text-[18px] font-bold text-[var(--color-text-primary)] tracking-tight leading-tight">
                Abelha Par
              </h1>
              <p className="text-[12px] text-[var(--color-text-tertiary)] font-medium">
                Conferência de Pedidos
              </p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex flex-col gap-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "relative flex items-center gap-4 px-5 py-4 rounded-[var(--radius-md)] text-[15px] font-medium transition-all duration-200",
                    isActive
                      ? "text-[var(--color-accent-blue)]"
                      : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-black/[0.03]"
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="sidebar-active"
                      className="absolute inset-0 bg-[var(--color-accent-blue)]/8 rounded-[var(--radius-md)]"
                      transition={{
                        type: "spring",
                        stiffness: 350,
                        damping: 30,
                      }}
                    />
                  )}
                  <Icon className="w-[22px] h-[22px] relative z-10" />
                  <span className="relative z-10">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="mt-auto px-3 pt-4 border-t border-[var(--color-border-light)]">
            <p className="text-[11px] text-[var(--color-text-tertiary)]">
              Abelha Par Logística
            </p>
            <p className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5">
              v1.0.0
            </p>
          </div>
        </div>
      </aside>

      {/* Mobile Bottom Nav */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 glass border-t border-[var(--color-border-light)]">
        <div className="flex items-center justify-around px-2 py-2 max-w-md mx-auto">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative flex flex-col items-center gap-1 px-4 py-1.5 rounded-[var(--radius-md)] transition-all duration-200",
                  isActive
                    ? "text-[var(--color-accent-blue)]"
                    : "text-[var(--color-text-tertiary)]"
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="mobile-active"
                    className="absolute inset-0 bg-[var(--color-accent-blue)]/8 rounded-[var(--radius-md)]"
                    transition={{
                      type: "spring",
                      stiffness: 350,
                      damping: 30,
                    }}
                  />
                )}
                <Icon className="w-5 h-5 relative z-10" />
                <span className="text-[10px] font-semibold relative z-10">
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
