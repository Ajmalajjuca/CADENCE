"use client";

import { useState } from "react";
import { Button, Field } from "../../components/ui";
import { AUDIENCE_STARTERS, CASING_OPTIONS, CTA_OPTIONS, FREQUENCY_OPTIONS, GOAL_STARTERS, LENGTH_OPTIONS, VOICE_TRAITS } from "./interview-options";
import type { InterviewStep, ProfileFormState, StoryForm } from "./profile-form-model";

type Update = (update: Partial<ProfileFormState> | ((current: ProfileFormState) => ProfileFormState)) => void;
const inputClass = "input";
const textareaClass = "textarea";

function ChipGroup({ label, options, selected, onSelect, multiple = false }: { label: string; options: readonly string[]; selected: string | string[]; onSelect: (value: string) => void; multiple?: boolean }) {
  return <fieldset>
    <legend className="field-label">{label}</legend>
    <div className="mt-3 flex flex-wrap gap-2">
      {options.map((option) => {
        const pressed = multiple ? (selected as string[]).includes(option) : selected === option;
        return <button key={option} type="button" aria-pressed={pressed} onClick={() => onSelect(option)} className="choice-chip" data-selected={pressed || undefined}>{option}</button>;
      })}
    </div>
  </fieldset>;
}

function Segmented({ legend, options, value, onChange }: { legend: string; options: ReadonlyArray<{ value: string; label: string }>; value: string; onChange: (value: string) => void }) {
  return <fieldset className="field">
    <legend className="field-label">{legend}</legend>
    <div className="mt-3 grid gap-2 sm:grid-cols-3">
      {options.map((option) => <button key={option.value} type="button" aria-pressed={value === option.value} className="choice-chip justify-center text-center" data-selected={value === option.value || undefined} onClick={() => onChange(option.value)}>{option.label}</button>)}
    </div>
  </fieldset>;
}

function AboutStep({ form, update }: { form: ProfileFormState; update: Update }) {
  return <>
    <header><h1 className="page-title">What should we call you?</h1><p className="page-intro">A little context helps Cadence write from your point of view.</p></header>
    <Field label="Name" htmlFor="profile-name"><input id="profile-name" className={inputClass} value={form.name} onChange={(event) => update({ name: event.target.value })} autoComplete="name" /></Field>
    <Field label="Work" htmlFor="profile-work" hint="For example: founder, product designer, or engineering leader."><input id="profile-work" className={inputClass} value={form.work} onChange={(event) => update({ work: event.target.value })} /></Field>
    <Field label="Location (optional)" htmlFor="profile-location"><input id="profile-location" className={inputClass} value={form.location} onChange={(event) => update({ location: event.target.value })} autoComplete="address-level2" /></Field>
  </>;
}

function AudienceStep({ form, update }: { form: ProfileFormState; update: Update }) {
  return <>
    <header><h1 className="page-title">Who do you want your posts to reach?</h1><p className="page-intro">Choose a starting point or describe the exact people you want to help.</p></header>
    <ChipGroup label="Audience starters" options={AUDIENCE_STARTERS} selected={form.audience} onSelect={(audience) => update({ audience })} />
    <Field label="Audience" htmlFor="profile-audience" hint="You can make this as specific as you like."><input id="profile-audience" className={inputClass} value={form.audience} onChange={(event) => update({ audience: event.target.value })} /></Field>
    <ChipGroup label="What should your posts achieve?" options={GOAL_STARTERS} selected={form.goal} onSelect={(goal) => update({ goal })} />
    <Field label="Goal" htmlFor="profile-goal"><textarea id="profile-goal" className={textareaClass} rows={3} value={form.goal} onChange={(event) => update({ goal: event.target.value })} /></Field>
  </>;
}

