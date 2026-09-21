import { z } from "zod";
import { getPool, withTransaction } from "../db/client";
import { enqueueCreationRun } from "../db/jobs";
import type { CreationRun } from "../db/types";
import { HttpError } from "../auth/http-error";
import { getValidAiSettingsSnapshot, withOwnerAiSettingsLock } from "../../features/settings/ai-settings";

export const creationInput = z.object({
  mode: z.enum(["quick","guided"]), entry: z.enum(["topic","find","surprise"]),
  topic: z.string().max(600).optional(), ideaId: z.uuid().optional(), direction: z.string().max(1000).optional(),
}).refine(value => value.entry !== "topic" || !!value.topic?.trim() || !!value.ideaId, { message: "Enter a topic", path: ["topic"] });

export async function startCreationRun(ownerId: string, raw: unknown): Promise<CreationRun> {
  const input = creationInput.parse(raw);
  const pool = getPool();
  const profile = await pool.query<{ onboarding_complete: boolean }>("select onboarding_complete from public.profiles where user_id=$1", [ownerId]);
  if (!profile.rows[0]?.onboarding_complete) throw new HttpError(409, "Finish your voice profile first");
  if (input.ideaId) {
    const idea = await pool.query("select 1 from public.ideas where id=$1 and owner_id=$2", [input.ideaId,ownerId]);
    if (!idea.rowCount) throw new HttpError(404, "Idea not found");
  }
  const limit = Math.max(1, Number(process.env.CADENCE_DAILY_RUN_LIMIT || 10));
  const count = await pool.query<{ count: string }>("select count(*)::text as count from public.creation_runs where owner_id=$1 and created_at >= date_trunc('day',now())", [ownerId]);
  if (Number(count.rows[0].count) >= limit) throw new HttpError(429, "Daily creation limit reached. Try again tomorrow.");
  return withOwnerAiSettingsLock(ownerId, async client => {
    const aiSettings = await getValidAiSettingsSnapshot(ownerId, client);
    return enqueueCreationRun(ownerId, { ...input, topic: input.topic?.trim() }, aiSettings, client);
  });
}

export async function getRun(ownerId: string, runId: string): Promise<CreationRun> {
  const result = await getPool().query<CreationRun>("select * from public.creation_runs where id=$1 and owner_id=$2", [runId,ownerId]);
  if (!result.rows[0]) throw new HttpError(404, "Creation run not found");
  return result.rows[0];
}

export async function chooseRunIdea(ownerId: string, runId: string, ideaId: string): Promise<CreationRun> {
  return withTransaction(async client => {
    const result = await client.query<CreationRun>("select * from public.creation_runs where id=$1 and owner_id=$2 for update", [runId,ownerId]);
    const run = result.rows[0];
    if (!run) throw new HttpError(404, "Creation run not found");
    if (run.status !== "waiting_for_user" || run.stage !== "idea") throw new HttpError(409, "Idea selection is not available");
    const choices = (run.stages.idea as { ideas?: Array<{ id: string }> } | undefined)?.ideas ?? [];
    const chosen = choices.find(idea => idea.id === ideaId);
    if (!chosen) throw new HttpError(400, "Choose an idea from this run");
    const updated = await client.query<CreationRun>("update public.creation_runs set selected_idea=$3,stage='research',status='queued',updated_at=now() where id=$1 and owner_id=$2 returning *", [runId,ownerId,JSON.stringify(chosen)]);
    return updated.rows[0];
  });
}

export async function chooseRunHook(ownerId: string, runId: string, hookId: string): Promise<CreationRun> {
  return withTransaction(async client => {
    const result = await client.query<CreationRun>("select * from public.creation_runs where id=$1 and owner_id=$2 for update", [runId,ownerId]);
    const run = result.rows[0];
    if (!run) throw new HttpError(404, "Creation run not found");
    if (run.status !== "waiting_for_user" || run.stage !== "hooks") throw new HttpError(409, "Hook selection is not available");
    const choices = (run.stages.hooks as { hooks?: Array<{ id: string }> } | undefined)?.hooks ?? [];
    const chosen = choices.find(hook => hook.id === hookId);
    if (!chosen) throw new HttpError(400, "Choose a hook from this run");
    const updated = await client.query<CreationRun>("update public.creation_runs set selected_hook=$3,stage='draft',status='queued',updated_at=now() where id=$1 and owner_id=$2 returning *", [runId,ownerId,JSON.stringify(chosen)]);
    return updated.rows[0];
  });
}

export async function retryRun(ownerId: string, runId: string): Promise<CreationRun> {
  const run = await getRun(ownerId, runId);
  if (!run.research_model || !run.writing_model || !run.ai_settings_revision) {
    throw new HttpError(409, "Configure Claude and start a new run", "AI_SETTINGS_REQUIRED");
  }
  const result = await getPool().query<CreationRun>(
    `update public.creation_runs set status='queued',error_code=null,error_message=null,updated_at=now()
     where id=$1 and owner_id=$2 and status='failed' and attempts < 5 returning *`, [runId,ownerId]
  );
  if (!result.rows[0]) throw new HttpError(409, "Run cannot be retried");
  return result.rows[0];
}

export async function startRevisionRun(ownerId: string, draftId: string, direction: string): Promise<CreationRun> {
  if (!direction.trim()) throw new HttpError(400, "Describe the revision you want");
  const owned = await getPool().query("select 1 from public.drafts where id=$1 and owner_id=$2", [draftId,ownerId]);
  if (!owned.rowCount) throw new HttpError(404, "Draft not found");
  return withOwnerAiSettingsLock(ownerId, async client => {
    const aiSettings = await getValidAiSettingsSnapshot(ownerId, client);
    return enqueueCreationRun(ownerId, { kind: "revision", mode: "quick", entry: "revision", draftId, direction }, aiSettings, client);
  });
}
