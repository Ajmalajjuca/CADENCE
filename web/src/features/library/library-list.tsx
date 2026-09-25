"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Callout, StatusBadge } from "../../components/ui";

type Item = { id: string; kind: string; status: string; title: string; pillar: string | null; updated_at: string; href: string };
const filters = [
  { value: "", label: "All" },
  { value: "saved", label: "Ideas" },
  { value: "draft", label: "Drafts" },
  { value: "approved", label: "Approved" },
  { value: "published", label: "Published" },
  { value: "failed", label: "Failed" },
  { value: "uncertain", label: "Needs attention" },
];

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
    fetch("/api/library?" + params, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("load failed");
      setItems(await response.json());
      setError("");
    }).catch((cause) => {
      if (cause.name !== "AbortError") setError("Could not load your Library.");
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [status, query]);

  return <section className="mt-8" aria-label="Library content">
    <div className="flex flex-wrap gap-2" role="group" aria-label="Library filters">
      {filters.map((filter) => <Button
        key={filter.value}
        variant={status === filter.value ? "primary" : "secondary"}
        onClick={() => { setLoading(true); setStatus(filter.value); }}
        aria-pressed={status === filter.value}
        className="rounded-full"
      >
        {filter.label}
      </Button>)}
    </div>
    <label className="mt-5 block">
      <span className="sr-only">Search Library</span>
      <input value={query} onChange={(event) => { setLoading(true); setQuery(event.target.value); }} placeholder="Search titles" className="text-control" />
    </label>
    <p role="status" className="mt-4 text-sm text-[var(--muted)]">{loading ? "Loading…" : error ? "Library needs attention." : items.length + " items"}</p>
    {error && <Callout tone="danger" className="mt-3">{error}</Callout>}
    <div className="mt-4 space-y-3">
      {!loading && items.length === 0 && <p className="surface-card p-6 text-[var(--muted)]">Nothing here yet. <Link href="/create" className="font-semibold underline underline-offset-4">Create a post</Link> or <Link href="/ideas" className="font-semibold underline underline-offset-4">save an idea</Link>.</p>}
      {items.map((item) => <Link key={item.kind + "-" + item.id} href={item.href} className="surface-card block p-5 transition-transform hover:-translate-y-0.5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">{item.title}</h2>
          <StatusBadge tone={item.status === "failed" || item.status === "uncertain" ? "danger" : item.status === "published" ? "success" : "neutral"}>{item.status.replaceAll("_", " ")}</StatusBadge>
        </div>
        <p className="mt-2 text-sm text-[var(--muted)]">{item.kind}{item.pillar ? " · " + item.pillar : ""} · {new Date(item.updated_at).toLocaleDateString()}</p>
      </Link>)}
    </div>
  </section>;
}