function TopicsStep({ form, update }: { form: ProfileFormState; update: Update }) {
  const [topic, setTopic] = useState("");
  function addTopic() {
    const next = topic.trim();
    if (!next || form.pillars.length >= 4) return;
    update({ pillars: [...form.pillars, next] });
    setTopic("");
  }
  function move(index: number, offset: number) {
    const target = index + offset;
    if (target < 0 || target >= form.pillars.length) return;
    const pillars = [...form.pillars];
    [pillars[index], pillars[target]] = [pillars[target], pillars[index]];
    update({ pillars });
  }
  return <>
    <header><h1 className="page-title">What topics do you want to be known for?</h1><p className="page-intro">Add up to four. The first topic is your primary theme.</p></header>
    <ol className="space-y-3" aria-label="Content topics">
      {form.pillars.map((pillar, index) => <li key={`${pillar}-${index}`} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] p-3">
        <span className="min-w-0 flex-1 font-semibold"><span className="mr-2 text-[var(--muted)]">{index + 1}.</span>{pillar}</span>
        <Button variant="quiet" className="min-h-9 px-3" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${pillar} up`}>↑</Button>
        <Button variant="quiet" className="min-h-9 px-3" disabled={index === form.pillars.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${pillar} down`}>↓</Button>
        <Button variant="quiet" className="min-h-9 px-3" onClick={() => update({ pillars: form.pillars.filter((_, itemIndex) => itemIndex !== index) })} aria-label={`Remove ${pillar}`}>Remove</Button>
      </li>)}
    </ol>
    <Field label="Add a content topic" htmlFor="new-topic" hint={`${form.pillars.length} of 4 topics added`}>
      <div className="flex flex-col gap-2 sm:flex-row"><input id="new-topic" className={inputClass} value={topic} onChange={(event) => setTopic(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTopic(); } }} /><Button variant="secondary" disabled={!topic.trim() || form.pillars.length >= 4} onClick={addTopic}>Add topic</Button></div>
    </Field>
  </>;
}

function VoiceStep({ form, update }: { form: ProfileFormState; update: Update }) {
  const [customTrait, setCustomTrait] = useState("");
  function toggleTrait(trait: string) { update({ voiceTraits: form.voiceTraits.includes(trait) ? form.voiceTraits.filter((item) => item !== trait) : [...form.voiceTraits, trait] }); }
  function addTrait() {
    const trait = customTrait.trim();
    if (!trait || form.voiceTraits.includes(trait) || form.voiceTraits.length >= 12) return;
    update({ voiceTraits: [...form.voiceTraits, trait] });
    setCustomTrait("");
  }
  return <>
    <header><h1 className="page-title">What does your natural writing sound like?</h1><p className="page-intro">Paste something you wrote yourself, then choose a few traits. You can skip this and add samples later.</p></header>
    <div className="space-y-4">{form.samples.map((sample, index) => <Field key={index} label={`Writing sample ${index + 1}`} htmlFor={`writing-sample-${index + 1}`}><textarea id={`writing-sample-${index + 1}`} className={textareaClass} rows={5} value={sample} onChange={(event) => update({ samples: form.samples.map((value, sampleIndex) => sampleIndex === index ? event.target.value : value) })} /></Field>)}<Button variant="secondary" disabled={form.samples.length >= 5} onClick={() => update({ samples: [...form.samples, ""] })}>Add another sample</Button></div>
    <ChipGroup label="Voice traits" options={VOICE_TRAITS} selected={form.voiceTraits} onSelect={toggleTrait} multiple />
    <Field label="Add your own voice trait" htmlFor="custom-voice-trait"><div className="flex flex-col gap-2 sm:flex-row"><input id="custom-voice-trait" className={inputClass} value={customTrait} onChange={(event) => setCustomTrait(event.target.value)} /><Button variant="secondary" disabled={!customTrait.trim()} onClick={addTrait}>Add trait</Button></div></Field>
  </>;
}

