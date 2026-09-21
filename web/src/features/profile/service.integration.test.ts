import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { getPool } from "../../server/db/client";
import { getProfileState, getVoiceContext, saveOnboardingStep } from "./service";

it.skipIf(!process.env.TEST_DATABASE_URL)("persists steps and exact sample text in PostgreSQL", async () => {
  const owner = randomUUID();
  const other = randomUUID();
  const pool = getPool();
  try {
    await pool.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now()),($3,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$4,'',now(),now())", [owner,`${owner}@test.local`,other,`${other}@test.local`]);
    await saveOnboardingStep(owner, { step: 1, name: "A", work: "Builder", location: "" });
    expect((await getProfileState(owner)).profile?.onboarding_step).toBe(1);
    const exact = "Line one\n\nLine two — exact punctuation.";
    await saveOnboardingStep(owner, { step: 4, samples: [exact], voiceTraits: [] });
    await saveOnboardingStep(other, { step: 1, name: "B", work: "Writer", location: "" });
    const voice = await getVoiceContext(owner);
    expect(voice.samples[0].text).toBe(exact);
    expect(voice.stories).toEqual([]);
    expect(voice.voiceMode).toBe("opinion");
    expect((await getVoiceContext(other)).samples).toEqual([]);
  } finally {
    await pool.query("delete from auth.users where id=any($1::uuid[])", [[owner,other]]);
  }
});
