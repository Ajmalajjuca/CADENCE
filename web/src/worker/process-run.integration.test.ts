import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { getPool } from "../server/db/client";
import { claimNextRun } from "../server/db/jobs";
import { startCreationRun } from "../server/jobs/creation-service";
import { makeProcessDependencies, processCreationRun } from "./process-run";
import type { CadenceAi } from "../server/ai/claude";
import { saveAiSettings } from "../features/settings/ai-settings";

afterEach(() => vi.unstubAllEnvs());

it.skipIf(!process.env.TEST_DATABASE_URL)("persists every stage and completes a quick draft", async () => {
  const owner = randomUUID();
  const pool = getPool();
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  try {
    await pool.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now())", [owner,`${owner}@test.local`]);
    await pool.query("insert into public.profiles(user_id,name,work,audience,goal,onboarding_step,onboarding_complete) values($1,'A','Builder','Founders','Trust',6,true)", [owner]);
    await saveAiSettings(owner, { apiKey: "sk-ant-integration", researchModel: "claude-sonnet-5", writingModel: "claude-opus-5" }, async () => undefined);
    const started = await startCreationRun(owner, { mode: "quick", entry: "topic", topic: "Workflow lessons" });
    expect(started).toMatchObject({ research_model: "claude-sonnet-5", writing_model: "claude-opus-5", ai_settings_revision: 1 });
    const ai = {
      researchTopic: async () => ({ topic: "Workflow lessons", angle: "An opinion", facts: [], sources: [], promptVersion: "test", model: "fake" }),
      makeHooks: async () => [{ id: "hook-1", type: "opinion", text: "Workflows need judgment.", sourceUrl: null, promptVersion: "test", model: "fake" }],
      writeDraft: async () => ({ text: "Workflows need judgment.\n\nI think structure matters.", claims: [], sourceUrls: [], promptVersion: "test", model: "fake" }),
      editDraft: async () => ({ text: "Workflows need judgment.\n\nI think structure matters.", claims: [], sourceUrls: [], promptVersion: "test", model: "fake" }),
    } as unknown as CadenceAi;
    const deps = makeProcessDependencies(ai);
    for (let i = 0; i < 5; i++) {
      const claimed = await claimNextRun("integration-worker");
      expect(claimed?.id).toBe(started.id);
      await processCreationRun(claimed!, deps);
    }
    const complete = await pool.query("select * from public.creation_runs where id=$1", [started.id]);
    expect(complete.rows[0].status).toBe("complete");
    expect(Object.keys(complete.rows[0].stages)).toEqual(expect.arrayContaining(["idea","research","hooks","draft","style"]));
    const versions = await pool.query("select text from public.draft_versions where draft_id=$1", [complete.rows[0].draft_id]);
    expect(versions.rows).toHaveLength(1);
    expect(versions.rows[0].text).toContain("I think structure matters");
  } finally { await pool.query("delete from auth.users where id=$1", [owner]); }
});
