import { getPool, withTransaction } from "../../server/db/client";
import { onboardingInput, type OnboardingInput } from "./schema";

type ProfileRow = { name: string; work: string; location?: string; audience: string; goal: string; voice_traits: string[]; onboarding_step?: number; onboarding_complete?: boolean };
type PillarRow = { name: string };
type RuleRow = { length_preference: string; casing: string; hashtags: string; emoji: string; cta: string; banned_terms: string[]; notes: string };
type SampleRow = { text: string };
type StoryRow = { title: string; details: string; usage_note: string };

export type ProfileRows = { profile: ProfileRow | null; pillars: PillarRow[]; rules: RuleRow | null; samples: SampleRow[]; stories: StoryRow[] };

export function toVoiceContext(rows: ProfileRows) {
  const profile = rows.profile;
  return {
    identity: { name: profile?.name ?? "", work: profile?.work ?? "", location: profile?.location ?? "" },
    audience: profile?.audience ?? "", goal: profile?.goal ?? "",
    pillars: rows.pillars.map(row => row.name),
    rules: rows.rules ? {
      lengthPreference: rows.rules.length_preference, casing: rows.rules.casing,
      hashtags: rows.rules.hashtags, emoji: rows.rules.emoji, cta: rows.rules.cta,
      bannedTerms: rows.rules.banned_terms, notes: rows.rules.notes,
    } : null,
    voiceTraits: profile?.voice_traits ?? [],
    samples: rows.samples.map(row => ({ text: row.text })),
    stories: rows.stories.map(row => ({ title: row.title, details: row.details, usageNote: row.usage_note })),
    voiceMode: rows.stories.length === 0 ? "opinion" as const : "story" as const,
  };
}
export type VoiceContext = ReturnType<typeof toVoiceContext>;

export async function getProfileState(ownerId: string) {
  const pool = getPool();
  const [profile, pillars, rules, samples, stories] = await Promise.all([
    pool.query<ProfileRow>("select * from public.profiles where user_id=$1", [ownerId]),
    pool.query<PillarRow>("select * from public.pillars where owner_id=$1 order by position", [ownerId]),
    pool.query<RuleRow>("select * from public.voice_rules where owner_id=$1", [ownerId]),
    pool.query<SampleRow>("select * from public.writing_samples where owner_id=$1 order by created_at,id", [ownerId]),
    pool.query<StoryRow>("select * from public.stories where owner_id=$1 order by created_at,id", [ownerId]),
  ]);
  return { profile: profile.rows[0] ?? null, pillars: pillars.rows, rules: rules.rows[0] ?? null, samples: samples.rows, stories: stories.rows };
}

export async function getVoiceContext(ownerId: string): Promise<VoiceContext> {
  return toVoiceContext(await getProfileState(ownerId));
}

export async function saveOnboardingStep(ownerId: string, raw: unknown) {
  const input: OnboardingInput = onboardingInput.parse(raw);
  await withTransaction(async client => {
    await client.query("insert into public.profiles(user_id) values($1) on conflict(user_id) do nothing", [ownerId]);
    if (input.step === 1) {
      await client.query("update public.profiles set name=$2,work=$3,location=$4 where user_id=$1", [ownerId,input.name,input.work,input.location]);
    } else if (input.step === 2) {
      await client.query("update public.profiles set audience=$2,goal=$3 where user_id=$1", [ownerId,input.audience,input.goal]);
    } else if (input.step === 3) {
      await client.query("delete from public.pillars where owner_id=$1", [ownerId]);
      for (const [position,name] of input.pillars.entries()) await client.query("insert into public.pillars(owner_id,name,position,is_primary) values($1,$2,$3,$4)", [ownerId,name,position,position===0]);
    } else if (input.step === 4) {
      await client.query("delete from public.writing_samples where owner_id=$1", [ownerId]);
      for (const sample of input.samples) await client.query("insert into public.writing_samples(owner_id,text) values($1,$2)", [ownerId,sample]);
      await client.query("update public.profiles set voice_traits=$2 where user_id=$1", [ownerId,JSON.stringify(input.voiceTraits)]);
    } else if (input.step === 5) {
      const rule = input.rules;
      await client.query(`insert into public.voice_rules(owner_id,length_preference,casing,hashtags,emoji,cta,banned_terms,notes)
        values($1,$2,$3,$4,$5,$6,$7,$8)
        on conflict(owner_id) do update set length_preference=excluded.length_preference,casing=excluded.casing,
        hashtags=excluded.hashtags,emoji=excluded.emoji,cta=excluded.cta,banned_terms=excluded.banned_terms,
        notes=excluded.notes,revision=public.voice_rules.revision+1,updated_at=now()`,
        [ownerId,rule.lengthPreference,rule.casing,rule.hashtags,rule.emoji,rule.cta,rule.bannedTerms,rule.notes]);
    } else {
      await client.query("delete from public.stories where owner_id=$1", [ownerId]);
      for (const story of input.stories) await client.query("insert into public.stories(owner_id,title,details,usage_note) values($1,$2,$3,$4)", [ownerId,story.title,story.details,story.usageNote]);
    }
    await client.query("update public.profiles set onboarding_step=greatest(onboarding_step,$2),onboarding_complete=onboarding_complete or $3,updated_at=now() where user_id=$1", [ownerId,input.step,input.step===6]);
    await client.query("insert into public.activity_events(owner_id,event_type,detail) values($1,'profile.step_saved',$2)", [ownerId,JSON.stringify({ step: input.step })]);
  });
  return getProfileState(ownerId);
}
