import { z } from "zod";

export const sourceSchema = z.object({ url: z.url(), title: z.string(), note: z.string() });
export const factSchema = z.object({ text: z.string().min(1), sourceUrl: z.url() });
export const ideaSchema = z.object({ title: z.string().min(1), angle: z.string().min(1), pillar: z.string().min(1), whyNow: z.string(), format: z.enum(["standard","hot-topic","brand-case-study"]), sourceUrls: z.array(z.url()) });
export const ideasOutput = z.object({ ideas: z.array(ideaSchema).min(1).max(8) });
export const researchOutput = z.object({ topic: z.string().min(1), angle: z.string().min(1), facts: z.array(factSchema), sourceUrls: z.array(z.url()) });
export const hooksOutput = z.object({ hooks: z.array(z.object({ type: z.string().min(1), text: z.string().min(1), sourceUrl: z.url().nullable() })).min(3).max(5) });
export const draftOutput = z.object({ text: z.string().min(1), claims: z.array(factSchema), sourceUrls: z.array(z.url()) });
