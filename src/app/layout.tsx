import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { getAuthenticatedUser } from "@/lib/auth";
import { getAccessContext } from "@/lib/access";
import type { SessionAccess } from "@/lib/session-access";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Abelha Par - Dashboard",
  description:
    "Conferência de pedidos Nuvemshop e Olist com seleção diária e bipagem.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getAuthenticatedUser();
  let initialAccess: SessionAccess | null = null;
  if (user) {
    try {
      const access = await getAccessContext(user);
      if (access) initialAccess = { userId: user.id, role: access.role };
    } catch { /* The client performs a fresh check if server bootstrap fails. */ }
  }
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(() => {
          let theme = "system";
          try {
            const saved = localStorage.getItem("theme");
            if (saved === "light" || saved === "dark") theme = saved;
          } catch { /* Use the system preference when storage is unavailable. */ }
          document.documentElement.dataset.themePreference = theme;
          document.documentElement.dataset.theme = theme === "system"
            ? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light")
            : theme;
        })();` }} />
      </head>
      <body className={`${inter.variable} font-sans bg-[var(--color-bg-primary)]`}>
        <AppShell userId={user?.id || null} initialAccess={initialAccess}>{children}</AppShell>
      </body>
    </html>
  );
}
