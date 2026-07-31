import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/sidebar";

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
    <html lang="pt-BR" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans bg-[var(--color-bg-primary)]`} suppressHydrationWarning>
        <div className="min-h-screen w-full">
          {/* Sidebar - Desktop */}
          <Sidebar />
          
          {/* Main Content */}
          <main className="lg:ml-[260px] pb-20 lg:pb-0 min-h-screen flex flex-col">
            <div className="w-full max-w-6xl px-6 sm:px-10 lg:px-12 py-10 lg:py-16">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
