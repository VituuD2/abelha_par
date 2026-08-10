"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = ["/login", "/forgot-password", "/reset-password"].includes(pathname);
  if (isAuthPage) return <main className="min-h-screen">{children}</main>;

  return (
    <div className="min-h-screen w-full">
      <Sidebar />
      <main className="w-full lg:!pl-[260px] pb-24 lg:pb-0 min-h-screen flex flex-col">
        <div className="w-full max-w-[1240px] mx-auto px-5 sm:px-8 lg:px-12 py-8 sm:py-10 lg:py-14">{children}</div>
      </main>
    </div>
  );
}
