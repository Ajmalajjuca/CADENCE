"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Callout, Field, linkButtonClass, StatusBadge } from "../../components/ui";

type Version = { id: string; version_no: number; text: string; hook: string; source_refs: string[]; created_at: string };
type Review = {
  draft: { id: string; title: string; status: string; legacy_post_url: string | null };
  versions: Version[];
  approved: { version: Version; approval: { id: string } } | null;
  attempts: Array<{ id: string; state: string; linkedin_post_url: string | null; error_message: string | null }>;
};

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
    const response = await fetch("/api/posts/" + draftId);
    if (!response.ok) { setError("Could not load this draft."); return; }
    const data: Review = await response.json();
    setReview(data);
    setText(data.versions[0]?.text ?? "");
    setError("");
    const connection = await fetch("/api/linkedin/status").catch(() => null);
    if (connection?.ok) setConnected((await connection.json()).status === "connected");
  }

  useEffect(() => {
    let active = true;
    fetch("/api/posts/" + draftId).then(async (response) => {
      if (!response.ok) throw new Error("load failed");
      const data: Review = await response.json();
      if (active) { setReview(data); setText(data.versions[0]?.text ?? ""); setError(""); }
      return fetch("/api/linkedin/status");
    }).then(async (response) => {
      if (active && response.ok) setConnected((await response.json()).status === "connected");
    }).catch(() => {
      if (active) setError("Could not load this draft.");
    });
    return () => { active = false; };
  }, [draftId]);

  const current = review?.versions[0];
  const changed = !!current && text !== current.text;

  async function save() {
    if (!current) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/posts/" + draftId + "/versions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, sourceRefs: current.source_refs }),
      });
      if (!response.ok) throw new Error("save failed");
      await load();
      setMessage("New version saved. Approve it before publishing.");
    } catch {
      setError("Could not save this version.");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!current || changed) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/posts/" + draftId + "/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionId: current.id }),
      });
      if (!response.ok) throw new Error("approve failed");
      await load();
      setMessage("This exact version is approved. Publish now is a separate step.");
    } catch {
      setError("Could not approve this version.");
    } finally {
      setBusy(false);
    }
  }

  async function revise() {
    setBusy(true);
    setError("");
    setSettingsNeeded(false);
    try {
      const response = await fetch("/api/posts/" + draftId + "/revise", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ direction }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Could not start a revision.");
        setSettingsNeeded(body.code === "AI_SETTINGS_REQUIRED" || body.code === "AI_SETTINGS_INVALID");
        return;
      }
      router.push("/create/" + body.id);
    } catch {
      setError("Could not start a revision.");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!review?.approved || changed || !connected) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/posts/" + draftId + "/publish", { method: "POST" });
      const data = await response.json();
      if (!response.ok) { setError(data.error ?? "Could not publish this post."); return; }
      await load();
      setMessage(
        data.state === "published"
          ? "Published to LinkedIn."
          : data.state === "uncertain"
            ? "The result is uncertain. Check LinkedIn; Cadence will not send this version again."
            : data.state === "failed"
              ? (data.error ?? "LinkedIn rejected the post.")
              : "Publishing is in progress.",
      );
    } catch {
      setError("The publish result is unknown. Cadence will not retry automatically; check the status below.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="page-container">
    <Link href="/library" className="inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4">← Library</Link>
    <header className="page-heading mt-5">
      <p className="eyebrow">Draft review</p>
      <h1 className="display-heading">Review your post</h1>
      <p className="page-intro">{review?.draft.title || "Loading draft…"}</p>
    </header>

    {review?.draft.status === "legacy_published" && <Callout tone="waiting" className="mt-5">
      This post was published before it was imported. It cannot be approved or published again unless you save a new version.{" "}
      {review.draft.legacy_post_url && <a href={review.draft.legacy_post_url} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-4">View the original</a>}
    </Callout>}

    {current && <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
      <section className="space-y-6" aria-label="Draft editor">
        <div className="surface-card p-6">
          <Field label={"Post text · Version " + current.version_no} htmlFor="post-text">
            <textarea id="post-text" value={text} onChange={(event) => setText(event.target.value)} rows={18} className="leading-relaxed" />
          </Field>
          <p className="mt-2 text-sm text-[var(--muted)]">{text.length} characters. Edits become a new version and need new approval.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button variant="secondary" disabled={!changed || busy} onClick={() => void save()}>Save as new version</Button>
            <Button disabled={changed || busy || !!review?.approved || review?.draft.status === "legacy_published"} onClick={() => void approve()}>Approve this version</Button>
          </div>
        </div>

        <section className="surface-card p-6" aria-labelledby="publish-heading">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="publish-heading" className="text-2xl font-semibold">Publish</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">Approval confirms the exact text above. Publishing requires a separate click and your own LinkedIn connection.</p>
            </div>
            <StatusBadge tone={connected ? "success" : "waiting"}>{connected ? "LinkedIn connected" : "Connection needed"}</StatusBadge>
          </div>
          {!connected && <p className="mt-3 text-sm">Connect your account in <Link href="/settings" className="font-semibold underline underline-offset-4">Settings</Link>.</p>}
          <Button disabled={!review?.approved || changed || !connected || busy || review?.draft.status === "legacy_published"} onClick={() => void publish()} className="mt-4">Publish now</Button>
        </section>

        <section className="surface-card p-6" aria-labelledby="revision-heading">
          <h2 id="revision-heading" className="text-2xl font-semibold">Want another pass?</h2>
          <Button variant="quiet" aria-expanded={showRevision} onClick={() => setShowRevision(!showRevision)} className="mt-2 px-0 underline underline-offset-4">Request a revision</Button>
          {showRevision && <div className="mt-4">
            <Field label="What should change?" htmlFor="revision-direction" hint="Be specific about the tone, structure, or point you want sharpened.">
              <textarea id="revision-direction" value={direction} onChange={(event) => setDirection(event.target.value)} rows={3} />
            </Field>
            <Button variant="secondary" disabled={!direction.trim() || busy} onClick={() => void revise()} className="mt-3">Create revised version</Button>
          </div>}
        </section>
      </section>

      <aside className="space-y-5">
        <section className="surface-card p-5">
          <h2 className="text-xl font-semibold">Sources</h2>
          {current.source_refs.length
            ? <ul className="mt-3 space-y-2">{current.source_refs.map((url) => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-sm font-semibold underline underline-offset-4">{url}</a></li>)}</ul>
            : <p className="mt-2 text-sm text-[var(--muted)]">Opinion post with no factual source links.</p>}
        </section>
        <section className="surface-card p-5">
          <h2 className="text-xl font-semibold">Version history</h2>
          <ol className="mt-3 space-y-2">{review?.versions.map((version) => <li key={version.id} className="text-sm text-[var(--muted)]">Version {version.version_no} · {new Date(version.created_at).toLocaleString()}</li>)}</ol>
        </section>
        <section className="surface-card p-5">
          <h2 className="text-xl font-semibold">Publication history</h2>
          {review?.attempts.length
            ? <ul className="mt-3 space-y-2">{review.attempts.map((attempt) => <li key={attempt.id} className="text-sm capitalize">
                {attempt.state}
                {attempt.linkedin_post_url && <> · <a href={attempt.linkedin_post_url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">View on LinkedIn</a></>}
                {attempt.error_message && <p className="mt-1 text-[var(--danger)]">{attempt.error_message}</p>}
              </li>)}</ul>
            : <p className="mt-2 text-sm text-[var(--muted)]">No publish attempts yet.</p>}
        </section>
      </aside>
    </div>}

    {message && <Callout role="status" tone="success" className="mt-5">{message}</Callout>}
    {error && <Callout tone="danger" className="mt-5">{error}</Callout>}
    {settingsNeeded && <p className="mt-3"><Link href="/settings" className={linkButtonClass.primary}>Open Settings</Link></p>}
  </main>;
}
