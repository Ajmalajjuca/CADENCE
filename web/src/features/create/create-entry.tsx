"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Entry = "topic" | "find" | "surprise";

export function CreateEntry() {
  const router = useRouter();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [mode, setMode] = useState<"quick" | "guided">("quick");
  const [topic, setTopic] = useState("");
  const [direction, setDirection] = useState("");
  const [showDirection, setShowDirection] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [aiStatus, setAiStatus] = useState<"loading" | "valid" | "required">("loading");

  useEffect(() => {
    let active = true;
    fetch("/api/settings/ai", { cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error();
        const settings = await response.json() as { status?: string };
        if (active) setAiStatus(settings.status === "valid" ? "valid" : "required");
      })
      .catch(() => { if (active) setAiStatus("required"); });
    return () => { active = false; };
  }, []);

  async function start(choice: Entry) {
    if (choice === "topic" && !topic.trim()) { setEntry("topic"); setError("Enter a topic to continue."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/creation-runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entry: choice, mode, topic: choice === "topic" ? topic : undefined, direction: showDirection ? direction : undefined }) });
      const body = await response.json();
      if (!response.ok) { setError(body.error ?? "Could not start a post."); return; }
      router.push(`/create/${body.id}`);
    } catch { setError("Connection failed. Try again."); }
    finally { setBusy(false); }
  }

  if (aiStatus === "loading") return <div className="mx-auto max-w-4xl px-6 py-12"><p role="status" className="text-slate-600">Checking Claude setup…</p></div>;

  if (aiStatus === "required") return <div className="mx-auto max-w-4xl px-6 py-12">
    <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">Create</p>
    <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-6">
      <h1 className="text-2xl font-semibold">Claude setup required</h1>
      <p className="mt-2 max-w-2xl text-slate-700">Add and validate your Anthropic API key before Cadence can research or write a post.</p>
      <Link href="/settings" className="mt-5 inline-block rounded-lg bg-slate-900 px-5 py-3 text-white">Open Settings</Link>
    </section>
  </div>;

  return <div className="mx-auto max-w-4xl px-6 py-12">
    <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">Create</p>
    <h1 className="mt-2 text-4xl font-semibold">What would you like to share?</h1>
    <p className="mt-3 max-w-2xl text-slate-600">Start with a thought, explore ideas, or let Cadence choose one from your profile. You can review every word before publishing.</p>
    <fieldset className="mt-8"><legend className="font-medium">How much would you like to choose?</legend><div className="mt-3 flex gap-3"><label className="flex items-center gap-2"><input type="radio" name="mode" checked={mode === "quick"} onChange={() => setMode("quick")} /> Quick</label><label className="flex items-center gap-2"><input type="radio" name="mode" checked={mode === "guided"} onChange={() => setMode("guided")} /> Guided</label></div><p className="mt-2 text-sm text-slate-600">Quick makes the first choices for you. Guided lets you choose an idea and a hook.</p></fieldset>
    <div className="mt-8 grid gap-4 sm:grid-cols-3">
      <section className={`rounded-2xl border p-5 ${entry === "topic" ? "border-slate-900" : ""}`}><h2 className="text-xl font-semibold">I have a topic</h2><p className="mt-2 min-h-16 text-sm text-slate-600">Bring a thought or question. Cadence will research and shape it.</p><button onClick={() => setEntry("topic")} className="mt-4 rounded-lg border px-4 py-2">Choose topic</button></section>
      <section className="rounded-2xl border p-5"><h2 className="text-xl font-semibold">Find ideas</h2><p className="mt-2 min-h-16 text-sm text-slate-600">Explore relevant ideas from your content pillars.</p><button disabled={busy} onClick={() => void start("find")} className="mt-4 rounded-lg border px-4 py-2 disabled:opacity-50">Find ideas</button></section>
      <section className="rounded-2xl border p-5"><h2 className="text-xl font-semibold">Surprise me</h2><p className="mt-2 min-h-16 text-sm text-slate-600">Use a saved idea or discover a fresh angle.</p><button disabled={busy} onClick={() => void start("surprise")} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-50">Surprise me</button></section>
    </div>
    {entry === "topic" && <div className="mt-6 rounded-2xl border p-5"><label htmlFor="topic" className="block font-medium">What is your topic?</label><textarea id="topic" value={topic} onChange={event => setTopic(event.target.value)} rows={3} placeholder="Example: why small AI features are harder to maintain than demos" className="mt-3 w-full rounded-lg border p-3" /><button disabled={busy} onClick={() => void start("topic")} className="mt-3 rounded-lg bg-slate-900 px-5 py-3 text-white disabled:opacity-50">Start with this topic</button></div>}
    <div className="mt-6"><button type="button" aria-expanded={showDirection} onClick={() => setShowDirection(!showDirection)} className="text-sm underline">{showDirection ? "Hide direction" : "Add direction (optional)"}</button>{showDirection && <label className="mt-3 block"><span className="block text-sm font-medium">Anything Cadence should focus on?</span><textarea value={direction} onChange={event => setDirection(event.target.value)} rows={3} className="mt-2 w-full rounded-lg border p-3" /></label>}</div>
    <p role="alert" className="mt-4 text-red-700">{error}</p>
  </div>;
}
