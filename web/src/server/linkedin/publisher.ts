import { createHash } from "node:crypto";
import { withTransaction } from "../db/client";
import { HttpError } from "../auth/http-error";
import { getLinkedInConnection, type DecryptedConnection } from "./oauth";

export type LinkedInPostResponse = { status: number; id?: string };
export interface LinkedInTransport { post(connection: DecryptedConnection, text: string): Promise<LinkedInPostResponse> }

export const linkedinTransport: LinkedInTransport = {
  async post(connection, text) {
    const version = process.env.LINKEDIN_VERSION;
    if (!version || !/^20\d{4}$/.test(version)) throw new Error("LINKEDIN_VERSION must be a supported YYYYMM value");
    const body = {
      author: connection.personUrn, commentary: text, visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false,
    };
    const response = await fetch("https://api.linkedin.com/rest/posts", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${connection.token}`, "content-type": "application/json",
        "Linkedin-Version": version, "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, id: response.headers.get("x-restli-id") ?? undefined };
  },
};

export type PublicationResult = { id: string; state: "pending" | "published" | "failed" | "uncertain"; linkedinPostUrn: string | null; linkedinPostUrl: string | null; error: string | null };
type AttemptRow = { id: string; state: PublicationResult["state"]; linkedin_post_urn: string | null; linkedin_post_url: string | null; error_message: string | null; created_at: Date };
type Reservation = { attempt: AttemptRow; text: string; newAttempt: boolean };

function toResult(row: AttemptRow): PublicationResult {
  return { id: row.id, state: row.state, linkedinPostUrn: row.linkedin_post_urn, linkedinPostUrl: row.linkedin_post_url, error: row.error_message };
}

async function reserve(ownerId: string, draftId: string): Promise<Reservation> {
  return withTransaction(async client => {
    const draft = await client.query<{ id: string; status: string }>("select id,status from public.drafts where id=$1 and owner_id=$2 for update", [draftId,ownerId]);
    if (!draft.rowCount) throw new HttpError(404,"Draft not found");
    if (draft.rows[0].status === "legacy_published") throw new HttpError(409,"This imported post was already published. Save a new version first.");
    const latest = await client.query<{ id: string; text: string; approval_id: string | null; text_checksum: string | null }>(
      `select v.id,v.text,a.id as approval_id,a.text_checksum from public.draft_versions v
       left join public.approvals a on a.draft_version_id=v.id and a.owner_id=$2
       where v.draft_id=$1 and v.owner_id=$2 order by v.version_no desc limit 1`, [draftId,ownerId]
    );
    const version = latest.rows[0];
    if (!version?.approval_id || !version.text_checksum || createHash("sha256").update(version.text,"utf8").digest("hex") !== version.text_checksum) {
      throw new HttpError(409,"Approve the current draft version before publishing");
    }
    const prior = await client.query<AttemptRow & { attempt_no: number }>(
      "select * from public.publication_attempts where approval_id=$1 order by attempt_no desc limit 1", [version.approval_id]
    );
    const existing = prior.rows[0];
    if (existing && existing.state !== "failed") {
      if (existing.state === "pending" && existing.created_at.getTime() < Date.now() - 5 * 60_000) {
        const changed = await client.query<AttemptRow>("update public.publication_attempts set state='uncertain',error_code='STALE_PENDING',error_message='Publishing was interrupted. Check LinkedIn before trying again.',updated_at=now() where id=$1 returning *", [existing.id]);
        return { attempt: changed.rows[0], text: version.text, newAttempt: false };
      }
      return { attempt: existing, text: version.text, newAttempt: false };
    }
    const nextNo = (existing?.attempt_no ?? 0) + 1;
    const inserted = await client.query<AttemptRow>(
      "insert into public.publication_attempts(owner_id,approval_id,attempt_no,state) values($1,$2,$3,'pending') returning *",
      [ownerId,version.approval_id,nextNo]
    );
    return { attempt: inserted.rows[0], text: version.text, newAttempt: true };
  });
}

async function finishAttempt(ownerId: string, draftId: string, attemptId: string, state: PublicationResult["state"], data: { urn?: string; url?: string; code?: string; message?: string }): Promise<PublicationResult> {
  return withTransaction(async client => {
    const result = await client.query<AttemptRow>(
      `update public.publication_attempts set state=$3,linkedin_post_urn=$4,linkedin_post_url=$5,
       error_code=$6,error_message=$7,updated_at=now()
       where id=$1 and owner_id=$2 and state='pending' returning *`,
      [attemptId,ownerId,state,data.urn ?? null,data.url ?? null,data.code ?? null,data.message ?? null]
    );
    const row = result.rows[0];
    if (!row) throw new Error("Publication attempt changed unexpectedly");
    if (state === "published") await client.query("update public.drafts set status='published',updated_at=now() where id=$1 and owner_id=$2", [draftId,ownerId]);
    if (state === "failed" && data.code === "LINKEDIN_401") await client.query("update public.linkedin_connections set status='expired',updated_at=now() where owner_id=$1", [ownerId]);
    await client.query("insert into public.activity_events(owner_id,event_type,related_id,detail) values($1,$2,$3,$4)", [ownerId,`publication.${state}`,draftId,JSON.stringify({ attemptId })]);
    return toResult(row);
  });
}

export async function publishApprovedVersion(ownerId: string, draftId: string, transport: LinkedInTransport = linkedinTransport): Promise<PublicationResult> {
  const reservation = await reserve(ownerId,draftId);
  if (!reservation.newAttempt) return toResult(reservation.attempt);
  let connection: DecryptedConnection;
  try { connection = await getLinkedInConnection(ownerId); }
  catch (error) {
    const message = error instanceof Error ? error.message : "Connect LinkedIn before publishing";
    await finishAttempt(ownerId,draftId,reservation.attempt.id,"failed",{ code: "NO_CONNECTION", message });
    throw error;
  }
  let response: LinkedInPostResponse;
  try { response = await transport.post(connection,reservation.text); }
  catch {
    return finishAttempt(ownerId,draftId,reservation.attempt.id,"uncertain",{ code: "NETWORK_UNKNOWN", message: "LinkedIn's response was not received. Check your account before any retry." });
  }
  if (response.status === 201 && response.id?.match(/^urn:li:(share|ugcPost):[A-Za-z0-9_-]+$/)) {
    const url = `https://www.linkedin.com/feed/update/${response.id}/`;
    return finishAttempt(ownerId,draftId,reservation.attempt.id,"published",{ urn: response.id, url });
  }
  if (response.status === 201 || response.status >= 500 || response.status === 409) {
    return finishAttempt(ownerId,draftId,reservation.attempt.id,"uncertain",{ code: `LINKEDIN_${response.status}`, message: "LinkedIn's result needs manual review before another attempt." });
  }
  const message = response.status === 401 ? "LinkedIn access expired. Reconnect and try again." : response.status === 403 ? "LinkedIn denied publishing. Check app permissions." : `LinkedIn rejected the post (HTTP ${response.status}).`;
  return finishAttempt(ownerId,draftId,reservation.attempt.id,"failed",{ code: `LINKEDIN_${response.status}`, message });
}
