import type { OnboardingInput } from "./schema";
import { INTERVIEW_SECTIONS } from "./interview-options";

export type InterviewStep = 1 | 2 | 3 | 4 | 5 | 6;
export type StoryForm = { title: string; details: string; usageNote: string };

export type ProfileFormState = {
  name: string;
  work: string;
  location: string;
  audience: string;
  goal: string;
  pillars: string[];
  samples: string[];
  voiceTraits: string[];
  lengthPreference: string;
  casing: string;
  hashtags: string;
  emoji: string;
  cta: string;
  bannedTerms: string[];
  notes: string;
  stories: StoryForm[];
};

export type SectionSummary = {
  step: InterviewStep;
  label: string;
  summary: string;
  complete: boolean;
};

export const emptyProfileForm: ProfileFormState = {
  name: "",
  work: "",
  location: "",
  audience: "",
  goal: "",
  pillars: [],
  samples: [""],
  voiceTraits: [],
  lengthPreference: "",
  casing: "",
  hashtags: "",
  emoji: "",
  cta: "",
  bannedTerms: [],
  notes: "",
  stories: [{ title: "", details: "", usageNote: "" }],
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function normalizeProfileState(raw: unknown): ProfileFormState {
  const data = record(raw);
  const profile = record(data.profile);
  const rules = record(data.rules);
  const samples = records(data.samples).map((item) => string(item.text));
  const stories = records(data.stories).map((item) => ({
    title: string(item.title),
    details: string(item.details),
    usageNote: string(item.usage_note ?? item.usageNote),
  }));

  return {
    name: string(profile.name),
    work: string(profile.work),
    location: string(profile.location),
    audience: string(profile.audience),
    goal: string(profile.goal),
    pillars: records(data.pillars).map((item) => string(item.name)).filter(Boolean),
    samples: samples.length ? samples : [""],
    voiceTraits: strings(profile.voice_traits),
    lengthPreference: string(rules.length_preference),
    casing: string(rules.casing),
    hashtags: string(rules.hashtags),
    emoji: string(rules.emoji),
    cta: string(rules.cta),
    bannedTerms: strings(rules.banned_terms),
    notes: string(rules.notes),
    stories: stories.length ? stories : [{ title: "", details: "", usageNote: "" }],
  };
}

function cleanLabels(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

export function payloadForStep(form: ProfileFormState, step: InterviewStep): OnboardingInput {
  if (step === 1) return { step, name: form.name, work: form.work, location: form.location };
  if (step === 2) return { step, audience: form.audience, goal: form.goal };
  if (step === 3) {
    const pillars = cleanLabels(form.pillars);
    if (pillars.length > 4) throw new Error("Choose no more than four content topics.");
    return { step, pillars };
  }
  if (step === 4) {
    return {
      step,
      samples: form.samples.filter((sample) => sample.trim().length > 0),
      voiceTraits: cleanLabels(form.voiceTraits),
    };
  }
  if (step === 5) {
    return {
      step,
      rules: {
        lengthPreference: form.lengthPreference,
        casing: form.casing,
        hashtags: form.hashtags,
        emoji: form.emoji,
        cta: form.cta,
        bannedTerms: cleanLabels(form.bannedTerms),
        notes: form.notes,
      },
    };
  }
  return {
    step,
    stories: form.stories
      .filter((story) => story.details.trim().length > 0)
      .map((story) => ({ ...story })),
  };
}

export function clearOptionalSection(form: ProfileFormState, step: InterviewStep): ProfileFormState {
  if (step === 4) return { ...form, samples: [""], voiceTraits: [] };
  if (step === 5) {
    return {
      ...form,
      lengthPreference: "",
      casing: "",
      hashtags: "",
      emoji: "",
      cta: "",
      bannedTerms: [],
      notes: "",
    };
  }
  if (step === 6) return { ...form, stories: [{ title: "", details: "", usageNote: "" }] };
  throw new Error("Required interview sections cannot be skipped.");
}

export function firstIncompleteStep(raw: unknown): InterviewStep {
  const data = record(raw);
  const profile = record(data.profile);
  if (typeof profile.onboarding_step === "number") {
    return Math.max(1, Math.min(6, profile.onboarding_step + 1)) as InterviewStep;
  }
  const form = normalizeProfileState(raw);
  if (!form.name.trim() || !form.work.trim()) return 1;
  if (!form.audience.trim() || !form.goal.trim()) return 2;
  if (form.pillars.length === 0) return 3;
  return 4;
}

function countSummary(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function sectionSummaries(form: ProfileFormState): SectionSummary[] {
  const preferenceCount = [form.lengthPreference, form.casing, form.hashtags, form.emoji, form.cta, form.notes]
    .filter((value) => value.trim()).length + cleanLabels(form.bannedTerms).length;
  const sampleCount = form.samples.filter((sample) => sample.trim()).length;
  const storyCount = form.stories.filter((story) => story.details.trim()).length;
  const summaries = [
    { summary: [form.name, form.work].filter((value) => value.trim()).join(" · "), complete: Boolean(form.name.trim() && form.work.trim()) },
    { summary: [form.audience, form.goal].filter((value) => value.trim()).join(" · "), complete: Boolean(form.audience.trim() && form.goal.trim()) },
    { summary: form.pillars.length ? countSummary(form.pillars.length, "content topic", "content topics") : "", complete: form.pillars.length > 0 },
    {
      summary: sampleCount || form.voiceTraits.length
        ? [sampleCount ? countSummary(sampleCount, "sample", "samples") : "", form.voiceTraits.length ? countSummary(form.voiceTraits.length, "voice trait", "voice traits") : ""].filter(Boolean).join(" · ")
        : "",
      complete: sampleCount > 0 || form.voiceTraits.length > 0,
    },
    { summary: preferenceCount ? countSummary(preferenceCount, "preference", "preferences") : "", complete: preferenceCount > 0 },
    { summary: storyCount ? countSummary(storyCount, "real story", "real stories") : "", complete: storyCount > 0 },
  ];

  return INTERVIEW_SECTIONS.map((section, index) => ({
    step: section.step,
    label: section.label,
    summary: summaries[index].summary || "Not added yet",
    complete: summaries[index].complete,
  }));
}
