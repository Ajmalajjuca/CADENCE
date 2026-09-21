import { expect, it } from "vitest";
import { ideaInput } from "./schema";
import { createIdea, listIdeas, setIdeaStatus } from "./service";
import { randomUUID } from "node:crypto";
import { getPool } from "../../server/db/client";

it("rejects a blank title", () => {
  expect(ideaInput.safeParse({ title: "   " }).success).toBe(false);
});

it.skipIf(!process.env.TEST_DATABASE_URL)("keeps ideas owned, searchable, and preserved when discarded", async () => {
  const a = randomUUID(), b = randomUUID();
  const pool = getPool();
  try {
    await pool.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now()),($3,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$4,'',now(),now())", [a,`${a}@test.local`,b,`${b}@test.local`]);
    const idea = await createIdea(a, { title: "Agent workflows", angle: "Lessons" });
    expect((await listIdeas(b, { query: "agent" }))).toEqual([]);
    expect((await listIdeas(a, { query: "agent" })).map(row => row.id)).toContain(idea.id);
    await expect(setIdeaStatus(b, idea.id, "discarded")).rejects.toMatchObject({ status: 404 });
    await setIdeaStatus(a, idea.id, "discarded");
    expect((await listIdeas(a, { status: "discarded" }))[0].id).toBe(idea.id);
  } finally { await pool.query("delete from auth.users where id=any($1::uuid[])", [[a,b]]); }
});
