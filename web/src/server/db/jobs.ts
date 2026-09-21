import { getPool, withTransaction } from "./client";
import type { CreationRun, RunStage } from "./types";
import { AiServiceError } from "../ai/provider-errors";
import { HttpError } from "../auth/http-error";
import type pg from "pg";

export type EnqueueInput = {
  mode: "quick" | "guided";
  entry: "topic" | "find" | "surprise" | "revision";
  topic?: string;
  direction?: string;
  ideaId?: string;
  draftId?: string;
  kind?: "post" | "revision";
};

export type AiSettingsSnapshot = { researchModel: string; writingModel: string; revision: number };

export async function enqueueCreationRun(ownerId: string, input: EnqueueInput, aiSettings: AiSettingsSnapshot, database: Pick<pg.Pool | pg.PoolClient, "query"> = getPool()): Promise<CreationRun> {
  const result = await database.query<CreationRun>(
    `insert into public.creation_runs
     (owner_id,kind,mode,entry,topic,direction,idea_id,draft_id,stage,research_model,writing_model,ai_settings_revision)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
    [ownerId,input.kind ?? "post",input.mode,input.entry,input.topic ?? "",input.direction ?? "",input.ideaId ?? null,input.draftId ?? null,input.kind === "revision" ? "revision" : "idea",aiSettings.researchModel,aiSettings.writingModel,aiSettings.revision]
  );
  return result.rows[0];
}

export async function claimNextRun(workerId: string): Promise<CreationRun | null> {
  const result = await getPool().query<CreationRun>("select * from public.claim_creation_run_v2($1)", [workerId]);
  return result.rows[0] ?? null;
}

export function nextStage(stage: RunStage, stages: Record<string, unknown>) {
  return { stage, stages };
}

export function toRunFailure(error: unknown): { code: string; message: string } {
  if (error instanceof AiServiceError) return { code: error.code, message: error.message };
  if (error instanceof HttpError && error.code === "AI_MODEL_NOT_ALLOWED") return { code: error.code, message: error.message };
  return { code: "GENERATION_FAILED", message: "Generation failed. Try again." };
}

export async function saveRunStage(runId: string, stage: RunStage, payload: unknown, next: RunStage, selection?: { idea?: unknown; hook?: unknown }): Promise<CreationRun> {
  const result = await getPool().query<CreationRun>(
    `update public.creation_runs set stages = stages || jsonb_build_object($2::text,$3::jsonb),
       stage=$4, status=case when $4='ready' then 'complete' else 'queued' end,
       selected_idea=coalesce($5::jsonb,selected_idea),selected_hook=coalesce($6::jsonb,selected_hook),
       lease_owner=null, lease_until=null, attempts=0, updated_at=now()
     where id=$1 and status='running' returning *`,
    [runId,stage,JSON.stringify(payload),next,selection?.idea ? JSON.stringify(selection.idea) : null,selection?.hook ? JSON.stringify(selection.hook) : null]
  );
  if (!result.rows[0]) throw new Error("Run is not actively leased");
  return result.rows[0];
}

export async function completeRunWithDraft(run: CreationRun, result: { text: string; sourceUrls: string[]; promptVersion: string; model: string }, stagePayload: unknown): Promise<string> {
  return withTransaction(async client => {
    const locked = await client.query<CreationRun>("select * from public.creation_runs where id=$1 for update", [run.id]);
    const current = locked.rows[0];
    if (current.draft_id && current.status === "complete") return current.draft_id;
    if (current.status !== "running" || current.stage !== "style") throw new Error("Run is not ready to complete");
    const selected = current.selected_idea as { title?: string; pillar?: string } | null;
    const pillar = selected?.pillar ? await client.query<{ id: string }>("select id from public.pillars where owner_id=$1 and name=$2 limit 1", [current.owner_id,selected.pillar]) : null;
    const draft = await client.query<{ id: string }>(
      "insert into public.drafts(owner_id,idea_id,creation_run_id,title,pillar_id) values($1,$2,$3,$4,$5) returning id",
      [current.owner_id,current.idea_id,current.id,selected?.title ?? current.topic,pillar?.rows[0]?.id ?? null]
    );
    await client.query(
      "insert into public.draft_versions(owner_id,draft_id,version_no,text,hook,source_refs,prompt_version,model) values($1,$2,1,$3,$4,$5,$6,$7)",
      [current.owner_id,draft.rows[0].id,result.text,(current.selected_hook as { text?: string } | null)?.text ?? "",JSON.stringify(result.sourceUrls),result.promptVersion,result.model]
    );
    await client.query(
      `update public.creation_runs set stages=stages || jsonb_build_object('style',$2::jsonb),
       draft_id=$3,stage='ready',status='complete',lease_owner=null,lease_until=null,updated_at=now() where id=$1`,
      [current.id,JSON.stringify(stagePayload),draft.rows[0].id]
    );
    await client.query("insert into public.activity_events(owner_id,event_type,related_id) values($1,'draft.created',$2)", [current.owner_id,draft.rows[0].id]);
    return draft.rows[0].id;
  });
}

export async function completeRevisionRun(run: CreationRun, result: { text: string; sourceUrls: string[]; promptVersion: string; model: string }): Promise<string> {
  return withTransaction(async client => {
    const locked = await client.query<CreationRun>("select * from public.creation_runs where id=$1 for update", [run.id]);
    const current = locked.rows[0];
    if (current.status === "complete" && current.draft_id) return current.draft_id;
    if (current.status !== "running" || current.stage !== "revision" || !current.draft_id) throw new Error("Revision run is not ready");
    const draft = await client.query("select id from public.drafts where id=$1 and owner_id=$2 for update", [current.draft_id,current.owner_id]);
    if (!draft.rowCount) throw new Error("Draft not found");
    const next = await client.query<{ version_no: number }>("select coalesce(max(version_no),0)+1 as version_no from public.draft_versions where draft_id=$1", [current.draft_id]);
    await client.query("insert into public.draft_versions(owner_id,draft_id,version_no,text,source_refs,prompt_version,model) values($1,$2,$3,$4,$5,$6,$7)", [current.owner_id,current.draft_id,next.rows[0].version_no,result.text,JSON.stringify(result.sourceUrls),result.promptVersion,result.model]);
    await client.query("update public.drafts set status='draft',updated_at=now() where id=$1", [current.draft_id]);
    await client.query("update public.creation_runs set stages=stages || jsonb_build_object('revision',$2::jsonb),stage='ready',status='complete',lease_owner=null,lease_until=null,updated_at=now() where id=$1", [current.id,JSON.stringify(result)]);
    return current.draft_id;
  });
}

export async function pauseRunForChoice(runId: string, stage: RunStage, payload: unknown): Promise<CreationRun> {
  const result = await getPool().query<CreationRun>(
    `update public.creation_runs set stages=stages || jsonb_build_object($2::text,$3::jsonb),
       status='waiting_for_user',lease_owner=null,lease_until=null,attempts=0,updated_at=now()
     where id=$1 and status='running' returning *`,
    [runId,stage,JSON.stringify(payload)]
  );
  if (!result.rows[0]) throw new Error("Run is not actively leased");
  return result.rows[0];
}

export async function failRun(runId: string, stage: RunStage, error: unknown): Promise<void> {
  const failure = toRunFailure(error);
  await getPool().query(
    `update public.creation_runs set stage=$2,status='failed',error_code=$3,error_message=$4,
       lease_owner=null,lease_until=null,updated_at=now() where id=$1 and status='running'`,
    [runId,stage,failure.code,failure.message]
  );
}
