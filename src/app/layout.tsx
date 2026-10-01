import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { getAuthenticatedUser } from "@/lib/auth";
import { getAccessContext } from "@/lib/access";

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
  let access = null;
  let accessError: string | null = null;
  try { access = await getAccessContext(user); }
  catch (error) { accessError = error instanceof Error ? error.message : "Não foi possível verificar seu acesso."; }
  return (
    <html lang="pt-BR">
      <body className={`${inter.variable} font-sans bg-[var(--color-bg-primary)]`}>
        <AppShell userId={user?.id || null} isAdmin={access?.role === "admin"} accessError={accessError}>{children}</AppShell>
      </body>
    </html>
  );
}
