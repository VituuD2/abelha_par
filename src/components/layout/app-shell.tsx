"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { createContext, useContext, useEffect, useState } from "react";
import { usePreparationStore } from "@/stores/preparation-store";
import { useScanStore } from "@/stores/scan-store";
import { createClient } from "@/lib/supabase/client";

const AppAccessContext = createContext({ isAdmin: false });
export const useAppAccess = () => useContext(AppAccessContext);

export function AppShell({ children, userId, isAdmin, accessError }: { children: React.ReactNode; userId: string | null; isAdmin: boolean; accessError: string | null }) {
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
  if (accessError) return <main className="min-h-screen flex items-center justify-center p-6"><section className="card p-8 max-w-lg space-y-4"><h1 className="text-xl font-semibold">Acesso à colmeia</h1><p role="alert">{accessError}</p><button className="btn-primary" onClick={async () => { await createClient().auth.signOut(); window.location.assign("/login"); }}>Voltar ao login</button></section></main>;
  if (!userId || readyFor !== userId) return <main className="p-10 text-center">Preparando sua sessão…</main>;

  return (
    <AppAccessContext.Provider value={{ isAdmin }}><div className="min-h-screen w-full">
      <Sidebar isAdmin={isAdmin} />
      <main className="w-full lg:!pl-[260px] pb-24 lg:pb-0 min-h-screen flex flex-col">
        <div className="w-full max-w-[1240px] mx-auto px-5 sm:px-8 lg:px-12 py-8 sm:py-10 lg:py-14">{children}</div>
      </main>
    </div></AppAccessContext.Provider>
  );
}
