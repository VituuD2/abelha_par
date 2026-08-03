import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Scanner Checkout — Conferência de Pedidos",
  description:
    "Sistema de bipagem para conferência de pedidos Olist com dados Yampi. Garanta que apenas os pedidos corretos sejam despachados.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className={`${inter.variable} font-sans bg-[var(--color-bg-primary)]`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
