"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Callout, ChoiceChip, Field, linkButtonClass } from "../../components/ui";

type Entry = "topic" | "find" | "surprise";

const safeStartErrors: Record<string, string> = {
  AI_SETTINGS_REQUIRED: "Connect Claude in Settings before creating a post.",
  AI_SETTINGS_INVALID: "Your Claude setup needs attention. Update it in Settings, then try again.",
  CREATION_LIMIT_REACHED: "You have reached today’s creation limit. Try again tomorrow.",
};

export function CreateEntry() {
  const router = useRouter();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [mode, setMode] = useState<"quick" | "guided">("quick");
  const [topic, setTopic] = useState("");
  const [direction, setDirection] = useState("");
  const [showDirection, setShowDirection] = useState(false);
  const [busyEntry, setBusyEntry] = useState<Entry | null>(null);
  const [error, setError] = useState("");
  const [aiStatus, setAiStatus] = useState<"loading" | "valid" | "required">("loading");
  const busy = busyEntry !== null;

  useEffect(() => {
    let active = true;
    fetch("/api/settings/ai", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Settings request failed");
        const settings = await response.json() as { status?: string };
        if (active) setAiStatus(settings.status === "valid" ? "valid" : "required");
      })
      .catch(() => { if (active) setAiStatus("required"); });
    return () => { active = false; };
  }, []);

  async function start(choice: Entry) {
    if (choice === "topic" && !topic.trim()) {
      setEntry("topic");
      setError("Enter a topic to continue.");
      return;
    }
    setBusyEntry(choice);
    setError("");
    try {
      const response = await fetch("/api/creation-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entry: choice,
          mode,
          topic: choice === "topic" ? topic : undefined,
          direction: showDirection ? direction : undefined,
        }),
      });
      const body = await response.json().catch(() => ({})) as { id?: string; code?: string };
      if (!response.ok || !body.id) {
        setError(
          (body.code && safeStartErrors[body.code])
          || "Could not start your post. Your details are still here—try again.",
        );
        return;
      }
      router.push("/create/" + body.id);
    } catch {
      setError("Connection failed. Your details are still here—try again.");
    } finally {
      setBusyEntry(null);
    }
  }

  if (aiStatus === "loading") {
    return <main className="page-container"><p role="status" className="page-intro">Checking Claude setup…</p></main>;
  }

  if (aiStatus === "required") {
    return <main className="page-container">
      <header className="page-heading">
        <p className="eyebrow">Create</p>
        <h1 className="display-heading">Bring your next post to life.</h1>
      </header>
      <Callout tone="waiting" className="mt-8 max-w-2xl">
        <h2 className="text-2xl font-semibold">Claude setup required</h2>
        <p className="mt-2 text-[var(--muted)]">Add and validate your Anthropic API key before Cadence can research or write a post.</p>
        <Link href="/settings" className={linkButtonClass.primary + " mt-5"}>Open Settings</Link>
      </Callout>
    </main>;
  }

  return <main className="page-container">
    <header className="page-heading">
      <p className="eyebrow">Create</p>
      <h1 className="display-heading">What would you like to share?</h1>
      <p className="page-intro">Start with a thought, explore ideas, or let Cadence discover an angle from your profile. You review every word before publishing.</p>
    </header>

    <fieldset className="mt-9 max-w-3xl">
      <legend className="text-lg font-semibold">How hands-on would you like to be?</legend>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <ChoiceChip selected={mode === "quick"}>
          <input type="radio" name="mode" checked={mode === "quick"} onChange={() => setMode("quick")} />
          <span><strong className="block">Quick</strong><span className="mt-1 block text-sm text-[var(--muted)]">Cadence chooses the idea and hook, then creates a draft for you.</span></span>
        </ChoiceChip>
        <ChoiceChip selected={mode === "guided"}>
          <input type="radio" name="mode" checked={mode === "guided"} onChange={() => setMode("guided")} />
          <span><strong className="block">Guided</strong><span className="mt-1 block text-sm text-[var(--muted)]">You choose the idea and opening line before Cadence writes.</span></span>
        </ChoiceChip>
      </div>
    </fieldset>

    <div className="mt-8 grid gap-4 lg:grid-cols-3">
      <section aria-labelledby="entry-topic" className="surface-card flex flex-col p-6">
        <p className="eyebrow">Start from a thought</p>
        <h2 id="entry-topic" className="mt-2 text-2xl font-semibold">I have a topic</h2>
        <p className="mt-3 flex-1 text-sm leading-6 text-[var(--muted)]">Bring a thought or question. Cadence will research and shape it.</p>
        <Button variant="secondary" disabled={busy} onClick={() => setEntry("topic")} className="mt-5 w-full">Choose topic</Button>
      </section>

      <section aria-labelledby="entry-find" className="surface-card flex flex-col p-6">
        <p className="eyebrow">Explore your pillars</p>
        <h2 id="entry-find" className="mt-2 text-2xl font-semibold">Find ideas</h2>
        <p className="mt-3 flex-1 text-sm leading-6 text-[var(--muted)]">Get several relevant angles grounded in the audience and topics you saved.</p>
        <Button variant="secondary" disabled={busy} onClick={() => void start("find")} className="mt-5 w-full">
          {busyEntry === "find" ? "Finding ideas…" : "Find ideas"}
        </Button>
      </section>

      <section aria-labelledby="entry-surprise" className="surface-card flex flex-col p-6">
        <p className="eyebrow">Let Cadence lead</p>
        <h2 id="entry-surprise" className="mt-2 text-2xl font-semibold">Surprise me</h2>
        <p className="mt-3 flex-1 text-sm leading-6 text-[var(--muted)]">Use a saved idea or discover a fresh angle that fits your voice.</p>
        <Button disabled={busy} onClick={() => void start("surprise")} className="mt-5 w-full">
          {busyEntry === "surprise" ? "Choosing an idea…" : "Surprise me"}
        </Button>
      </section>
    </div>

    {entry === "topic" && <section aria-label="Topic details" className="surface-card mt-5 p-6">
      <Field
        label={<label htmlFor="topic">What is your topic?</label>}
        hint="A rough thought is enough. Cadence will help find the shape."
      >
        <textarea
          id="topic"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          rows={3}
          placeholder="Example: why small AI features are harder to maintain than demos"
        />
      </Field>
      <Button disabled={busy} onClick={() => void start("topic")} className="mt-4">
        {busyEntry === "topic" ? "Starting your post…" : "Start with this topic"}
      </Button>
    </section>}

    <div className="mt-6">
      <Button
        variant="quiet"
        aria-expanded={showDirection}
        aria-controls="optional-direction"
        onClick={() => setShowDirection(!showDirection)}
      >
        {showDirection ? "Hide direction" : "Add direction (optional)"}
      </Button>
      {showDirection && <div id="optional-direction" className="surface-card mt-3 p-5">
        <Field label={<label htmlFor="direction">Anything Cadence should focus on?</label>} hint="Add a perspective, constraint, or point you want included.">
          <textarea id="direction" value={direction} onChange={(event) => setDirection(event.target.value)} rows={3} />
        </Field>
      </div>}
    </div>

    {error && <Callout tone="danger" className="mt-5 max-w-2xl">{error}</Callout>}
  </main>;
}
