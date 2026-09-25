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

it.skipIf(!process.env.TEST_DATABASE_URL)("updates one profile section without deleting unrelated sections", async () => {
  const owner = randomUUID();
  const pool = getPool();
  try {
    await pool.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now())", [owner,`${owner}@test.local`]);
    await saveOnboardingStep(owner, { step: 1, name: "A", work: "Builder", location: "" });
    await saveOnboardingStep(owner, { step: 2, audience: "Founders", goal: "Teach" });
    await saveOnboardingStep(owner, { step: 3, pillars: ["AI", "Teams"] });
    await saveOnboardingStep(owner, { step: 4, samples: ["Line one\n\nLine two."], voiceTraits: ["Direct"] });
    await saveOnboardingStep(owner, { step: 5, rules: { lengthPreference: "medium", casing: "sentence", hashtags: "few", emoji: "none", cta: "question", bannedTerms: ["delve"], notes: "Keep it useful." } });
    await saveOnboardingStep(owner, { step: 6, stories: [{ title: "Launch", details: "Exact details.", usageNote: "Use for lessons" }] });

    const beforeTopics = await getProfileState(owner);
    await saveOnboardingStep(owner, { step: 3, pillars: ["Systems", "Leadership"] });
    const afterTopics = await getProfileState(owner);
    expect(afterTopics.samples).toEqual(beforeTopics.samples);
    expect(afterTopics.rules).toEqual(beforeTopics.rules);
    expect(afterTopics.stories).toEqual(beforeTopics.stories);

    const pillarsBeforeRules = afterTopics.pillars;
    await saveOnboardingStep(owner, { step: 5, rules: { lengthPreference: "short", casing: "lower", hashtags: "none", emoji: "few", cta: "reflection", bannedTerms: [], notes: "" } });
    expect((await getProfileState(owner)).pillars).toEqual(pillarsBeforeRules);
  } finally {
    await pool.query("delete from auth.users where id=$1", [owner]);
  }
});
