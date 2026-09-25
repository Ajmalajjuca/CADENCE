import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { getPool } from "../db/client";
import { registerWakeRequest } from "./wake-request";

afterEach(() => vi.unstubAllEnvs());

it.skipIf(!process.env.TEST_DATABASE_URL)("enforces ownership, queued state, and one wake per cooldown window", async () => {
  const owner = randomUUID();
  const other = randomUUID();
  const runId = randomUUID();
  const pool = getPool();

  try {
    await pool.query(
      "insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now()),($3,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$4,'',now(),now())",
      [owner, `${owner}@test.local`, other, `${other}@test.local`],
    );
    await pool.query(
      "insert into public.creation_runs(id,owner_id,mode,entry,status) values($1,$2,'quick','find','queued')",
      [runId, owner],
    );

    await expect(registerWakeRequest(other, runId)).rejects.toMatchObject({ status: 404 });

    await pool.query("update public.creation_runs set status='complete' where id=$1", [runId]);
    await expect(registerWakeRequest(owner, runId)).rejects.toMatchObject({ status: 409 });
    await pool.query("update public.creation_runs set status='queued' where id=$1", [runId]);

    const outcomes = await Promise.all([
      registerWakeRequest(owner, runId),
      registerWakeRequest(owner, runId),
    ]);
    expect(outcomes.sort()).toEqual(["cooldown", "scheduled"]);

    const events = await pool.query(
      "select event_type from public.activity_events where owner_id=$1 and related_id=$2 and event_type='worker.wake_requested'",
      [owner, runId],
    );
    expect(events.rowCount).toBe(1);
  } finally {
    await pool.query("delete from auth.users where id=any($1::uuid[])", [[owner, other]]);
  }
});
