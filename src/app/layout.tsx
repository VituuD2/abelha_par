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
    <html lang="pt-BR">
      <body className={`${inter.variable} font-sans bg-[var(--color-bg-primary)]`}>
        <AppShell userId={user?.id || null} initialAccess={initialAccess}>{children}</AppShell>
      </body>
    </html>
  );
}
