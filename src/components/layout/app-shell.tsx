"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const isLoginPage = usePathname() === "/login";
  if (isLoginPage) return <main className="min-h-screen">{children}</main>;

  return (
    <div className="min-h-screen w-full">
      <Sidebar />
      <main className="w-full lg:!pl-[260px] pb-20 lg:pb-0 min-h-screen flex flex-col">
        <div className="w-full max-w-6xl mx-auto px-6 sm:px-10 lg:px-12 py-10 lg:py-16">{children}</div>
      </main>
    </div>
  );
}
