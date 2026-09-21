import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cadence — LinkedIn content in your voice",
  description: "Research, write, review, and publish LinkedIn posts in your own voice.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-[#f8f8f5] text-slate-900">
        <header className="border-b bg-white"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4"><Link href="/" className="text-xl font-bold tracking-tight">Cadence<span className="text-blue-700">.</span></Link><nav aria-label="Main navigation" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm"><Link href="/create" className="hover:underline">Create</Link><Link href="/ideas" className="hover:underline">Ideas</Link><Link href="/library" className="hover:underline">Library</Link><Link href="/profile" className="hover:underline">Voice &amp; Profile</Link><Link href="/settings" className="hover:underline">Settings</Link></nav></div></header>
        <div className="flex-1">{children}</div>
        <footer className="border-t bg-white px-6 py-5 text-center text-xs text-slate-500">Cadence · Your words, your approval, your LinkedIn account.</footer>
      </body>
    </html>
  );
}
