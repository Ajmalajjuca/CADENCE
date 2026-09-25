"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Callout, Field, StatusBadge } from "../../components/ui";

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
    const response = await fetch("/api/ideas?" + params);
    if (response.ok) setIdeas(await response.json());
    else setMessage("Could not load ideas.");
  }, [query, status]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (status) params.set("status", status);
    fetch("/api/ideas?" + params, { signal: controller.signal }).then(async (response) => {
      if (response.ok) setIdeas(await response.json());
      else setMessage("Could not load ideas.");
    }).catch((error) => { if (error.name !== "AbortError") setMessage("Could not load ideas."); });
    return () => controller.abort();
  }, [query, status]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const response = await fetch("/api/ideas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, angle }),
    });
    if (!response.ok) { setMessage("Could not save idea. Add a title and try again."); return; }
    setTitle("");
    setAngle("");
    setMessage("Idea saved.");
    await load();
  }

  async function discard(id: string) {
    const response = await fetch("/api/ideas/" + id, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "discarded" }),
    });
    if (response.ok) await load();
    else setMessage("Could not discard idea.");
  }

  return <main className="page-container">
    <header className="page-heading">
      <p className="eyebrow">Ideas</p>
      <h1 className="display-heading">Keep the thoughts worth returning to.</h1>
      <p className="page-intro">Save a thought now and turn it into a post when the moment is right.</p>
    </header>

    <form onSubmit={add} className="surface-card mt-8 space-y-5 p-6">
      <Field label="Idea title" htmlFor="idea-title">
        <input id="idea-title" required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What would you like to write about?" />
      </Field>
      <Field label="Your angle (optional)" htmlFor="idea-angle" hint="What makes your take useful or different?">
        <textarea id="idea-angle" value={angle} onChange={(event) => setAngle(event.target.value)} rows={3} />
      </Field>
      <Button type="submit">Save idea</Button>
    </form>

    <div className="mt-8 grid gap-3 sm:grid-cols-[1fr_auto]">
      <Field label={<span className="sr-only">Search ideas</span>}>
        <input id="idea-search" aria-label="Search ideas" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ideas" />
      </Field>
      <Field label={<span className="sr-only">Status</span>}>
        <select id="idea-status" aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All ideas</option><option value="saved">Saved</option><option value="in_progress">In progress</option><option value="used">Used</option><option value="discarded">Discarded</option>
        </select>
      </Field>
    </div>

    {message && <Callout role="status" tone={message.includes("Could not") ? "danger" : "success"} className="mt-4">{message}</Callout>}
    <div className="mt-5 space-y-3">
      {ideas.length === 0
        ? <p className="surface-card p-6 text-[var(--muted)]">No ideas here yet. Save your first idea or <Link className="font-semibold underline underline-offset-4" href="/create">create a post</Link>.</p>
        : ideas.map((idea) => <article key={idea.id} className="surface-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">{idea.title}</h2>
              <p className="mt-1 text-[var(--muted)]">{idea.angle}</p>
              <StatusBadge tone={idea.status === "discarded" ? "neutral" : "success"} className="mt-3">{idea.status.replaceAll("_", " ")}</StatusBadge>
            </div>
            {idea.status !== "discarded" && <Button variant="quiet" onClick={() => void discard(idea.id)}>Discard</Button>}
          </div>
        </article>)}
    </div>
  </main>;
}
