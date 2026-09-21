import { resolve } from "node:path";
import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { applyLegacyImport, previewLegacyImport } from "./import-cadence";
import { getPool } from "../src/server/db/client";

it("previews the current Markdown archive without writing or fabricating stories", () => {
  const preview = previewLegacyImport(resolve(process.cwd(),".."));
  expect(preview.writes).toBe(0);
  expect(preview.samples[0].text).toContain("dear manager");
  expect(preview.stories).toEqual([]);
  expect(preview.draft?.text).toContain("your startup doesn't need");
  expect(preview.notes.some(note => note.includes("Story Bank"))).toBe(true);
});

it.skipIf(!process.env.TEST_DATABASE_URL)("applies a reviewed preview once and marks old published text", async () => {
  const owner = randomUUID();
  const pool = getPool();
  try {
    await pool.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now())", [owner,`${owner}@test.local`]);
    const preview = previewLegacyImport(resolve(process.cwd(),".."));
    const report = await applyLegacyImport(owner,preview);
    expect(report.samples).toBe(1);
    const draft = await pool.query("select status,legacy_post_url from public.drafts where owner_id=$1",[owner]);
    expect(draft.rows[0].status).toBe("legacy_published");
    expect(draft.rows[0].legacy_post_url).toContain("linkedin.com/feed/update");
    await expect(applyLegacyImport(owner,preview)).rejects.toThrow(/already has/i);
  } finally { await pool.query("delete from auth.users where id=$1",[owner]); }
});
