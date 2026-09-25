import { z } from "zod";

const nonblank = z.string().max(10000).refine(value => value.trim().length > 0, "Required");
const text = z.string().max(10000);

export const onboardingInput = z.discriminatedUnion("step", [
  z.object({ step: z.literal(1), name: nonblank, work: nonblank, location: text }),
  z.object({ step: z.literal(2), audience: nonblank, goal: nonblank }),
  z.object({ step: z.literal(3), pillars: z.array(nonblank.max(120)).min(1).max(4) }),
  z.object({ step: z.literal(4), samples: z.array(nonblank).max(5), voiceTraits: z.array(nonblank.max(100)).max(12) }),
  z.object({ step: z.literal(5), rules: z.object({ lengthPreference: text, casing: text, hashtags: text, emoji: text, cta: text, bannedTerms: z.array(nonblank.max(100)).max(30), notes: text }) }),
  z.object({ step: z.literal(6), stories: z.array(z.object({ title: text, details: nonblank, usageNote: text })).max(20) }),
]);

export type OnboardingInput = z.infer<typeof onboardingInput>;
