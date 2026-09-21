import type { z } from "zod";
import { factSchema, ideaSchema, sourceSchema } from "./schemas";

export type ResearchSource = z.infer<typeof sourceSchema>;
export type Fact = z.infer<typeof factSchema>;
export type RankedIdea = z.infer<typeof ideaSchema> & { promptVersion: string; model: string };
export type ResearchBrief = { topic: string; angle: string; facts: Fact[]; sources: ResearchSource[]; promptVersion: string; model: string };
export type Hook = { id: string; type: string; text: string; sourceUrl: string | null; promptVersion: string; model: string };
export type DraftResult = { text: string; claims: Fact[]; sourceUrls: string[]; promptVersion: string; model: string };

export function validateClaims(draft: Pick<DraftResult,"claims"|"sourceUrls">, brief: Pick<ResearchBrief,"sources">): void {
  const known = new Set(brief.sources.map(source => source.url));
  for (const claim of draft.claims) if (!known.has(claim.sourceUrl)) throw new Error(`Unknown source: ${claim.sourceUrl}`);
  for (const url of draft.sourceUrls) if (!known.has(url)) throw new Error(`Unknown source: ${url}`);
}
