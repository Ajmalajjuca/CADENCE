"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button, Callout, linkButtonClass } from "../../components/ui";
import { IdeaPicker } from "./idea-picker";
import { HookPicker } from "./hook-picker";
import { ProgressCard } from "./progress-card";
import { ResearchPanel } from "./research-panel";
import { deriveRunView } from "./run-view";
import { useCreationRun } from "./use-creation-run";

type Idea = Parameters<typeof IdeaPicker>[0]["ideas"][number];
type Hook = Parameters<typeof HookPicker>[0]["hooks"][number];
type Brief = Parameters<typeof ResearchPanel>[0]["brief"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stageIdeas(value: unknown): Idea[] {
  if (!isRecord(value) || !Array.isArray(value.ideas)) return [];
  return value.ideas as Idea[];
}

function stageHooks(value: unknown): Hook[] {
  if (!isRecord(value) || !Array.isArray(value.hooks)) return [];
  return value.hooks as Hook[];
}

export function RunProgress({ runId }: { runId: string }) {
  const { run, loading, error: loadError, refresh } = useCreationRun(runId);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [wakeRequestedAt, setWakeRequestedAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!run || (run.status !== "queued" && run.status !== "running")) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [run]);

  const view = useMemo(() => run ? deriveRunView(run, nowMs) : null, [nowMs, run]);
  const wakeCoolingDown = wakeRequestedAt !== null && nowMs - wakeRequestedAt < 30_000;

  async function choose(kind: "idea" | "hook", choiceId: string) {
    setBusy(true);
    setActionError("");
    try {
      const response = await fetch("/api/creation-runs/" + runId + "/choice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, choiceId }),
      });
      if (!response.ok) throw new Error("Choice request failed");
      await refresh();
    } catch {
      setActionError("Could not save your choice. Your progress is still saved—try again.");
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setBusy(true);
    setActionError("");
    try {
      const response = await fetch("/api/creation-runs/" + runId, { method: "PATCH" });
      if (!response.ok) throw new Error("Retry request failed");
      await refresh();
    } catch {
      setActionError("Could not retry this stage. Your earlier work is still saved.");
    } finally {
      setBusy(false);
    }
  }

  async function wake() {
    setBusy(true);
    setActionError("");
    try {
      const response = await fetch("/api/creation-runs/" + runId + "/wake", { method: "POST" });
      if (!response.ok) {
        setActionError("Could not wake the worker. Your run is still saved; try again shortly.");
      } else {
        const requestedAt = Date.now();
        setWakeRequestedAt(requestedAt);
        setNowMs(requestedAt);
      }
      await refresh();
    } catch {
      setActionError("Could not wake the worker. Your run is still saved; try again shortly.");
    } finally {
      setBusy(false);
    }
  }

  if (!run && loading) {
    return <main className="page-container page-container-narrow">
      <div className="mb-6 h-5 w-40 animate-pulse rounded bg-[var(--surface-muted)]" />
      <div className="surface-card min-h-96 animate-pulse p-8" aria-label="Loading creation progress">
        <p role="status" className="text-[var(--muted)]">Loading saved progress…</p>
      </div>
    </main>;
  }

  if (!run) {
    return <main className="page-container page-container-narrow">
      <Callout tone="danger">
        <h1 className="text-2xl font-semibold">Could not load this run</h1>
        <p className="mt-2">Your saved work has not been changed.</p>
        <Button onClick={() => void refresh()} className="mt-4">Try again</Button>
      </Callout>
    </main>;
  }

  const ideas = stageIdeas(run.stages.idea);
  const hooks = stageHooks(run.stages.hooks);
  const research = isRecord(run.stages.research) ? run.stages.research as Brief : null;
  const selectedIdea = isRecord(run.selected_idea) ? run.selected_idea : null;
  const selectedHook = isRecord(run.selected_hook) ? run.selected_hook : null;

  return <main className="page-container page-container-narrow">
    <Link href="/create" className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--muted)] underline decoration-[var(--border)] underline-offset-4 hover:text-[var(--ink)]">
      ← Create another post
    </Link>

    <div className="mt-5">
      <ProgressCard view={view!} />
    </div>

    {view?.action?.kind === "wake" && <div className="mt-5 flex flex-wrap items-center gap-3">
      <Button disabled={busy || wakeCoolingDown} onClick={() => void wake()}>Wake worker and check again</Button>
      <p className="text-sm text-[var(--muted)]">This safely checks the same saved run.</p>
    </div>}
    {wakeRequestedAt !== null && <Callout tone="success" className="mt-4">Wake request sent. Checking again…</Callout>}

    {view?.action?.kind === "settings" && <div className="mt-5">
      <Link href="/settings" className={linkButtonClass.primary}>Open Settings</Link>
    </div>}
    {view?.action?.kind === "retry" && <div className="mt-5">
      <Button disabled={busy} onClick={() => void retry()}>{busy ? "Retrying…" : "Retry this stage"}</Button>
    </div>}
    {view?.action?.kind === "review" && <div className="mt-5">
      <Link href={"/posts/" + view.action.draftId} className={linkButtonClass.primary}>Review your draft</Link>
    </div>}

    {selectedIdea && <section className="surface-card mt-7 p-6" aria-labelledby="selected-idea-heading">
      <p className="eyebrow">Your direction</p>
      <h2 id="selected-idea-heading" className="mt-2 text-2xl font-semibold">{String(selectedIdea.title ?? "Selected idea")}</h2>
      {Boolean(selectedIdea.angle) && <p className="mt-2 text-[var(--muted)]">{String(selectedIdea.angle)}</p>}
    </section>}

    {research && <ResearchPanel brief={research} />}

    {run.status === "waiting_for_user" && run.stage === "idea" && ideas.length > 0
      && <IdeaPicker ideas={ideas} onChoose={(id) => void choose("idea", id)} busy={busy} />}
    {run.status === "waiting_for_user" && run.stage === "hooks" && hooks.length > 0
      && <HookPicker hooks={hooks} onChoose={(id) => void choose("hook", id)} busy={busy} />}

    {selectedHook && <section className="surface-card mt-6 p-6">
      <p className="eyebrow">Selected hook</p>
      <p className="mt-3 whitespace-pre-wrap text-lg font-semibold">{String(selectedHook.text ?? "")}</p>
    </section>}

    {loadError && <Callout tone="danger" className="mt-5">
      <p>{loadError}</p>
      <Button variant="secondary" onClick={() => void refresh()} className="mt-3">Try again</Button>
    </Callout>}
    {actionError && <Callout tone="danger" className="mt-5">{actionError}</Callout>}
  </main>;
}
