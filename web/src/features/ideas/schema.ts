import { z } from "zod";

export const ideaInput = z.object({
  title: z.string().trim().min(1).max(240),
  angle: z.string().max(2000).default(""),
  pillarId: z.uuid().nullable().optional(),
  whyNow: z.string().max(2000).default(""),
});
export const ideaStatus = z.enum(["saved", "in_progress", "used", "discarded"]);
export type IdeaStatus = z.infer<typeof ideaStatus>;
