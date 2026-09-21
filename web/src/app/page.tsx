"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type Run = { id: string; status: string; stage: string; topic: string; selected_idea: { title?: string } | null; created_at: string };

export default function Home() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/creation-runs").then(async response => {
      if (response.status === 401) { setSignedIn(false); return; }
      if (!response.ok) throw new Error();
      setRuns(await response.json()); setSignedIn(true);
    }).catch(() => setSignedIn(false));
  }, []);
  return <main className="mx-auto max-w-5xl px-6 py-16">
    <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">Cadence</p>
    <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">Good ideas deserve your voice.</h1>
    <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">Research a topic, shape a LinkedIn post, review every word, then publish when you are ready. No prompts to learn.</p>
    <div className="mt-8 flex flex-wrap gap-3"><Link href={signedIn === false ? "/sign-in" : "/create"} className="rounded-xl bg-slate-900 px-6 py-4 font-medium text-white">Create a post</Link><Link href={signedIn === false ? "/sign-in" : "/onboarding"} className="rounded-xl border px-6 py-4 font-medium">Set up your voice</Link></div>
    {signedIn === false && <p className="mt-5 text-sm text-slate-600">Cadence is currently open to invited members.</p>}
    {signedIn && <section className="mt-16"><div className="flex items-baseline justify-between"><h2 className="text-2xl font-semibold">Pick up where you left off</h2><Link href="/library" className="text-sm underline">View Library</Link></div>{runs.length ? <div className="mt-5 grid gap-3 sm:grid-cols-2">{runs.slice(0,4).map(run => <Link key={run.id} href={run.status === "complete" ? "/library" : `/create/${run.id}`} className="rounded-xl border bg-white p-5 hover:border-slate-500"><span className="text-xs uppercase tracking-wide text-slate-500">{run.status.replaceAll("_"," ")} · {run.stage}</span><h3 className="mt-2 font-semibold">{run.selected_idea?.title || run.topic || "New post"}</h3><p className="mt-2 text-sm text-slate-500">{new Date(run.created_at).toLocaleDateString()}</p></Link>)}</div> : <p className="mt-5 rounded-xl border bg-white p-6 text-slate-600">Your first post starts here. You can use a topic or let Cadence find one.</p>}</section>}
    <section className="mt-16 grid gap-5 sm:grid-cols-3"><div className="rounded-xl border bg-white p-6"><span className="text-sm text-blue-700">01</span><h2 className="mt-3 text-lg font-semibold">Tell us how you write</h2><p className="mt-2 text-sm leading-6 text-slate-600">Answer a short interview once. You can change your voice, rules, and story bank anytime.</p></div><div className="rounded-xl border bg-white p-6"><span className="text-sm text-blue-700">02</span><h2 className="mt-3 text-lg font-semibold">Choose the idea</h2><p className="mt-2 text-sm leading-6 text-slate-600">Start with a topic, look through researched ideas, or ask for a surprise.</p></div><div className="rounded-xl border bg-white p-6"><span className="text-sm text-blue-700">03</span><h2 className="mt-3 text-lg font-semibold">Review, then publish</h2><p className="mt-2 text-sm leading-6 text-slate-600">Edit and approve one exact version. A separate click publishes it to your account.</p></div></section>
  </main>;
}
