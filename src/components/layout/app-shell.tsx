"use client";

import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { usePreparationStore } from "@/stores/preparation-store";
import { useScanStore } from "@/stores/scan-store";
import { createClient } from "@/lib/supabase/client";
import { ACCESS_FRESHNESS_MS, PROTECTED_ACCESS_FRESHNESS_MS, createSessionAccessMonitor, type SessionAccess, type SessionAccessSnapshot } from "@/lib/session-access";
import { can, permissionForPage, type Permission } from "@/lib/permissions";

const AppAccessContext = createContext({ can: (permission: Permission): boolean => can(null, permission) });
export const useAppAccess = () => useContext(AppAccessContext);

export function AppShell({ children, userId: serverUserId, initialAccess = null }: { children: React.ReactNode; userId: string | null; initialAccess?: SessionAccess | null }) {
  const pathname = usePathname();
  const router = useRouter();
  // A new visit needs a new proof even when returning to the same URL.
  const routeVisit = useRef({ pathname, version: 0 });
  if (routeVisit.current.pathname !== pathname) {
    routeVisit.current = { pathname, version: routeVisit.current.version + 1 };
  }
  const scope = `${routeVisit.current.version}:${pathname}`;
  const bootstrap = useRef(initialAccess?.userId === serverUserId ? initialAccess : null);
  const [access, setAccess] = useState<SessionAccessSnapshot>(() => ({
    userId: bootstrap.current?.userId || null, role: bootstrap.current?.role || null,
    loading: !bootstrap.current, error: null, verifiedFor: bootstrap.current ? scope : null,
  }));
  const monitor = useRef<ReturnType<typeof createSessionAccessMonitor> | null>(null);
  const userId = access.userId;
  const accessError = access.error;
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const isAuthPage = ["/login", "/forgot-password", "/reset-password"].includes(pathname);
  const pagePermission = permissionForPage(pathname);
  const currentPath = useRef(pathname);
  currentPath.current = pathname;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const routeVerified = access.verifiedFor === scope;
  const allowedPage = !pagePermission || (routeVerified && can(access.role, pagePermission));

  useEffect(() => {
    const current = createSessionAccessMonitor(async signal => {
      const response = await fetch("/api/auth/access", { cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível verificar suas permissões.");
      return data;
    }, setAccess, { initialAccess: bootstrap.current, initialScope: currentScope.current });
    monitor.current = current;
    const { data: { subscription } } = createClient().auth.onAuthStateChange((_event, session) => {
      current.observeSession(session?.user.id || null, currentScope.current);
    });
    const check = () => {
      if (document.visibilityState !== "visible") return;
      void current.refresh(currentScope.current, { maxAgeMs: permissionForPage(currentPath.current) ? PROTECTED_ACCESS_FRESHNESS_MS : ACCESS_FRESHNESS_MS });
    };
    const visibility = check;
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    document.addEventListener("visibilitychange", visibility);
    return () => { current.dispose(); subscription.unsubscribe(); window.removeEventListener("focus", check); window.removeEventListener("pageshow", check); document.removeEventListener("visibilitychange", visibility); if (monitor.current === current) monitor.current = null; };
  }, []);

  const previousPath = useRef(pathname);
  useEffect(() => {
    const enteredProtectedPage = previousPath.current !== pathname && Boolean(pagePermission);
    previousPath.current = pathname;
    void monitor.current?.refresh(scope, { invalidate: enteredProtectedPage });
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void monitor.current?.refresh(scope, { maxAgeMs: pagePermission ? PROTECTED_ACCESS_FRESHNESS_MS : ACCESS_FRESHNESS_MS });
    }, pagePermission ? PROTECTED_ACCESS_FRESHNESS_MS : ACCESS_FRESHNESS_MS);
    return () => clearInterval(timer);
  }, [pathname, pagePermission, scope]);
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
        <div className="w-full min-w-0 max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">{children}</div>
      </main>
    </div></AppAccessContext.Provider>
  );
}
