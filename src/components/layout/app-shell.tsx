"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { useEffect, useState } from "react";
import { usePreparationStore } from "@/stores/preparation-store";
import { useScanStore } from "@/stores/scan-store";

export function AppShell({ children, userId }: { children: React.ReactNode; userId: string | null }) {
  const pathname = usePathname();
  const [readyFor, setReadyFor] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([usePreparationStore.persist.rehydrate(), useScanStore.persist.rehydrate()]).then(() => {
      if (cancelled) return;
      usePreparationStore.getState().bindOwner(userId);
      useScanStore.getState().bindOwner(userId);
      setReadyFor(userId);
    });
    return () => { cancelled = true; };
  }, [userId]);
  const isAuthPage = ["/login", "/forgot-password", "/reset-password"].includes(pathname);
  if (isAuthPage) return <main className="min-h-screen">{children}</main>;
  if (!userId || readyFor !== userId) return <main className="p-10 text-center">Preparando sua sessão…</main>;

  return (
    <div className="min-h-screen w-full">
      <Sidebar />
      <main className="w-full lg:!pl-[260px] pb-24 lg:pb-0 min-h-screen flex flex-col">
        <div className="w-full max-w-[1240px] mx-auto px-5 sm:px-8 lg:px-12 py-8 sm:py-10 lg:py-14">{children}</div>
      </main>
    </div>
  );
}
