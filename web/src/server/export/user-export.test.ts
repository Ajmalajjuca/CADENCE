import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { getPool } from "../db/client";
import { exportUserData } from "./user-export";

it.skipIf(!process.env.TEST_DATABASE_URL)("exports only one owner's data and no connection secrets", async () => {
  const a = randomUUID(), b = randomUUID();
  const pool = getPool();
  try {
    await pool.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now()),($3,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$4,'',now(),now())", [a,`${a}@test.local`,b,`${b}@test.local`]);
    await pool.query("insert into public.profiles(user_id,name) values($1,'Owner A'),($2,'Secret Owner B')", [a,b]);
    await pool.query("insert into public.ideas(owner_id,title) values($1,'A idea'),($2,'B private idea')", [a,b]);
    await pool.query("insert into public.linkedin_connections(owner_id,person_urn,access_token_encrypted) values($1,'urn:li:person:test','access_token_secret')", [a]);
    await pool.query("insert into public.user_ai_settings(owner_id,api_key_encrypted,key_suffix,research_model,writing_model,status) values($1,'ciphertext_secret','abcd','claude-sonnet-5','claude-opus-5','valid')", [a]);
    const json = await exportUserData(a,"json");
    expect(json.body).toContain("A idea");
    expect(json.body).not.toContain("B private idea");
    expect(json.body).not.toContain("Secret Owner B");
    expect(json.body).not.toContain("access_token_secret");
    expect(json.body).not.toContain("ciphertext_secret");
    expect(json.body).not.toContain("abcd");
    const markdown = await exportUserData(a,"markdown");
    expect(markdown.body).toContain("Owner A");
    expect(markdown.body).not.toContain("ciphertext_secret");
    expect(markdown.body).not.toContain("abcd");
  } finally { await pool.query("delete from auth.users where id=any($1::uuid[])", [[a,b]]); }
});
