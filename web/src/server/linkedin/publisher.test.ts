import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { getPool } from "../db/client";
import { createVersion, approveVersion } from "../../features/drafts/service";
import { encryptToken } from "./crypto";
import { publishApprovedVersion, type LinkedInTransport } from "./publisher";

afterEach(() => vi.unstubAllEnvs());

it.skipIf(!process.env.TEST_DATABASE_URL)("publishes one approved version once and preserves uncertain outcomes", async () => {
  const a = randomUUID(), b = randomUUID();
  const pool = getPool();
  vi.stubEnv("LINKEDIN_TOKEN_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("LINKEDIN_VERSION", "202608");
  try {
    await pool.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now()),($3,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$4,'',now(),now())", [a,`${a}@test.local`,b,`${b}@test.local`]);
    await pool.query("insert into public.linkedin_connections(owner_id,person_urn,access_token_encrypted,expires_at) values($1,'urn:li:person:member123',$2,now()+interval '1 day')", [a,encryptToken("test-token")]);
    const draft = await pool.query<{ id: string }>("insert into public.drafts(owner_id,title) values($1,'A post') returning id", [a]);
    const first = await createVersion(a,draft.rows[0].id,"Exact approved text",[]);
    let calls = 0;
    const transport: LinkedInTransport = { post: async (_connection,text) => { calls++; expect(text).toBe("Exact approved text"); await new Promise(resolve => setTimeout(resolve,30)); return { status: 201, id: "urn:li:share:123" }; } };
    await expect(publishApprovedVersion(a,draft.rows[0].id,transport)).rejects.toMatchObject({ status: 409 });
    await expect(publishApprovedVersion(b,draft.rows[0].id,transport)).rejects.toMatchObject({ status: 404 });
    await approveVersion(a,first.id);
    const [one,two] = await Promise.all([publishApprovedVersion(a,draft.rows[0].id,transport),publishApprovedVersion(a,draft.rows[0].id,transport)]);
    expect(calls).toBe(1);
    expect([one.state,two.state]).toContain("published");
    expect((await publishApprovedVersion(a,draft.rows[0].id,transport)).state).toBe("published");
    expect(calls).toBe(1);
    await createVersion(a,draft.rows[0].id,"Edited after approval",[]);
    await expect(publishApprovedVersion(a,draft.rows[0].id,transport)).rejects.toMatchObject({ status: 409 });

    const secondDraft = await pool.query<{ id: string }>("insert into public.drafts(owner_id,title) values($1,'Another post') returning id", [a]);
    const secondVersion = await createVersion(a,secondDraft.rows[0].id,"A second approved post",[]);
    await approveVersion(a,secondVersion.id);
    let uncertainCalls = 0;
    const uncertainTransport: LinkedInTransport = { post: async () => { uncertainCalls++; throw new Error("network timeout"); } };
    expect((await publishApprovedVersion(a,secondDraft.rows[0].id,uncertainTransport)).state).toBe("uncertain");
    expect((await publishApprovedVersion(a,secondDraft.rows[0].id,uncertainTransport)).state).toBe("uncertain");
    expect(uncertainCalls).toBe(1);
  } finally { await pool.query("delete from auth.users where id=any($1::uuid[])", [[a,b]]); }
});
