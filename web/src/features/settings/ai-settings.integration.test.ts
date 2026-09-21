import { afterEach, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { getPool } from "../../server/db/client";
import {
  consumeValidationAttempt,
  getAiRuntimeSettings,
  getSafeAiSettings,
  getValidAiSettingsSnapshot,
  markAiSettingsInvalid,
  removeAiSettings,
  saveAiSettings,
} from "./ai-settings";

afterEach(() => vi.unstubAllEnvs());

it.skipIf(!process.env.TEST_DATABASE_URL)("stores owner-isolated encrypted settings and replaces keys atomically", async () => {
  const ownerA = randomUUID(), ownerB = randomUUID();
  const pool = getPool();
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  const valid = vi.fn().mockResolvedValue(undefined);
  try {
    await pool.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now()),($3,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$4,'',now(),now())", [ownerA,`${ownerA}@test.local`,ownerB,`${ownerB}@test.local`]);
    const saved = await saveAiSettings(ownerA, { apiKey: "sk-ant-owner-a", researchModel: "claude-sonnet-5", writingModel: "claude-opus-5" }, valid);
    expect(saved).toMatchObject({ status: "valid", keySuffix: "er-a", researchModel: "claude-sonnet-5" });
    expect(JSON.stringify(saved)).not.toMatch(/sk-ant-owner-a|v1:/);
    await expect(getAiRuntimeSettings(ownerB)).rejects.toMatchObject({ code: "AI_SETTINGS_REQUIRED" });
    expect(await getValidAiSettingsSnapshot(ownerA)).toMatchObject({ researchModel: "claude-sonnet-5", writingModel: "claude-opus-5", revision: 1 });

    const rejected = vi.fn().mockRejectedValue(new Error("invalid replacement sk-ant-bad"));
    await expect(saveAiSettings(ownerA, { apiKey: "sk-ant-bad", researchModel: "claude-opus-5", writingModel: "claude-sonnet-5" }, rejected)).rejects.toThrow();
    expect((await getAiRuntimeSettings(ownerA)).apiKey).toBe("sk-ant-owner-a");

    await saveAiSettings(ownerA, { researchModel: "claude-opus-5", writingModel: "claude-sonnet-5" }, valid);
    const runtime = await getAiRuntimeSettings(ownerA);
    expect(runtime).toMatchObject({ apiKey: "sk-ant-owner-a", researchModel: "claude-opus-5", writingModel: "claude-sonnet-5", revision: 2 });
    await markAiSettingsInvalid(ownerA, 1);
    expect((await getSafeAiSettings(ownerA)).status).toBe("valid");
    await markAiSettingsInvalid(ownerA, 2);
    expect((await getSafeAiSettings(ownerA)).status).toBe("invalid");
  } finally {
    await pool.query("delete from auth.users where id=any($1::uuid[])", [[ownerA,ownerB]]);
  }
});

it.skipIf(!process.env.TEST_DATABASE_URL)("limits validation attempts and blocks removal while a run is active", async () => {
  const owner = randomUUID();
  const pool = getPool();
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  try {
    await pool.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now())", [owner,`${owner}@test.local`]);
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => consumeValidationAttempt(owner)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(5);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    await saveAiSettings(owner, { apiKey: "sk-ant-owner", researchModel: "claude-sonnet-5", writingModel: "claude-sonnet-5" }, vi.fn().mockResolvedValue(undefined));
    await pool.query("insert into public.creation_runs(owner_id,mode,entry,status) values($1,'guided','find','waiting_for_user')", [owner]);
    await expect(removeAiSettings(owner)).rejects.toMatchObject({ status: 409 });
    await pool.query("update public.creation_runs set status='complete',stage='ready' where owner_id=$1", [owner]);
    await removeAiSettings(owner);
    expect((await getSafeAiSettings(owner)).status).toBe("not_configured");
    const limiter = await pool.query("select attempts from public.ai_validation_limits where owner_id=$1", [owner]);
    expect(limiter.rows[0].attempts).toBe(6);
  } finally {
    await pool.query("delete from auth.users where id=$1", [owner]);
  }
});

it.skipIf(!process.env.TEST_DATABASE_URL)("does not restore a stale key when a model update races with key replacement", async () => {
  const owner = randomUUID();
  const pool = getPool();
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  let releaseFirst!: () => void;
  let firstValidationStarted!: () => void;
  const release = new Promise<void>(resolve => { releaseFirst = resolve; });
  const started = new Promise<void>(resolve => { firstValidationStarted = resolve; });
  try {
    await pool.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now())", [owner,`${owner}@test.local`]);
    await saveAiSettings(owner, { apiKey: "sk-ant-key-a", researchModel: "claude-sonnet-5", writingModel: "claude-sonnet-5" }, async () => undefined);
    let calls = 0;
    const delayedValidation = async () => {
      calls += 1;
      if (calls === 1) { firstValidationStarted(); await release; }
    };
    const modelUpdate = saveAiSettings(owner, { researchModel: "claude-opus-5", writingModel: "claude-opus-5" }, delayedValidation);
    await started;
    await saveAiSettings(owner, { apiKey: "sk-ant-key-b", researchModel: "claude-sonnet-5", writingModel: "claude-opus-5" }, async () => undefined);
    releaseFirst();
    await modelUpdate;
    expect(await getAiRuntimeSettings(owner)).toMatchObject({ apiKey: "sk-ant-key-b", researchModel: "claude-opus-5", writingModel: "claude-opus-5" });
    expect(calls).toBe(2);
  } finally {
    releaseFirst?.();
    await pool.query("delete from auth.users where id=$1", [owner]);
  }
});
