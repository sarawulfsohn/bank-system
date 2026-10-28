import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Bank Statement Parser",
  description: "Extract key data from bank statement PDFs with Workers AI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-background font-sans text-foreground antialiased`}
      >
        <SiteHeader />
        {children}
        <footer className="mx-auto max-w-5xl px-6 py-8 text-xs text-muted-foreground">
          <Link href="/privacy" className="hover:underline">Privacy notice</Link>
        </footer>
      </body>
    </html>
  );
}
