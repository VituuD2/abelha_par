"use client";

import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { usePreparationStore } from "@/stores/preparation-store";
import { useScanStore } from "@/stores/scan-store";
import { createClient } from "@/lib/supabase/client";
import { createSessionAccessMonitor, type SessionAccessSnapshot } from "@/lib/session-access";
import { can, permissionForPage, type Permission } from "@/lib/permissions";

const AppAccessContext = createContext({ can: (permission: Permission): boolean => can(null, permission) });
export const useAppAccess = () => useContext(AppAccessContext);

export function AppShell({ children, userId: serverUserId }: { children: React.ReactNode; userId: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [access, setAccess] = useState<SessionAccessSnapshot>({ userId: null, role: null, loading: true, error: null, verifiedFor: null });
  const monitor = useRef<ReturnType<typeof createSessionAccessMonitor> | null>(null);
  const userId = access.userId;
  const accessError = access.error;
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const isAuthPage = ["/login", "/forgot-password", "/reset-password"].includes(pathname);
  const pagePermission = permissionForPage(pathname);
  const currentPath = useRef(pathname);
  currentPath.current = pathname;
  const routeVerified = access.verifiedFor === pathname;
  const allowedPage = !pagePermission || (routeVerified && can(access.role, pagePermission));

  useEffect(() => {
    const current = createSessionAccessMonitor(async () => {
      const response = await fetch("/api/auth/access", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível verificar suas permissões.");
      return data;
    }, setAccess);
    monitor.current = current;
    const { data: { subscription } } = createClient().auth.onAuthStateChange((_event, session) => {
      current.observeSession(session?.user.id || null, currentPath.current);
    });
    const check = () => { void current.refresh(currentPath.current, { invalidate: true }); };
    const timer = setInterval(() => { void current.refresh(currentPath.current); }, 60_000);
    const visibility = () => { if (document.visibilityState === "visible") check(); };
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    document.addEventListener("visibilitychange", visibility);
    return () => { current.dispose(); subscription.unsubscribe(); clearInterval(timer); window.removeEventListener("focus", check); window.removeEventListener("pageshow", check); document.removeEventListener("visibilitychange", visibility); if (monitor.current === current) monitor.current = null; };
  }, []);

  useEffect(() => { void monitor.current?.refresh(pathname, { invalidate: true }); }, [pathname]);
  useEffect(() => {
    if (!pagePermission) return;
    const timer = setInterval(() => { void monitor.current?.refresh(pathname); }, 15_000);
    return () => clearInterval(timer);
  }, [pathname, pagePermission]);
  useEffect(() => {
    if (userId && userId !== serverUserId) router.refresh();
    if (access.loading || isAuthPage) return;
    if (!userId) router.replace("/login");
    else if (pagePermission && routeVerified && !can(access.role, pagePermission)) router.replace("/");
  }, [userId, serverUserId, access.loading, access.role, isAuthPage, pagePermission, routeVerified, router]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    Promise.all([usePreparationStore.persist.rehydrate(), useScanStore.persist.rehydrate()]).then(() => {
      if (cancelled) return;
      usePreparationStore.getState().bindOwner(userId);
      useScanStore.getState().bindOwner(userId);
      setReadyFor(userId);
    });
    return () => { cancelled = true; };
  }, [userId]);
  if (isAuthPage) return <main className="min-h-screen">{children}</main>;
  if (accessError) return <main className="min-h-screen flex items-center justify-center p-6"><section className="card p-8 max-w-lg space-y-4"><h1 className="text-xl font-semibold">Acesso à colmeia</h1><p role="alert">{accessError}</p><button className="btn-primary" onClick={async () => { await createClient().auth.signOut(); window.location.assign("/login"); }}>Voltar ao login</button></section></main>;
  if (access.loading || !userId || readyFor !== userId || !allowedPage) return <main className="p-10 text-center">Preparando sua sessão…</main>;

  return (
    <AppAccessContext.Provider value={{ can: permission => can(access.role, permission) }}><div className="min-h-screen w-full">
      <Sidebar role={access.role} />
      <main className="w-full lg:!pl-[260px] pb-24 lg:pb-0 min-h-screen flex flex-col">
        <div className="w-full max-w-[1240px] mx-auto px-5 sm:px-8 lg:px-12 py-8 sm:py-10 lg:py-14">{children}</div>
      </main>
    </div></AppAccessContext.Provider>
  );
}
