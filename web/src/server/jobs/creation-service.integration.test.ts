import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { getPool } from "../db/client";
import { saveAiSettings } from "../../features/settings/ai-settings";
import { chooseRunHook, chooseRunIdea, startCreationRun } from "./creation-service";

afterEach(() => vi.unstubAllEnvs());

/**
 * A guided run can sit at a choice for as long as its owner likes, and Settings
 * stays editable while it waits. The models a run was queued with are therefore
 * the models it must finish with — changing Settings mid-run may only affect the
 * next run, never the one already in flight.
 */
it.skipIf(!process.env.TEST_DATABASE_URL)("keeps a waiting run's model snapshot when its owner changes Settings", async () => {
  const owner = randomUUID();
  const pool = getPool();
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  const valid = async () => undefined;
  try {
    await pool.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now())", [owner,`${owner}@test.local`]);
    await pool.query("insert into public.profiles(user_id,name,work,audience,goal,onboarding_step,onboarding_complete) values($1,'A','Builder','Founders','Trust',6,true)", [owner]);
    await saveAiSettings(owner, { apiKey: "sk-ant-guided", researchModel: "claude-sonnet-5", writingModel: "claude-opus-5" }, valid);

    const started = await startCreationRun(owner, { mode: "guided", entry: "surprise" });
    expect(started).toMatchObject({ research_model: "claude-sonnet-5", writing_model: "claude-opus-5", ai_settings_revision: 1 });

    await pool.query(
      "update public.creation_runs set status='waiting_for_user',stage='idea',stages=$2::jsonb where id=$1",
      [started.id, JSON.stringify({ idea: { ideas: [{ id: "idea-1", title: "Judgment beats process" }] } })]
    );
    await saveAiSettings(owner, { researchModel: "claude-opus-5", writingModel: "claude-sonnet-5" }, valid);

    const afterIdea = await chooseRunIdea(owner, started.id, "idea-1");
    expect(afterIdea).toMatchObject({ research_model: "claude-sonnet-5", writing_model: "claude-opus-5", ai_settings_revision: 1 });

    await pool.query(
      "update public.creation_runs set status='waiting_for_user',stage='hooks',stages=stages||$2::jsonb where id=$1",
      [started.id, JSON.stringify({ hooks: { hooks: [{ id: "hook-1", text: "Judgment beats process." }] } })]
    );
    const afterHook = await chooseRunHook(owner, started.id, "hook-1");
    expect(afterHook).toMatchObject({ research_model: "claude-sonnet-5", writing_model: "claude-opus-5", ai_settings_revision: 1 });

    const next = await startCreationRun(owner, { mode: "quick", entry: "topic", topic: "The next one" });
    expect(next).toMatchObject({ research_model: "claude-opus-5", writing_model: "claude-sonnet-5", ai_settings_revision: 2 });
  } finally { await pool.query("delete from auth.users where id=$1", [owner]); }
});