function PreferencesStep({ form, update }: { form: ProfileFormState; update: Update }) {
  return <>
    <header><h1 className="page-title">How should Cadence shape each post?</h1><p className="page-intro">These are useful defaults, not rigid rules. Every choice can be changed later.</p></header>
    <Segmented legend="Post length" options={LENGTH_OPTIONS} value={form.lengthPreference} onChange={(lengthPreference) => update({ lengthPreference })} />
    <Segmented legend="Capitalization" options={CASING_OPTIONS} value={form.casing} onChange={(casing) => update({ casing })} />
    <Segmented legend="Hashtags" options={FREQUENCY_OPTIONS} value={form.hashtags} onChange={(hashtags) => update({ hashtags })} />
    <Segmented legend="Emojis" options={FREQUENCY_OPTIONS} value={form.emoji} onChange={(emoji) => update({ emoji })} />
    <Segmented legend="Ending style" options={CTA_OPTIONS} value={form.cta} onChange={(cta) => update({ cta })} />
    <Field label="Words or phrases to avoid" htmlFor="banned-terms" hint="One per line."><textarea id="banned-terms" className={textareaClass} rows={3} value={form.bannedTerms.join("\n")} onChange={(event) => update({ bannedTerms: event.target.value.split("\n") })} /></Field>
    <Field label="Anything else Cadence should follow?" htmlFor="profile-notes"><textarea id="profile-notes" className={textareaClass} rows={4} value={form.notes} onChange={(event) => update({ notes: event.target.value })} /></Field>
  </>;
}

function StoriesStep({ form, update }: { form: ProfileFormState; update: Update }) {
  function updateStory(index: number, patch: Partial<StoryForm>) { update({ stories: form.stories.map((story, storyIndex) => storyIndex === index ? { ...story, ...patch } : story) }); }
  return <>
    <header><h1 className="page-title">Which real experiences may Cadence draw from?</h1><p className="page-intro">Cadence may use only the details you add here. It will never invent personal experiences.</p></header>
    <div className="space-y-4">{form.stories.map((story, index) => <section key={index} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-5" aria-labelledby={`story-${index + 1}-heading`}>
      <div className="mb-4 flex items-center justify-between gap-3"><h2 id={`story-${index + 1}-heading`} className="text-xl font-semibold">Real story {index + 1}</h2><Button variant="quiet" className="min-h-9" onClick={() => update({ stories: form.stories.filter((_, storyIndex) => storyIndex !== index) })}>Remove</Button></div>
      <div className="space-y-4"><Field label={`Story ${index + 1} title`} htmlFor={`story-${index + 1}-title`}><input id={`story-${index + 1}-title`} className={inputClass} value={story.title} onChange={(event) => updateStory(index, { title: event.target.value })} /></Field><Field label={`Story ${index + 1} details`} htmlFor={`story-${index + 1}-details`} hint="Include only facts you are comfortable using in a post."><textarea id={`story-${index + 1}-details`} className={textareaClass} rows={5} value={story.details} onChange={(event) => updateStory(index, { details: event.target.value })} /></Field><Field label={`Story ${index + 1} usage note`} htmlFor={`story-${index + 1}-usage`} hint="For example: use when writing about leadership lessons."><input id={`story-${index + 1}-usage`} className={inputClass} value={story.usageNote} onChange={(event) => updateStory(index, { usageNote: event.target.value })} /></Field></div>
    </section>)}</div>
    <Button variant="secondary" disabled={form.stories.length >= 20} onClick={() => update({ stories: [...form.stories, { title: "", details: "", usageNote: "" }] })}>Add a story</Button>
  </>;
}

export function InterviewStepPanel({ step, form, update }: { step: InterviewStep; form: ProfileFormState; update: Update }) {
  if (step === 1) return <AboutStep form={form} update={update} />;
  if (step === 2) return <AudienceStep form={form} update={update} />;
  if (step === 3) return <TopicsStep form={form} update={update} />;
  if (step === 4) return <VoiceStep form={form} update={update} />;
  if (step === 5) return <PreferencesStep form={form} update={update} />;
  return <StoriesStep form={form} update={update} />;
}
