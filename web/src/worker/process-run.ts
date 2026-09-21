import type { CreationRun, RunStage } from "../server/db/types";
import type { VoiceContext } from "../features/profile/service";
import { getVoiceContext } from "../features/profile/service";
import type { CadenceAi } from "../server/ai/claude";
import type { DraftResult, Hook, RankedIdea, ResearchBrief } from "../server/ai/types";
import { completeRevisionRun, completeRunWithDraft, failRun, pauseRunForChoice, saveRunStage } from "../server/db/jobs";
import { getPool } from "../server/db/client";

type Candidate = RankedIdea & { id: string };
export type ProcessDependencies = {
  ai: Pick<CadenceAi,"researchIdeas"|"researchTopic"|"makeHooks"|"writeDraft"|"editDraft">;
  getVoice(ownerId: string): Promise<VoiceContext>;
  loadSavedIdea(ownerId: string, ideaId?: string, random?: boolean): Promise<Candidate | null>;
  latestDraft(ownerId: string, draftId: string): Promise<DraftResult>;
  save: typeof saveRunStage;
  pause: typeof pauseRunForChoice;
  complete: typeof completeRunWithDraft;
  completeRevision: typeof completeRevisionRun;
  fail: typeof failRun;
};

export function makeProcessDependencies(ai: ProcessDependencies["ai"]): ProcessDependencies {
  return {
    ai, getVoice: getVoiceContext, save: saveRunStage, pause: pauseRunForChoice,
    complete: completeRunWithDraft, completeRevision: completeRevisionRun, fail: failRun,
    async loadSavedIdea(ownerId, ideaId, random) {
      const result = await getPool().query<{ id: string; title: string; angle: string; why_now: string; pillar: string | null }>(
        `select i.id,i.title,i.angle,i.why_now,p.name as pillar from public.ideas i
         left join public.pillars p on p.id=i.pillar_id and p.owner_id=i.owner_id
         where i.owner_id=$1 and i.status='saved' and ($2::uuid is null or i.id=$2)
         order by case when $3::boolean then random() else 0 end limit 1`, [ownerId,ideaId ?? null,!!random]
      );
      const row = result.rows[0];
      if (!row) return null;
      return { id: row.id, title: row.title, angle: row.angle || row.title, pillar: row.pillar ?? "General", whyNow: row.why_now, format: "standard", sourceUrls: [], promptVersion: "saved-idea", model: "user" };
    },
    async latestDraft(ownerId, draftId) {
      const result = await getPool().query<{ text: string; source_refs: string[]; prompt_version: string; model: string }>(
        `select v.text,v.source_refs,v.prompt_version,v.model from public.draft_versions v
         join public.drafts d on d.id=v.draft_id and d.owner_id=v.owner_id
         where d.id=$1 and d.owner_id=$2 order by v.version_no desc limit 1`, [draftId,ownerId]
      );
      const row = result.rows[0];
      if (!row) throw new Error("Draft version not found");
      return { text: row.text, claims: [], sourceUrls: row.source_refs, promptVersion: row.prompt_version, model: row.model };
    },
  };
}

export async function processCreationRun(run: CreationRun, deps: ProcessDependencies): Promise<void> {
  if (run.status !== "running") throw new Error("Run must be leased before processing");
  const stage: RunStage = run.stage;
  try {
    const voice = await deps.getVoice(run.owner_id);
    if (stage === "idea") {
      let ideas: Candidate[] = [];
      if (run.idea_id) {
        const saved = await deps.loadSavedIdea(run.owner_id, run.idea_id);
        if (saved) ideas = [saved];
      } else if (run.entry === "topic") {
        ideas = [{ id: "user-topic", title: run.topic, angle: run.direction || run.topic, pillar: voice.pillars[0] || "General", whyNow: "", format: "standard", sourceUrls: [], promptVersion: "user-topic", model: "user" }];
      } else if (run.entry === "surprise") {
        const saved = await deps.loadSavedIdea(run.owner_id, undefined, true);
        if (saved) ideas = [saved];
      }
      if (!ideas.length) ideas = (await deps.ai.researchIdeas(voice, run.direction)).map((idea,index) => ({ ...idea, id: `idea-${index + 1}` }));
      if (!ideas.length) throw new Error("No suitable ideas found");
      const payload = { ideas, selectionReason: run.entry === "surprise" && ideas[0].model === "user" ? "A saved idea you have not used yet" : "Best fit for your pillars and audience" };
      if (run.mode === "guided" && run.entry !== "topic" && !run.idea_id) await deps.pause(run.id, "idea", payload);
      else await deps.save(run.id, "idea", payload, "research", { idea: ideas[0] });
    } else if (stage === "research") {
      const idea = run.selected_idea as Candidate | null;
      if (!idea) throw new Error("No idea selected");
      const brief = await deps.ai.researchTopic(voice, idea);
      await deps.save(run.id, "research", brief, "hooks");
    } else if (stage === "hooks") {
      const brief = run.stages.research as ResearchBrief | undefined;
      if (!brief) throw new Error("Research stage missing");
      const hooks = await deps.ai.makeHooks(voice, brief);
      if (!hooks.length) throw new Error("No suitable hooks found");
      const payload = { hooks };
      if (run.mode === "guided") await deps.pause(run.id, "hooks", payload);
      else await deps.save(run.id, "hooks", payload, "draft", { hook: hooks[0] });
    } else if (stage === "draft") {
      const brief = run.stages.research as ResearchBrief | undefined;
      const hook = run.selected_hook as Hook | null;
      if (!brief || !hook) throw new Error("Research or selected hook missing");
      const draft = await deps.ai.writeDraft(voice, brief, hook);
      await deps.save(run.id, "draft", draft, "style");
    } else if (stage === "style") {
      const draft = run.stages.draft as DraftResult | undefined;
      if (!draft) throw new Error("Draft stage missing");
      const polished = await deps.ai.editDraft(voice, draft, "Tighten the writing against my voice and rules. Preserve the exact hook, blank line, factual claims and source URLs. Do not add any facts.");
      const selectedHook = (run.selected_hook as Hook | null)?.text;
      if (selectedHook && !polished.text.startsWith(`${selectedHook}\n\n`)) throw new Error("Style pass changed the selected hook");
      await deps.complete(run, polished, polished);
    } else if (stage === "revision") {
      if (!run.draft_id) throw new Error("Revision draft missing");
      const current = await deps.latestDraft(run.owner_id, run.draft_id);
      const revised = await deps.ai.editDraft(voice, current, run.direction);
      await deps.completeRevision(run, revised);
    }
  } catch (error) {
    try { await deps.fail(run.id, stage, error); } catch { /* outer worker retries this idempotent write */ }
    throw error;
  }
}
