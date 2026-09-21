"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";

type Idea = { id: string; title: string; angle: string; status: string; updated_at: string };

export default function IdeasPage() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [title, setTitle] = useState("");
  const [angle, setAngle] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (status) params.set("status", status);
    const response = await fetch(`/api/ideas?${params}`);
    if (response.ok) setIdeas(await response.json());
    else setMessage("Could not load ideas.");
  }, [query,status]);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (status) params.set("status", status);
    fetch(`/api/ideas?${params}`, { signal: controller.signal }).then(async response => {
      if (response.ok) setIdeas(await response.json());
      else setMessage("Could not load ideas.");
    }).catch(error => { if (error.name !== "AbortError") setMessage("Could not load ideas."); });
    return () => controller.abort();
  }, [query,status]);
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    const response = await fetch("/api/ideas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, angle }) });
    if (!response.ok) { setMessage("Could not save idea. Add a title and try again."); return; }
    setTitle(""); setAngle(""); setMessage("Idea saved."); await load();
  }
  async function discard(id: string) {
    const response = await fetch(`/api/ideas/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "discarded" }) });
    if (response.ok) await load(); else setMessage("Could not discard idea.");
  }
  return <main className="mx-auto max-w-4xl px-6 py-12">
    <h1 className="text-3xl font-semibold">Ideas</h1><p className="mt-2 text-slate-600">Save a thought now and turn it into a post later.</p>
    <form onSubmit={add} className="mt-8 space-y-3 rounded-xl border p-5"><label className="block font-medium" htmlFor="idea-title">Idea title</label><input id="idea-title" required value={title} onChange={event => setTitle(event.target.value)} className="w-full rounded-lg border p-3" placeholder="What would you like to write about?" /><label className="block font-medium" htmlFor="idea-angle">Your angle (optional)</label><textarea id="idea-angle" value={angle} onChange={event => setAngle(event.target.value)} className="w-full rounded-lg border p-3" rows={3} /><button className="rounded-lg bg-slate-900 px-5 py-3 text-white">Save idea</button></form>
    <div className="mt-8 flex flex-wrap gap-3"><label className="sr-only" htmlFor="idea-search">Search ideas</label><input id="idea-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search ideas" className="min-w-48 flex-1 rounded-lg border p-3" /><label className="sr-only" htmlFor="idea-status">Status</label><select id="idea-status" value={status} onChange={event => setStatus(event.target.value)} className="rounded-lg border p-3"><option value="">All ideas</option><option value="saved">Saved</option><option value="in_progress">In progress</option><option value="used">Used</option><option value="discarded">Discarded</option></select></div>
    <p role="status" className="mt-3">{message}</p>
    <div className="mt-5 space-y-3">{ideas.length === 0 ? <p className="rounded-xl border p-6 text-slate-600">No ideas here yet. Save your first idea or <Link className="underline" href="/create">create a post</Link>.</p> : ideas.map(idea => <article key={idea.id} className="rounded-xl border p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{idea.title}</h2><p className="mt-1 text-slate-600">{idea.angle}</p><p className="mt-2 text-sm text-slate-500">{idea.status}</p></div>{idea.status !== "discarded" && <button onClick={() => discard(idea.id)} className="rounded-lg border px-3 py-2 text-sm">Discard</button>}</div></article>)}</div>
  </main>;
}
