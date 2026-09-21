"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Item = { id: string; kind: string; status: string; title: string; pillar: string | null; updated_at: string; href: string };
const filters = [{ value: "", label: "All" }, { value: "saved", label: "Ideas" }, { value: "draft", label: "Drafts" }, { value: "approved", label: "Approved" }, { value: "published", label: "Published" }, { value: "failed", label: "Failed" }, { value: "uncertain", label: "Needs attention" }];

export function LibraryList() {
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (query) params.set("query", query);
    fetch(`/api/library?${params}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("load failed");
      setItems(await response.json()); setError("");
    }).catch(cause => { if (cause.name !== "AbortError") setError("Could not load your Library."); }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [status,query]);
  return <div><div className="mt-7 flex flex-wrap gap-2" role="group" aria-label="Library filters">{filters.map(filter => <button key={filter.value} onClick={() => { setLoading(true); setStatus(filter.value); }} aria-pressed={status === filter.value} className={`rounded-full px-4 py-2 text-sm ${status === filter.value ? "bg-slate-900 text-white" : "bg-slate-100"}`}>{filter.label}</button>)}</div>
    <label className="mt-5 block"><span className="sr-only">Search Library</span><input value={query} onChange={event => { setLoading(true); setQuery(event.target.value); }} placeholder="Search titles" className="w-full rounded-lg border p-3" /></label>
    <p role="status" className="mt-4 text-slate-600">{error || (loading ? "Loading…" : `${items.length} items`)}</p>
    <div className="mt-4 space-y-3">{!loading && items.length === 0 && <p className="rounded-xl border p-6 text-slate-600">Nothing here yet. <Link href="/create" className="underline">Create a post</Link> or <Link href="/ideas" className="underline">save an idea</Link>.</p>}{items.map(item => <Link key={`${item.kind}-${item.id}`} href={item.href} className="block rounded-xl border p-5 hover:border-slate-500"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{item.title}</h2><span className="rounded-full bg-slate-100 px-3 py-1 text-xs capitalize">{item.status.replaceAll("_"," ")}</span></div><p className="mt-2 text-sm text-slate-600">{item.kind}{item.pillar ? ` · ${item.pillar}` : ""} · {new Date(item.updated_at).toLocaleDateString()}</p></Link>)}</div>
  </div>;
}
