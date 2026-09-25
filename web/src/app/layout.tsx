import type { Metadata } from "next";
import { Inter, Newsreader } from "next/font/google";
import { AppShell } from "../components/app-shell";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-editorial", display: "swap" });

export const metadata: Metadata = {
  title: "Cadence — LinkedIn content in your voice",
  description: "Research, write, review, and publish LinkedIn posts in your own voice.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={[inter.variable, newsreader.variable, "h-full antialiased"].join(" ")}>
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
