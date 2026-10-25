import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Spørg Danmarks Statistik",
  description: "Ask questions in Danish or English and get answers from Statistics Denmark's StatBank, with sources.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="da">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
