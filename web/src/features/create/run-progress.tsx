"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { IdeaPicker } from "./idea-picker";
import { HookPicker } from "./hook-picker";
import { ResearchPanel } from "./research-panel";

type Run = { id: string; entry: string; mode: string; stage: string; status: string; error_message: string | null; selected_idea: { title: string; angle: string } | null; selected_hook: { text: string } | null; stages: Record<string, unknown>; draft_id: string | null };
const stageNames: Record<string,string> = { idea: "Finding ideas", research: "Researching the topic", hooks: "Writing opening lines", draft: "Writing a draft", style: "Checking your voice", revision: "Revising your draft", ready: "Ready to review" };

export function RunProgress({ runId }: { runId: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const response = await fetch(`/api/creation-runs/${runId}`);
        if (!response.ok) throw new Error("load failed");
        const data = await response.json();
        if (live) { setRun(data); setError(""); }
      } catch { if (live) setError("Could not load your saved progress."); }
    }
    void load();
    const timer = setInterval(() => void load(), 2500);
    return () => { live = false; clearInterval(timer); };
  }, [runId]);

  async function choose(kind: "idea" | "hook", choiceId: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/creation-runs/${runId}/choice`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, choiceId }) });
      if (!response.ok) throw new Error("choose failed");
      setRun(await response.json());
    } catch { setError("Could not save your choice. Try again."); }
    finally { setBusy(false); }
  }
  async function retry() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/creation-runs/${runId}`, { method: "PATCH" });
      if (!response.ok) throw new Error("retry failed");
      setRun(await response.json());
    } catch { setError("Could not retry this stage."); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto max-w-3xl px-6 py-12"><Link href="/create" className="text-sm underline">← Create another post</Link><h1 className="mt-5 text-3xl font-semibold">Your post in progress</h1>
    <p role="status" aria-live="polite" className="mt-3 text-slate-600">{run ? stageNames[run.stage] ?? run.stage : "Loading saved progress…"}{run?.status === "failed" ? " · Needs attention" : ""}</p>
    {run?.selected_idea && <div className="mt-6 rounded-xl bg-slate-100 p-5"><h2 className="font-semibold">Selected idea</h2><p className="mt-1">{run.selected_idea.title}</p><p className="mt-1 text-sm text-slate-600">{run.selected_idea.angle}</p></div>}
    {Boolean(run?.stages.research) && <ResearchPanel brief={run!.stages.research as Parameters<typeof ResearchPanel>[0]["brief"]} />}
    {run?.status === "waiting_for_user" && run.stage === "idea" && <IdeaPicker ideas={(run.stages.idea as { ideas: Parameters<typeof IdeaPicker>[0]["ideas"] }).ideas} onChoose={id => void choose("idea",id)} busy={busy} />}
    {run?.status === "waiting_for_user" && run.stage === "hooks" && <HookPicker hooks={(run.stages.hooks as { hooks: Parameters<typeof HookPicker>[0]["hooks"] }).hooks} onChoose={id => void choose("hook",id)} busy={busy} />}
    {run?.selected_hook && <p className="mt-6 rounded-xl border p-5"><span className="block text-sm text-slate-500">Selected hook</span>{run.selected_hook.text}</p>}
    {run?.status === "failed" && <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-5"><p>Cadence stopped at this stage. Your earlier choices and research are saved.</p><p className="mt-2 text-sm">{run.error_message}</p><button disabled={busy} onClick={() => void retry()} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-50">Retry this stage</button></div>}
    {run?.status === "complete" && run.draft_id && <Link href={`/posts/${run.draft_id}`} className="mt-7 inline-block rounded-lg bg-slate-900 px-5 py-3 text-white">Review your draft</Link>}
    <p role="alert" className="mt-4 text-red-700">{error}</p>
  </main>;
}
