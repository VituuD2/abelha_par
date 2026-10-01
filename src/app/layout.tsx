import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { getAuthenticatedUser } from "@/lib/auth";

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
  return (
    <html lang="pt-BR">
      <body className={`${inter.variable} font-sans bg-[var(--color-bg-primary)]`}>
        <AppShell userId={user?.id || null}>{children}</AppShell>
      </body>
    </html>
  );
}
