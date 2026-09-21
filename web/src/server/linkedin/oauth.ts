import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { getPool, withTransaction } from "../db/client";
import { readServerConfig } from "../config";
import { HttpError } from "../auth/http-error";
import { encryptToken, decryptToken } from "./crypto";

function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() });
const memberSchema = z.object({ sub: z.string().regex(/^[A-Za-z0-9_-]+$/) });

export type ConnectionStatus = { status: "disconnected" | "connected" | "expired" | "revoked"; personUrn?: string; expiresAt?: string };
export type DecryptedConnection = { ownerId: string; personUrn: string; token: string; expiresAt: Date | null };

export function buildLinkedInAuthorizationUrl(clientId: string, redirectUri: string, state: string): URL {
  const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
  url.searchParams.set("response_type","code");
  url.searchParams.set("client_id",clientId);
  url.searchParams.set("redirect_uri",redirectUri);
  url.searchParams.set("state",state);
  url.searchParams.set("scope","openid profile w_member_social");
  return url;
}

export async function fetchLinkedInMemberSub(accessToken: string): Promise<string> {
  const response = await fetch("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!response.ok) throw new HttpError(502,"LinkedIn identity lookup failed. Confirm the app has OpenID Connect access.");
  return memberSchema.parse(await response.json()).sub;
}

export async function beginLinkedInConnect(ownerId: string): Promise<URL> {
  const config = readServerConfig("linkedin");
  const state = randomBytes(32).toString("base64url");
  await getPool().query("insert into public.oauth_states(state_hash,owner_id,expires_at) values($1,$2,now()+interval '10 minutes')", [hash(state),ownerId]);
  return buildLinkedInAuthorizationUrl(config.LINKEDIN_CLIENT_ID, config.LINKEDIN_REDIRECT_URI, state);
}

export async function finishLinkedInConnect(ownerId: string, state: string, code: string): Promise<ConnectionStatus> {
  if (!state || !code) throw new HttpError(400,"Missing LinkedIn authorization response");
  await withTransaction(async client => {
    const result = await client.query<{ owner_id: string; expires_at: Date; used_at: Date | null }>("select owner_id,expires_at,used_at from public.oauth_states where state_hash=$1 for update", [hash(state)]);
    const saved = result.rows[0];
    if (!saved) throw new HttpError(400,"Invalid LinkedIn connection state");
    if (saved.owner_id !== ownerId) throw new HttpError(403,"LinkedIn connection state belongs to another user");
    if (saved.used_at) throw new HttpError(409,"LinkedIn connection state was already used");
    if (saved.expires_at.getTime() < Date.now()) throw new HttpError(400,"LinkedIn connection state expired");
    await client.query("update public.oauth_states set used_at=now() where state_hash=$1", [hash(state)]);
  });

  const config = readServerConfig("linkedin");
  const body = new URLSearchParams({ grant_type: "authorization_code", code, client_id: config.LINKEDIN_CLIENT_ID, client_secret: config.LINKEDIN_CLIENT_SECRET, redirect_uri: config.LINKEDIN_REDIRECT_URI });
  const tokenResponse = await fetch("https://www.linkedin.com/oauth/v2/accessToken", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, cache: "no-store" });
  if (!tokenResponse.ok) throw new HttpError(502,"LinkedIn token exchange failed. Reconnect and try again.");
  const token = tokenSchema.parse(await tokenResponse.json());
  const personUrn = `urn:li:person:${await fetchLinkedInMemberSub(token.access_token)}`;
  const expiresAt = new Date(Date.now() + token.expires_in * 1000);
  await getPool().query(
    `insert into public.linkedin_connections(owner_id,person_urn,access_token_encrypted,expires_at,status)
     values($1,$2,$3,$4,'connected') on conflict(owner_id) do update set person_urn=excluded.person_urn,
     access_token_encrypted=excluded.access_token_encrypted,expires_at=excluded.expires_at,status='connected',updated_at=now()`,
    [ownerId,personUrn,encryptToken(token.access_token),expiresAt]
  );
  return { status: "connected", personUrn, expiresAt: expiresAt.toISOString() };
}

export async function getConnectionStatus(ownerId: string): Promise<ConnectionStatus> {
  const result = await getPool().query<{ person_urn: string; expires_at: Date | null; status: "connected" | "expired" | "revoked" }>("select person_urn,expires_at,status from public.linkedin_connections where owner_id=$1", [ownerId]);
  const connection = result.rows[0];
  if (!connection) return { status: "disconnected" };
  const status = connection.expires_at && connection.expires_at.getTime() <= Date.now() ? "expired" : connection.status;
  return { status, personUrn: connection.person_urn, expiresAt: connection.expires_at?.toISOString() };
}

export async function getLinkedInConnection(ownerId: string): Promise<DecryptedConnection> {
  const result = await getPool().query<{ person_urn: string; access_token_encrypted: string; expires_at: Date | null; status: string }>("select person_urn,access_token_encrypted,expires_at,status from public.linkedin_connections where owner_id=$1", [ownerId]);
  const connection = result.rows[0];
  if (!connection) throw new HttpError(409,"Connect your LinkedIn account first");
  if (connection.status !== "connected" || (connection.expires_at && connection.expires_at.getTime() <= Date.now())) throw new HttpError(409,"LinkedIn connection expired. Reconnect before publishing.");
  return { ownerId, personUrn: connection.person_urn, token: decryptToken(connection.access_token_encrypted), expiresAt: connection.expires_at };
}
