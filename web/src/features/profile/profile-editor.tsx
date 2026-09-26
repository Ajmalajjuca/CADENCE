"use client";

import { useEffect, useState } from "react";
import { Button, Callout, StatusBadge } from "../../components/ui";
import { OnboardingForm } from "./onboarding-form";
import { normalizeProfileState, sectionSummaries, type InterviewStep, type ProfileFormState } from "./profile-form-model";

export function ProfileEditor() {
  const [form, setForm] = useState<ProfileFormState | null>(null);
  const [selected, setSelected] = useState<InterviewStep | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    queueMicrotask(async () => {
      try {
        const response = await fetch("/api/profile", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Profile request failed");
        const data = await response.json();
        if (cancelled) return;
        setForm(normalizeProfileState(data));
        setError("");
      } catch (caught) {
        if (cancelled || (caught instanceof DOMException && caught.name === "AbortError")) return;
        setError("Could not load your voice profile. Your saved data has not been changed.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => { cancelled = true; controller.abort(); };
  }, [revision]);

  if (selected) return <OnboardingForm
    edit
    initialStep={selected}
    onSavingChange={setSaving}
    onCancel={() => { if (!saving) { setSaving(false); setSelected(null); } }}
    onDone={() => {
      setSaving(false);
      setSelected(null);
      setLoading(true);
      setRevision((value) => value + 1);
    }}
  />;

  if (loading) return <section className="page-container" aria-label="Loading voice profile">
    <div className="mb-8 h-12 w-64 animate-pulse rounded bg-[var(--surface-muted)]" />
    <div className="grid gap-4 md:grid-cols-2">{Array.from({ length: 6 }, (_, index) => <div key={index} className="surface-card h-40 animate-pulse" />)}</div>
  </section>;

  if (error || !form) return <section className="page-container page-container-narrow">
    <Callout tone="danger"><h1 className="text-2xl font-semibold">Could not load your voice profile</h1><p className="mt-2">{error}</p><Button className="mt-4" onClick={() => { setLoading(true); setRevision((value) => value + 1); }}>Try again</Button></Callout>
  </section>;

  return <section className="page-container">
    <header className="page-heading">
      <p className="eyebrow">Voice and profile</p>
      <h1 className="display-heading">Your voice profile</h1>
      <p className="page-intro">Teach Cadence how you think and write. Edit one section at a time—everything else stays untouched.</p>
    </header>
    <div className="grid gap-4 md:grid-cols-2">
      {sectionSummaries(form).map((section) => <article key={section.step} className="surface-card flex min-h-44 flex-col p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-semibold">{section.label}</h2>
          <StatusBadge tone={section.complete ? "success" : "neutral"}>{section.complete ? "Added" : "Optional"}</StatusBadge>
        </div>
        <p className="mt-3 line-clamp-2 text-sm text-[var(--muted)]">{section.summary}</p>
        <div className="mt-auto pt-5">
          <Button variant="secondary" disabled={saving} onClick={() => { setSaving(false); setSelected(section.step); }} aria-label={`Edit ${section.label}`}>Edit</Button>
        </div>
      </article>)}
    </div>
  </section>;
}
