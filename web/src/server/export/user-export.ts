import { getPool } from "../db/client";

export type Download = { body: string; contentType: string; filename: string };

export async function exportUserData(ownerId: string, format: "json" | "markdown"): Promise<Download> {
  const pool = getPool();
  const [profile,pillars,rules,samples,stories,ideas,sources,drafts,versions,approvals,attempts,events] = await Promise.all([
    pool.query("select * from public.profiles where user_id=$1",[ownerId]),
    pool.query("select * from public.pillars where owner_id=$1 order by position",[ownerId]),
    pool.query("select * from public.voice_rules where owner_id=$1",[ownerId]),
    pool.query("select * from public.writing_samples where owner_id=$1 order by created_at",[ownerId]),
    pool.query("select * from public.stories where owner_id=$1 order by created_at",[ownerId]),
    pool.query("select * from public.ideas where owner_id=$1 order by created_at",[ownerId]),
    pool.query("select * from public.research_sources where owner_id=$1 order by created_at",[ownerId]),
    pool.query("select * from public.drafts where owner_id=$1 order by created_at",[ownerId]),
    pool.query("select * from public.draft_versions where owner_id=$1 order by draft_id,version_no",[ownerId]),
    pool.query("select * from public.approvals where owner_id=$1 order by approved_at",[ownerId]),
    pool.query("select id,approval_id,attempt_no,state,linkedin_post_urn,linkedin_post_url,error_code,error_message,created_at,updated_at from public.publication_attempts where owner_id=$1 order by created_at",[ownerId]),
    pool.query("select * from public.activity_events where owner_id=$1 order by created_at",[ownerId]),
  ]);
  const data = { exportedAt: new Date().toISOString(), profile: profile.rows[0] ?? null, pillars: pillars.rows, voiceRules: rules.rows[0] ?? null, writingSamples: samples.rows, stories: stories.rows, ideas: ideas.rows, researchSources: sources.rows, drafts: drafts.rows, draftVersions: versions.rows, approvals: approvals.rows, publicationAttempts: attempts.rows, activityEvents: events.rows };
  if (format === "json") return { body: JSON.stringify(data,null,2), contentType: "application/json; charset=utf-8", filename: "cadence-export.json" };
  const profileRow = data.profile as { name?: string; work?: string; audience?: string; goal?: string } | null;
  const text = [`# Cadence export`,``,`Exported: ${data.exportedAt}`,``,`## Profile`,``,`**Name:** ${profileRow?.name ?? ""}`,``,`**Work:** ${profileRow?.work ?? ""}`,``,`**Audience:** ${profileRow?.audience ?? ""}`,``,`**Goal:** ${profileRow?.goal ?? ""}`,``,`## Content pillars`,...data.pillars.flatMap((row,index) => [``,`${index+1}. ${(row as { name: string }).name}`]),``,`## Writing samples`,...data.writingSamples.flatMap((row,index) => [``,`### Sample ${index+1}`,``,(row as { text: string }).text]),``,`## Stories`,...data.stories.flatMap((row,index) => [``,`### ${(row as { title: string }).title || `Story ${index+1}`}`,``,(row as { details: string }).details]),``,`## Posts`,...data.drafts.flatMap(draft => { const d=draft as { id: string; title: string; status: string; legacy_post_url?: string }; const draftVersions=data.draftVersions.filter(version => (version as { draft_id: string }).draft_id===d.id) as Array<{ version_no: number; text: string }>; return [``,`### ${d.title || "Untitled post"}`,``,`Status: ${d.status}${d.legacy_post_url ? ` · ${d.legacy_post_url}` : ""}`,...draftVersions.flatMap(version => [``,`#### Version ${version.version_no}`,``,version.text])]; })].join("\n");
  return { body: text, contentType: "text/markdown; charset=utf-8", filename: "cadence-export.md" };
}
