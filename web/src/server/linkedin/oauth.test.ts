import { afterEach, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { beginLinkedInConnect, buildLinkedInAuthorizationUrl, fetchLinkedInMemberSub, finishLinkedInConnect } from "./oauth";
import { getPool } from "../db/client";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("builds the authorization URL with current self-service permissions", () => {
  const url = buildLinkedInAuthorizationUrl("client-id", "http://localhost:3000/api/linkedin/callback", "state-value");
  expect(url.origin + url.pathname).toBe("https://www.linkedin.com/oauth/v2/authorization");
  expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual(["openid", "profile", "w_member_social"]);
  expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/linkedin/callback");
  expect(url.searchParams.get("state")).toBe("state-value");
});

it("retrieves the OpenID subject from LinkedIn userinfo", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sub: "member-id" }) });
  vi.stubGlobal("fetch", fetchMock);
  await expect(fetchLinkedInMemberSub("access-token")).resolves.toBe("member-id");
  expect(fetchMock).toHaveBeenCalledWith("https://api.linkedin.com/v2/userinfo", expect.objectContaining({
    headers: { Authorization: "Bearer access-token" },
  }));
});

it.skipIf(!process.env.TEST_DATABASE_URL)("binds one-use OAuth state to its owner", async () => {
  const owner = randomUUID(), other = randomUUID();
  const pool = getPool();
  vi.stubEnv("LINKEDIN_TOKEN_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("LINKEDIN_CLIENT_ID", "test-id");
  vi.stubEnv("LINKEDIN_CLIENT_SECRET", "test-secret");
  vi.stubEnv("LINKEDIN_REDIRECT_URI", "http://localhost:3000/api/linkedin/callback");
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("LINKEDIN_VERSION", "202608");
  try {
    await pool.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now()),($3,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$4,'',now(),now())", [owner,`${owner}@test.local`,other,`${other}@test.local`]);
    const url = await beginLinkedInConnect(owner);
    expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual(["openid", "profile", "w_member_social"]);
    const state = url.searchParams.get("state")!;
    await expect(finishLinkedInConnect(other,state,"code")).rejects.toThrow();
    await pool.query("update public.oauth_states set expires_at=now()-interval '1 second' where owner_id=$1", [owner]);
    await expect(finishLinkedInConnect(owner,state,"code")).rejects.toThrow(/expired/i);
    const fresh = (await beginLinkedInConnect(owner)).searchParams.get("state")!;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "test-token", expires_in: 3600 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sub: "member-id" }) });
    vi.stubGlobal("fetch", fetchMock);
    const result = await finishLinkedInConnect(owner,fresh,"code");
    expect(result.personUrn).toBe("urn:li:person:member-id");
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://api.linkedin.com/v2/userinfo", expect.objectContaining({
      headers: { Authorization: "Bearer test-token" },
    }));
    await expect(finishLinkedInConnect(owner,fresh,"code")).rejects.toThrow(/used/i);
  } finally { await pool.query("delete from auth.users where id=any($1::uuid[])", [[owner,other]]); }
});
