"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Version = { id: string; version_no: number; text: string; hook: string; source_refs: string[]; created_at: string };
type Review = { draft: { id: string; title: string; status: string; legacy_post_url: string | null }; versions: Version[]; approved: { version: Version; approval: { id: string } } | null; attempts: Array<{ id: string; state: string; linkedin_post_url: string | null; error_message: string | null }> };

export function DraftEditor({ draftId }: { draftId: string }) {
  const router = useRouter();
  const [review, setReview] = useState<Review | null>(null);
  const [text, setText] = useState("");
  const [direction, setDirection] = useState("");
  const [showRevision, setShowRevision] = useState(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [settingsNeeded, setSettingsNeeded] = useState(false);

  async function load() {
    const response = await fetch(`/api/posts/${draftId}`);
    if (!response.ok) { setError("Could not load this draft."); return; }
    const data: Review = await response.json();
    setReview(data); setText(data.versions[0]?.text ?? ""); setError("");
    const connection = await fetch("/api/linkedin/status").catch(() => null);
    if (connection?.ok) setConnected((await connection.json()).status === "connected");
  }
  useEffect(() => {
    let active = true;
    fetch(`/api/posts/${draftId}`).then(async response => {
      if (!response.ok) throw new Error("load failed");
      const data: Review = await response.json();
      if (active) { setReview(data); setText(data.versions[0]?.text ?? ""); setError(""); }
      return fetch("/api/linkedin/status");
    }).then(async response => { if (active && response.ok) setConnected((await response.json()).status === "connected"); })
      .catch(() => { if (active) setError("Could not load this draft."); });
    return () => { active = false; };
  }, [draftId]);

  const current = review?.versions[0];
  const changed = !!current && text !== current.text;
  async function save() {
    if (!current) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/posts/${draftId}/versions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, sourceRefs: current.source_refs }) });
      if (!response.ok) throw new Error("save failed");
      await load(); setMessage("New version saved. Approve it before publishing.");
    } catch { setError("Could not save this version."); }
    finally { setBusy(false); }
  }
  async function approve() {
    if (!current || changed) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/posts/${draftId}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ versionId: current.id }) });
      if (!response.ok) throw new Error("approve failed");
      await load(); setMessage("This exact version is approved. Publish now is a separate step.");
    } catch { setError("Could not approve this version."); }
    finally { setBusy(false); }
  }
  async function revise() {
    setBusy(true); setError(""); setSettingsNeeded(false);
    try {
      const response = await fetch(`/api/posts/${draftId}/revise`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ direction }) });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Could not start a revision.");
        setSettingsNeeded(body.code === "AI_SETTINGS_REQUIRED" || body.code === "AI_SETTINGS_INVALID");
        return;
      }
      router.push(`/create/${body.id}`);
    } catch { setError("Could not start a revision."); }
    finally { setBusy(false); }
  }
  async function publish() {
    if (!review?.approved || changed || !connected) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/posts/${draftId}/publish`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) { setError(data.error ?? "Could not publish this post."); return; }
      await load(); setMessage(data.state === "published" ? "Published to LinkedIn." : data.state === "uncertain" ? "The result is uncertain. Check LinkedIn; Cadence will not send this version again." : data.state === "failed" ? (data.error ?? "LinkedIn rejected the post.") : "Publishing is in progress.");
    } catch { setError("The publish result is unknown. Cadence will not retry automatically; check the status below."); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto max-w-4xl px-6 py-12"><Link href="/library" className="text-sm underline">← Library</Link><h1 className="mt-5 text-3xl font-semibold">Review your post</h1><p className="mt-2 text-slate-600">{review?.draft.title || "Loading draft…"}</p>{review?.draft.status === "legacy_published" && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm">This post was published before it was imported. It cannot be approved or published again unless you save a new version. {review.draft.legacy_post_url && <a href={review.draft.legacy_post_url} target="_blank" rel="noopener noreferrer" className="underline">View the original</a>}</p>}
    {current && <div className="mt-8 grid gap-8 lg:grid-cols-[2fr_1fr]"><section><label htmlFor="post-text" className="block font-medium">Post text · Version {current.version_no}</label><textarea id="post-text" value={text} onChange={event => setText(event.target.value)} rows={18} className="mt-3 w-full rounded-xl border p-4 leading-relaxed" /><p className="mt-2 text-sm text-slate-500">{text.length} characters. Edits become a new version and need new approval.</p><div className="mt-4 flex flex-wrap gap-3"><button disabled={!changed || busy} onClick={() => void save()} className="rounded-lg border px-5 py-3 disabled:opacity-50">Save as new version</button><button disabled={changed || busy || !!review?.approved || review?.draft.status === "legacy_published"} onClick={() => void approve()} className="rounded-lg bg-slate-900 px-5 py-3 text-white disabled:opacity-50">Approve this version</button></div><div className="mt-5 rounded-xl border p-5"><h2 className="font-semibold">Publish</h2><p className="mt-2 text-sm text-slate-600">Approval confirms the exact text above. Publishing requires a separate click and your own LinkedIn connection.</p>{!connected && <p className="mt-2 text-sm">Connect your account in <Link href="/settings" className="underline">Settings</Link>.</p>}<button disabled={!review?.approved || changed || !connected || busy || review?.draft.status === "legacy_published"} onClick={() => void publish()} className="mt-4 rounded-lg bg-blue-700 px-5 py-3 text-white disabled:opacity-50">Publish now</button></div><div className="mt-7"><button type="button" onClick={() => setShowRevision(!showRevision)} className="underline">Request a revision</button>{showRevision && <div className="mt-3"><label htmlFor="revision-direction" className="block font-medium">What should change?</label><textarea id="revision-direction" value={direction} onChange={event => setDirection(event.target.value)} rows={3} className="mt-2 w-full rounded-lg border p-3" /><button disabled={!direction.trim() || busy} onClick={() => void revise()} className="mt-3 rounded-lg border px-5 py-3 disabled:opacity-50">Create revised version</button></div>}</div></section><aside className="space-y-6"><section className="rounded-xl border p-5"><h2 className="font-semibold">Sources</h2>{current.source_refs.length ? <ul className="mt-3 space-y-2">{current.source_refs.map(url => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-sm underline">{url}</a></li>)}</ul> : <p className="mt-2 text-sm text-slate-600">Opinion post with no factual source links.</p>}</section><section className="rounded-xl border p-5"><h2 className="font-semibold">Version history</h2><ol className="mt-3 space-y-2">{review?.versions.map(version => <li key={version.id} className="text-sm">Version {version.version_no} · {new Date(version.created_at).toLocaleString()}</li>)}</ol></section><section className="rounded-xl border p-5"><h2 className="font-semibold">Publication history</h2>{review?.attempts.length ? <ul className="mt-3 space-y-2">{review.attempts.map(attempt => <li key={attempt.id} className="text-sm capitalize">{attempt.state}{attempt.linkedin_post_url && <> · <a href={attempt.linkedin_post_url} target="_blank" rel="noopener noreferrer" className="underline">View on LinkedIn</a></>}{attempt.error_message && <p className="text-red-700">{attempt.error_message}</p>}</li>)}</ul> : <p className="mt-2 text-sm text-slate-600">No publish attempts yet.</p>}</section></aside></div>}
    <p role="status" className="mt-5 text-green-800">{message}</p><p role="alert" className="mt-3 text-red-700">{error}</p>{settingsNeeded && <p className="mt-2"><Link href="/settings" className="underline">Open Settings</Link></p>}
  </main>;
}
