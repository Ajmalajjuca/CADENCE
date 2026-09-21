import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { getPool } from "../../server/db/client";
import { approveVersion, createVersion, getCurrentApprovedVersion } from "./service";

it.skipIf(!process.env.TEST_DATABASE_URL)("requires approval of the current immutable version", async () => {
  const a = randomUUID(), b = randomUUID();
  const pool = getPool();
  try {
    await pool.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now()),($3,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$4,'',now(),now())", [a,`${a}@test.local`,b,`${b}@test.local`]);
    const draft = await pool.query<{ id: string }>("insert into public.drafts(owner_id,title) values($1,'A draft') returning id", [a]);
    const first = await createVersion(a,draft.rows[0].id,"My first post.",[]);
    await expect(approveVersion(b,first.id)).rejects.toMatchObject({ status: 404 });
    await approveVersion(a,first.id);
    expect((await getCurrentApprovedVersion(a,draft.rows[0].id))?.version.id).toBe(first.id);
    const second = await createVersion(a,draft.rows[0].id,"My revised post.",[]);
    expect(second.version_no).toBe(2);
    expect(await getCurrentApprovedVersion(a,draft.rows[0].id)).toBeNull();
    const original = await pool.query("select text from public.draft_versions where id=$1", [first.id]);
    expect(original.rows[0].text).toBe("My first post.");
    await expect(approveVersion(a,first.id)).rejects.toMatchObject({ status: 409 });
  } finally { await pool.query("delete from auth.users where id=any($1::uuid[])", [[a,b]]); }
});

it("rejects empty post text before reaching the database", async () => {
  await expect(createVersion("a","b","   ",[])).rejects.toThrow();
});
