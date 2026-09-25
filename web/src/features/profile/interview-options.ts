import type { InterviewStep } from "./profile-form-model";

export const INTERVIEW_SECTIONS: ReadonlyArray<{
  step: InterviewStep;
  label: string;
  optional: boolean;
}> = [
  { step: 1, label: "About you", optional: false },
  { step: 2, label: "Audience and goal", optional: false },
  { step: 3, label: "Content topics", optional: false },
  { step: 4, label: "Writing voice", optional: true },
  { step: 5, label: "Content preferences", optional: true },
  { step: 6, label: "Real stories", optional: true },
];

export const AUDIENCE_STARTERS = ["Founders", "Product leaders", "Engineering leaders", "Creators"] as const;
export const GOAL_STARTERS = ["Build trust", "Grow my network", "Share what I learn", "Create opportunities"] as const;
export const VOICE_TRAITS = ["Direct", "Warm", "Practical", "Thoughtful", "Playful", "Contrarian"] as const;

export const LENGTH_OPTIONS = [
  { value: "short", label: "Short and sharp" },
  { value: "medium", label: "Balanced" },
  { value: "long", label: "Deep dive" },
] as const;

export const CASING_OPTIONS = [
  { value: "sentence", label: "Sentence case" },
  { value: "title", label: "Title Case" },
  { value: "lower", label: "lowercase" },
] as const;

export const FREQUENCY_OPTIONS = [
  { value: "none", label: "None" },
  { value: "few", label: "A few" },
  { value: "several", label: "Several" },
] as const;

export const CTA_OPTIONS = [
  { value: "question", label: "A thoughtful question" },
  { value: "reflection", label: "A closing reflection" },
  { value: "action", label: "A clear next step" },
  { value: "none", label: "No fixed ending" },
] as const;
