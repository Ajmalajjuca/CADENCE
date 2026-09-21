import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getPool, withTransaction } from "../src/server/db/client";

type LegacyStory = { title: string; details: string; usageNote: string };
export type ImportPreview = {
  previewId: string; rootPath: string; writes: 0;
  profile: { name: string; work: string; location: string; audience: string; goal: string };
  pillars: string[]; samples: Array<{ text: string; source: string }>;
  rules: { lengthPreference: string; casing: string; hashtags: string; emoji: string; cta: string; bannedTerms: string[]; notes: string };
  stories: LegacyStory[]; draft: { title: string; text: string; publishedUrl: string | null } | null;
  notes: string[]; sourceFiles: string[];
};

function section(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  return markdown.match(new RegExp(`^## ${escaped}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`,"m"))?.[1]?.trim() ?? "";
}
function cleanProse(value: string): string {
  return value.replace(/^>.*$/gm,"").replace(/^<!--[\s\S]*?-->$/gm,"").trim();
}

export function previewLegacyImport(rootPath: string): ImportPreview {
  const root = resolve(rootPath);
  const paths = ["knowledge_base/profile.md","knowledge_base/content_rules.md","knowledge_base/writing_samples.md","knowledge_base/strategy_log.md","drafts/2026-09-16-agentic-workflows.txt"];
  const sourceFiles = paths.map(path => resolve(root,path)).filter(existsSync);
  const contents = new Map(sourceFiles.map(path => [path,readFileSync(path,"utf8")]));
  const profileText = contents.get(resolve(root,paths[0])) ?? "";
  const rulesText = contents.get(resolve(root,paths[1])) ?? "";
  const sampleText = contents.get(resolve(root,paths[2])) ?? "";
  const strategyText = contents.get(resolve(root,paths[3])) ?? "";
  const draftText = contents.get(resolve(root,paths[4]))?.trim() ?? "";
  const identity = cleanProse(section(profileText,"Identity"));
  const locationMatch = identity.match(/based in ([^.]+)\.?$/i);
  const name = identity.split(",")[0]?.trim() || "";
  const pillarBlock = section(profileText,"Content Pillars");
  const pillars = [...pillarBlock.matchAll(/^\d+\.\s+(?:\*\*)?(.+?)(?:\*\*)?(?:\s+\(primary\))?$/gm)].map(match => match[1].replace(/\*\*/g,"").trim());
  const realSamples = [...sampleText.matchAll(/^## Sample\s+[—-][^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)].map(match => {
    const body = match[1].replace(/^\*\*Performance:\*\*.*$/gm,"").replace(/^\*\*Why it works:\*\*.*$/gm,"").trim();
    return { text: body, source: "legacy-writing-samples.md" };
  }).filter(sample => sample.text.length > 0);
  const storyBlock = section(profileText,"Story Bank");
  const stories: LegacyStory[] = /_None captured|skipped this during setup/i.test(storyBlock) ? [] : [];
  const publishedUrl = strategyText.match(/https:\/\/www\.linkedin\.com\/feed\/update\/urn:li:(?:share|ugcPost):[A-Za-z0-9_-]+\/?/)?.[0] ?? null;
  const values = sourceFiles.map(path => `${path}\n${contents.get(path) ?? ""}`).join("\n--CADENCE-FILE--\n");
  const notes: string[] = [];
  if (!stories.length) notes.push("Story Bank was empty or ambiguous; no personal stories will be imported.");
  if (/Synthesized voice profile/i.test(sampleText)) notes.push("Synthesized voice traits remain import notes; only the explicit sample is imported as exact writing.");
  if (strategyText) notes.push("Strategy log is preserved in the source archive; historical analytics and discarded topics are not converted into current strategy rules.");
  return {
    previewId: createHash("sha256").update(values).digest("hex"), rootPath: root, writes: 0,
    profile: { name, work: cleanProse(section(profileText,"What you do")), location: locationMatch?.[1]?.trim() ?? "", audience: cleanProse(section(profileText,"Audience")), goal: cleanProse(section(profileText,"Goal on LinkedIn")) },
    pillars, samples: realSamples,
    rules: {
      lengthPreference: rulesText.match(/\*\*Length:\*\*\s*([^\n]+)/)?.[1]?.trim() ?? "",
      casing: sampleText.match(/Lowercase vs sentence case \| ([^|\n]+)/)?.[1]?.trim() ?? "",
      hashtags: rulesText.match(/\*\*Hashtags:\*\*\s*([^\n]+)/)?.[1]?.trim() ?? "",
      emoji: rulesText.match(/\*\*Emoji:\*\*\s*([^\n]+)/)?.[1]?.trim() ?? "",
      cta: rulesText.match(/\*\*CTA style:\*\*\s*([^\n]+)/)?.[1]?.trim() ?? "",
      bannedTerms: ["leverage","synergy","impactful","passionate","excited to share"],
      notes: cleanProse(section(rulesText,"The non-negotiables")),
    },
    stories,
    draft: draftText ? { title: "Agentic workflows that actually ship", text: draftText, publishedUrl } : null,
    notes, sourceFiles: sourceFiles.map(path => path.slice(root.length + 1)),
  };
}

