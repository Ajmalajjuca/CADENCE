"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Story = { title: string; details: string; usageNote: string };
type FormState = {
  name: string; work: string; location: string; audience: string; goal: string;
  pillars: string; samples: string[]; voiceTraits: string;
  lengthPreference: string; casing: string; hashtags: string; emoji: string; cta: string; bannedTerms: string; notes: string;
  stories: Story[];
};
const empty: FormState = {
  name: "", work: "", location: "", audience: "", goal: "", pillars: "", samples: [""], voiceTraits: "",
  lengthPreference: "", casing: "", hashtags: "", emoji: "", cta: "", bannedTerms: "", notes: "", stories: [{ title: "", details: "", usageNote: "" }],
};
const labels = ["Your work", "Audience and goal", "Content pillars", "Your voice", "Content rules", "Real stories"];

export function OnboardingForm({ edit = false }: { edit?: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(empty);
  const [step, setStep] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/profile").then(response => response.json()).then(data => {
      const profile = data.profile ?? {};
      const rules = data.rules ?? {};
      setForm({
        name: profile.name ?? "", work: profile.work ?? "", location: profile.location ?? "", audience: profile.audience ?? "", goal: profile.goal ?? "",
        pillars: (data.pillars ?? []).map((item: { name: string }) => item.name).join("\n"),
        samples: (data.samples ?? []).length ? data.samples.map((item: { text: string }) => item.text) : [""],
        voiceTraits: (profile.voice_traits ?? []).join("\n"),
        lengthPreference: rules.length_preference ?? "", casing: rules.casing ?? "", hashtags: rules.hashtags ?? "", emoji: rules.emoji ?? "", cta: rules.cta ?? "",
        bannedTerms: (rules.banned_terms ?? []).join("\n"), notes: rules.notes ?? "",
        stories: (data.stories ?? []).length ? data.stories.map((item: { title: string; details: string; usage_note: string }) => ({ title: item.title, details: item.details, usageNote: item.usage_note })) : [{ title: "", details: "", usageNote: "" }],
      });
      setStep(edit ? 1 : Math.min(6, (profile.onboarding_step ?? 0) + 1));
      setLoaded(true);
    }).catch(() => { setMessage("Could not load your saved answers. Try reloading."); setLoaded(true); });
  }, [edit]);

  function change(name: keyof FormState, value: string) { setForm(current => ({ ...current, [name]: value })); }
  function lines(value: string) { return value.split("\n").map(item => item.trim()).filter(Boolean); }
  function inputForStep() {
    if (step === 1) return { step, name: form.name, work: form.work, location: form.location };
    if (step === 2) return { step, audience: form.audience, goal: form.goal };
    if (step === 3) return { step, pillars: lines(form.pillars) };
    if (step === 4) return { step, samples: form.samples.filter(sample => sample.trim()), voiceTraits: lines(form.voiceTraits) };
    if (step === 5) return { step, rules: { lengthPreference: form.lengthPreference, casing: form.casing, hashtags: form.hashtags, emoji: form.emoji, cta: form.cta, bannedTerms: lines(form.bannedTerms), notes: form.notes } };
    return { step: 6, stories: form.stories.filter(story => story.details.trim()) };
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/profile", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(inputForStep()) });
      if (!response.ok) throw new Error();
      setMessage("Saved. You can return to this interview at any time.");
      if (!edit && step < 6) setStep(step + 1);
      if (!edit && step === 6) router.push("/create");
    } catch { setMessage("Could not save this step. Check the fields and try again."); }
    finally { setSaving(false); }
  }

  const field = (name: keyof FormState, label: string, required = false) => <label className="block space-y-2" key={name}>
    <span className="block font-medium">{label}</span>
    <input required={required} value={String(form[name])} onChange={event => change(name, event.target.value)} className="w-full rounded-lg border p-3" />
  </label>;
  const area = (name: keyof FormState, label: string, hint?: string) => <label className="block space-y-2" key={name}>
    <span className="block font-medium">{label}</span>{hint && <span className="block text-sm text-slate-600">{hint}</span>}
    <textarea value={String(form[name])} onChange={event => change(name, event.target.value)} rows={4} className="w-full rounded-lg border p-3" />
  </label>;

  if (!loaded) return <p role="status">Loading your saved answers…</p>;
  return <div className="mx-auto max-w-2xl px-6 py-12">
    <p className="text-sm text-slate-600">Step {step} of 6</p>
    <h1 className="mt-2 text-3xl font-semibold">{edit ? "Edit your voice and profile" : "Get to know you"}</h1>
    <nav aria-label="Interview steps" className="my-7 flex flex-wrap gap-2">{labels.map((label, index) => <button key={label} type="button" onClick={() => setStep(index + 1)} aria-current={step === index + 1 ? "step" : undefined} className={`rounded-full px-3 py-2 text-sm ${step === index + 1 ? "bg-slate-900 text-white" : "bg-slate-100"}`}>{index + 1}. {label}</button>)}</nav>
    <form onSubmit={save} className="space-y-5">
      {step === 1 && <>{field("name", "What should we call you?", true)}{field("work", "What do you do?", true)}{field("location", "Where are you based? (optional)")}</>}
      {step === 2 && <>{area("audience", "Who do you want to reach?", "Example: startup founders or product managers")}{area("goal", "What should your posts help you achieve?")}</>}
      {step === 3 && area("pillars", "What topics do you want to be known for?", "One topic per line, up to four")}
      {step === 4 && <>{form.samples.map((sample, index) => <label key={index} className="block space-y-2"><span className="block font-medium">Writing sample {index + 1}</span><textarea value={sample} onChange={event => setForm(current => ({ ...current, samples: current.samples.map((value, i) => i === index ? event.target.value : value) }))} rows={6} className="w-full rounded-lg border p-3" /></label>)}<button type="button" onClick={() => setForm(current => ({ ...current, samples: [...current.samples, ""] }))} disabled={form.samples.length >= 5} className="rounded-lg border px-4 py-2">Add another sample</button>{area("voiceTraits", "How should your writing sound?", "Optional. One trait per line; you can edit these later.")}</>}
      {step === 5 && <>{field("lengthPreference", "Preferred post length")}{field("casing", "Capitalization style")}{field("hashtags", "Hashtag preference")}{field("emoji", "Emoji preference")}{field("cta", "How do you like to end posts?")}{area("bannedTerms", "Words or phrases to avoid", "One per line")}{area("notes", "Anything else Cadence should always follow?")}</>}
      {step === 6 && <>{form.stories.map((story, index) => <div key={index} className="space-y-3 rounded-xl border p-4"><h2 className="font-medium">Real story {index + 1}</h2><input aria-label={`Story ${index + 1} title`} placeholder="Short title" value={story.title} onChange={event => setForm(current => ({ ...current, stories: current.stories.map((item, i) => i === index ? { ...item, title: event.target.value } : item) }))} className="w-full rounded-lg border p-3" /><textarea aria-label={`Story ${index + 1} details`} placeholder="What really happened? Include only details you want used." value={story.details} onChange={event => setForm(current => ({ ...current, stories: current.stories.map((item, i) => i === index ? { ...item, details: event.target.value } : item) }))} rows={5} className="w-full rounded-lg border p-3" /></div>)}<button type="button" onClick={() => setForm(current => ({ ...current, stories: [...current.stories, { title: "", details: "", usageNote: "" }] }))} disabled={form.stories.length >= 20} className="rounded-lg border px-4 py-2">Add a story</button><p className="text-sm text-slate-600">You can skip stories. Cadence will write opinion posts without inventing personal experiences.</p></>}
      <div className="flex items-center gap-3 pt-3"><button disabled={saving} className="rounded-lg bg-slate-900 px-5 py-3 text-white disabled:opacity-50">{saving ? "Saving…" : edit ? "Save this section" : step === 6 ? "Finish setup" : "Save and continue"}</button>{step > 1 && <button type="button" onClick={() => setStep(step - 1)} className="rounded-lg border px-5 py-3">Back</button>}</div>
      <p role="status">{message}</p>
    </form>
  </div>;
}
