import { createHash } from "node:crypto";
import { z } from "zod";
import { getPool, withTransaction } from "../../server/db/client";
import { HttpError } from "../../server/auth/http-error";

export type DraftVersion = { id: string; owner_id: string; draft_id: string; version_no: number; text: string; hook: string; source_refs: string[]; prompt_version: string | null; model: string | null; created_at: Date };
export type Approval = { id: string; owner_id: string; draft_version_id: string; text_checksum: string; approved_at: Date };
export type Draft = { id: string; owner_id: string; title: string; status: string; legacy_post_url: string | null; pillar_id: string | null; idea_id: string | null; created_at: Date; updated_at: Date };

const textSchema = z.string().refine(value => value.trim().length > 0, "Post cannot be empty").max(10000);
const refsSchema = z.array(z.url()).max(30);

export async function createVersion(ownerId: string, draftId: string, rawText: string, rawRefs: string[]): Promise<DraftVersion> {
  const text = textSchema.parse(rawText);
  const sourceRefs = refsSchema.parse(rawRefs);
  return withTransaction(async client => {
    const draft = await client.query("select id from public.drafts where id=$1 and owner_id=$2 for update", [draftId,ownerId]);
    if (!draft.rowCount) throw new HttpError(404, "Draft not found");
    const next = await client.query<{ number: number }>("select coalesce(max(version_no),0)+1 as number from public.draft_versions where draft_id=$1", [draftId]);
    const result = await client.query<DraftVersion>(
      "insert into public.draft_versions(owner_id,draft_id,version_no,text,source_refs) values($1,$2,$3,$4,$5) returning *",
      [ownerId,draftId,next.rows[0].number,text,JSON.stringify(sourceRefs)]
    );
    await client.query("update public.drafts set status='draft',updated_at=now() where id=$1", [draftId]);
    await client.query("insert into public.activity_events(owner_id,event_type,related_id,detail) values($1,'draft.version_created',$2,$3)", [ownerId,draftId,JSON.stringify({ versionNo: next.rows[0].number })]);
    return result.rows[0];
  });
}

export async function approveVersion(ownerId: string, versionId: string, expectedDraftId?: string): Promise<Approval> {
  return withTransaction(async client => {
    const selected = await client.query<DraftVersion & { draft_status: string }>(
      `select v.*,d.status as draft_status from public.draft_versions v join public.drafts d on d.id=v.draft_id and d.owner_id=v.owner_id
       where v.id=$1 and v.owner_id=$2 for update of d`, [versionId,ownerId]
    );
    const version = selected.rows[0];
    if (!version) throw new HttpError(404, "Draft version not found");
    if (version.draft_status === "legacy_published") throw new HttpError(409, "This imported post was already published. Create a new version to reuse it.");
    if (expectedDraftId && version.draft_id !== expectedDraftId) throw new HttpError(404, "Draft version not found");
    const latest = await client.query<{ id: string }>("select id from public.draft_versions where draft_id=$1 order by version_no desc limit 1", [version.draft_id]);
    if (latest.rows[0]?.id !== version.id) throw new HttpError(409, "Only the current version can be approved");
    const checksum = createHash("sha256").update(version.text,"utf8").digest("hex");
    const result = await client.query<Approval>(
      `insert into public.approvals(owner_id,draft_version_id,text_checksum)
       values($1,$2,$3) on conflict(draft_version_id) do update set text_checksum=excluded.text_checksum
       returning *`, [ownerId,version.id,checksum]
    );
    await client.query("update public.drafts set status='approved',updated_at=now() where id=$1", [version.draft_id]);
    await client.query("insert into public.activity_events(owner_id,event_type,related_id,detail) values($1,'draft.approved',$2,$3)", [ownerId,version.draft_id,JSON.stringify({ versionId })]);
    return result.rows[0];
  });
}

export async function getCurrentApprovedVersion(ownerId: string, draftId: string): Promise<{ version: DraftVersion; approval: Approval } | null> {
  const result = await getPool().query<DraftVersion & { approval_id: string | null; text_checksum: string | null; approved_at: Date | null }>(
    `select v.*,a.id as approval_id,a.text_checksum,a.approved_at from public.draft_versions v
     join public.drafts d on d.id=v.draft_id and d.owner_id=v.owner_id
     left join public.approvals a on a.draft_version_id=v.id and a.owner_id=$1
     where d.id=$2 and d.owner_id=$1 order by v.version_no desc limit 1`, [ownerId,draftId]
  );
  const row = result.rows[0];
  if (!row?.approval_id || !row.text_checksum || !row.approved_at) return null;
  if (createHash("sha256").update(row.text,"utf8").digest("hex") !== row.text_checksum) return null;
  const { approval_id, text_checksum, approved_at, ...version } = row;
  return { version, approval: { id: approval_id, owner_id: ownerId, draft_version_id: row.id, text_checksum, approved_at } };
}

export async function getDraftForReview(ownerId: string, draftId: string) {
  const pool = getPool();
  const draft = await pool.query<Draft>("select * from public.drafts where id=$1 and owner_id=$2", [draftId,ownerId]);
  if (!draft.rows[0]) throw new HttpError(404, "Draft not found");
  const [versions, approved, attempts] = await Promise.all([
    pool.query<DraftVersion>("select * from public.draft_versions where draft_id=$1 and owner_id=$2 order by version_no desc", [draftId,ownerId]),
    getCurrentApprovedVersion(ownerId,draftId),
    pool.query("select pa.id,pa.state,pa.linkedin_post_url,pa.error_code,pa.error_message,pa.created_at from public.publication_attempts pa join public.approvals a on a.id=pa.approval_id join public.draft_versions v on v.id=a.draft_version_id where v.draft_id=$1 and pa.owner_id=$2 order by pa.created_at desc", [draftId,ownerId]),
  ]);
  return { draft: draft.rows[0], versions: versions.rows, approved, attempts: attempts.rows };
}