export async function applyLegacyImport(ownerId: string, preview: ImportPreview, options: { confirmExisting?: boolean } = {}) {
  const current = previewLegacyImport(preview.rootPath);
  if (current.previewId !== preview.previewId) throw new Error("Source files changed; preview again");
  return withTransaction(async client => {
    const existing = await client.query<{ count: string }>(`select
      (select count(*) from public.profiles where user_id=$1) +
      (select count(*) from public.ideas where owner_id=$1) +
      (select count(*) from public.drafts where owner_id=$1) as count`, [ownerId]);
    if (Number(existing.rows[0].count) > 0 && !options.confirmExisting) throw new Error("Owner already has Cadence data; pass --confirm-existing after reviewing the preview");
    await client.query(`insert into public.profiles(user_id,name,work,location,audience,goal,onboarding_step,onboarding_complete)
      values($1,$2,$3,$4,$5,$6,6,true) on conflict(user_id) do nothing`, [ownerId,current.profile.name,current.profile.work,current.profile.location,current.profile.audience,current.profile.goal]);
    let pillars = 0, samples = 0, stories = 0, drafts = 0;
    for (const [position,name] of current.pillars.entries()) {
      const result = await client.query("insert into public.pillars(owner_id,name,position,is_primary) values($1,$2,$3,$4) on conflict(owner_id,name) do nothing", [ownerId,name,position,position===0]);
      pillars += result.rowCount ?? 0;
    }
    await client.query(`insert into public.voice_rules(owner_id,length_preference,casing,hashtags,emoji,cta,banned_terms,notes)
      values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(owner_id) do nothing`, [ownerId,current.rules.lengthPreference,current.rules.casing,current.rules.hashtags,current.rules.emoji,current.rules.cta,current.rules.bannedTerms,current.rules.notes]);
    for (const sample of current.samples) { const result = await client.query("insert into public.writing_samples(owner_id,text,source) values($1,$2,$3)", [ownerId,sample.text,sample.source]); samples += result.rowCount ?? 0; }
    for (const story of current.stories) { const result = await client.query("insert into public.stories(owner_id,title,details,usage_note) values($1,$2,$3,$4)", [ownerId,story.title,story.details,story.usageNote]); stories += result.rowCount ?? 0; }
    if (current.draft) {
      const draft = await client.query<{ id: string }>("insert into public.drafts(owner_id,title,status,legacy_post_url) values($1,$2,$3,$4) returning id", [ownerId,current.draft.title,current.draft.publishedUrl ? "legacy_published" : "draft",current.draft.publishedUrl]);
      await client.query("insert into public.draft_versions(owner_id,draft_id,version_no,text,prompt_version,model) values($1,$2,1,$3,'legacy-import','legacy')", [ownerId,draft.rows[0].id,current.draft.text]); drafts++;
    }
    await client.query("insert into public.activity_events(owner_id,event_type,detail) values($1,'legacy.imported',$2)", [ownerId,JSON.stringify({ previewId: current.previewId, notes: current.notes })]);
    return { ownerId, previewId: current.previewId, pillars, samples, stories, drafts, notes: current.notes };
  });
}

async function cli() {
  const args = process.argv.slice(2);
  const root = args[args.indexOf("--root") + 1] || resolve(process.cwd(),"..");
  const preview = previewLegacyImport(root);
  if (!args.includes("--apply")) { process.stdout.write(`${JSON.stringify(preview,null,2)}\n`); return; }
  const owner = args[args.indexOf("--owner") + 1];
  const previewId = args[args.indexOf("--preview-id") + 1];
  if (!owner || previewId !== preview.previewId) throw new Error("Apply requires --owner <uuid> and the current --preview-id");
  const report = await applyLegacyImport(owner,preview,{ confirmExisting: args.includes("--confirm-existing") });
  process.stdout.write(`${JSON.stringify(report,null,2)}\n`);
  await getPool().end();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void cli().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : error}\n`); process.exitCode=1; });
