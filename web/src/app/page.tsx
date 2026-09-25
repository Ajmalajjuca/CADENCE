"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { linkButtonClass, StatusBadge } from "../components/ui";

type Run = { id: string; status: string; stage: string; topic: string; selected_idea: { title?: string } | null; created_at: string };

export default function Home() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/creation-runs").then(async (response) => {
      if (response.status === 401) { setSignedIn(false); return; }
      if (!response.ok) throw new Error();
      setRuns(await response.json());
      setSignedIn(true);
    }).catch(() => setSignedIn(false));
  }, []);

  return <main className="page-container">
    <header className="page-heading">
      <p className="eyebrow">A calmer way to publish</p>
      <h1 className="display-heading">Good ideas deserve your voice.</h1>
      <p className="page-intro">Research a topic, shape a LinkedIn post, review every word, then publish when you are ready. No prompts to learn.</p>
    </header>
    <div className="mt-8 flex flex-wrap gap-3">
      <Link href={signedIn === false ? "/sign-in" : "/create"} className={linkButtonClass.primary}>Create a post</Link>
      <Link href={signedIn === false ? "/sign-in" : "/onboarding"} className={linkButtonClass.secondary}>Set up your voice</Link>
    </div>
    {signedIn === false && <p className="mt-5 text-sm text-[var(--muted)]">Cadence is currently open to invited members.</p>}
    {signedIn && <section className="mt-16">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-3xl font-semibold">Pick up where you left off</h2>
        <Link href="/library" className="text-sm font-semibold underline underline-offset-4">View Library</Link>
      </div>
      {runs.length ? <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {runs.slice(0, 4).map((run) => <Link key={run.id} href={run.status === "complete" ? "/library" : "/create/" + run.id} className="surface-card block p-5 transition-transform hover:-translate-y-0.5">
          <StatusBadge tone={run.status === "complete" ? "success" : run.status === "failed" ? "danger" : "progress"}>{run.status.replaceAll("_", " ")} · {run.stage}</StatusBadge>
          <h3 className="mt-3 text-xl font-semibold">{run.selected_idea?.title || run.topic || "New post"}</h3>
          <p className="mt-2 text-sm text-[var(--muted)]">{new Date(run.created_at).toLocaleDateString()}</p>
        </Link>)}
      </div> : <p className="surface-card mt-5 p-6 text-[var(--muted)]">Your first post starts here. You can use a topic or let Cadence find one.</p>}
    </section>}
    <section className="mt-16 grid gap-5 sm:grid-cols-3" aria-label="How Cadence works">
      {[
        ["01", "Tell us how you write", "Answer a short interview once. You can change your voice, rules, and story bank anytime."],
        ["02", "Choose the idea", "Start with a topic, look through researched ideas, or ask for a surprise."],
        ["03", "Review, then publish", "Edit and approve one exact version. A separate click publishes it to your account."],
      ].map(([number, title, copy]) => <article key={number} className="surface-card p-6">
        <span className="eyebrow">{number}</span>
        <h2 className="mt-3 text-xl font-semibold">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{copy}</p>
      </article>)}
    </section>
  </main>;
}
