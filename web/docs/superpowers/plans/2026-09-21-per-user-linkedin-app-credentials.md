# Per-user LinkedIn App Credentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Cadence user stores their own encrypted LinkedIn application credentials and connects their own LinkedIn account through their own application, replacing Cadence's central LinkedIn app.

**Architecture:** A private `linkedin_app_credentials` table holds owner-bound AES-256-GCM ciphertext, shaped exactly like the existing `user_ai_settings` table. The OAuth begin and callback resolve the signed-in owner's application instead of server environment variables, recording on each connection which application issued its token. LinkedIn access-token encryption moves onto the existing owner-bound credential crypto, so `src/server/linkedin/crypto.ts` is deleted and one implementation serves three purposes keyed to two encryption keys.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, PostgreSQL/Supabase, Zod 4, Vitest, Testing Library, AES-256-GCM from `node:crypto`.

**Spec:** `docs/superpowers/specs/2026-09-21-per-user-linkedin-app-credentials-design.md`

## Global Constraints

- All paths in this plan are relative to `web/`. Run every command from `web/`.
- A client secret is never returned in an API response, stored outside `linkedin_app_credentials.client_secret_encrypted`, or written to a log, error message, stored failure, or user export. A `client_id` is not a secret and may be returned and displayed.
- The redirect URI is always derived on the server from `APP_URL`. A user-supplied redirect URI is never accepted.
- Additional authenticated data stays `${ownerId}:${purpose}`.
- Encryption keys by purpose: `anthropic-api-key` → `CREDENTIAL_ENCRYPTION_KEY`; `linkedin-access-token` and `linkedin-client-secret` → `LINKEDIN_TOKEN_KEY`.
- Every key is read through `readServerConfig`, never `process.env` directly.
- Publishing behaviour, the approval checkpoint, and duplicate-publish safety do not change. The publisher continues to send only the bearer token.
- Database-backed tests run only with `TEST_DATABASE_URL` set. Guard them with `it.skipIf(!process.env.TEST_DATABASE_URL)`.
- The test database command used throughout: `TEST_DATABASE_URL=1 DATABASE_URL=postgresql://postgres:cadence_test_only@127.0.0.1:55439/cadence_test2 npm test -- --run <paths>`. If that database is not running, recreate it: `docker run -d --name cadence-test-pg -e POSTGRES_PASSWORD=cadence_test_only -e POSTGRES_DB=cadence_test2 -p 55439:5432 postgres:17`, then apply `supabase/plain-postgres-tests/bootstrap.sql` followed by every file in `supabase/migrations/` in filename order.

## Review Focus

Named risks and the tests that hold them down:

- **A secret escaping.** Task 3 asserts the safe DTO omits it; Task 4 asserts the route never returns it; Task 8 asserts the user export omits ciphertext, suffix and secret.
- **Cross-owner decryption.** Task 2 asserts a LinkedIn access token encrypted for owner A fails to decrypt in owner B's context — a property nothing tests today.
- **Exchanging a code against the wrong application.** Task 5 asserts a credential change between begin and callback is refused via `oauth_states.client_id`.
- **A stale flow invalidating fresh credentials.** Task 3 asserts `markLinkedInCredentialsInvalid` is revision-guarded.
- **Pairing one app's id with another's secret.** Task 3 asserts a Client ID change without a secret is refused at save time.
- **A silently unpublishable connection.** Task 6 asserts a token granted without `w_member_social` refuses to publish with a message naming the product.
- **Regressing publishing.** Task 5 and Task 8 require the existing duplicate-publish and uncertain-outcome assertions in `src/server/linkedin/publisher.test.ts` to pass unchanged.

## File Map and Dependency Order

| Area | Files | Responsibility |
| --- | --- | --- |
| Schema | `supabase/migrations/202609210006_linkedin_app_credentials.sql`, `supabase/tests/ownership.sql`, `supabase/plain-postgres-tests/ownership.sql`, `src/server/db/types.ts` | Private table, connection provenance, privilege proofs, row types |
| Crypto | `src/server/credentials/crypto.ts`, `src/server/credentials/crypto.test.ts`, delete `src/server/linkedin/crypto.ts` | One owner-bound implementation, three purposes, two keys |
| Config | `src/server/config.ts`, `src/server/config.test.ts`, `.env.example` | Drop the central app variables, add the token-key group |
| Service | `src/features/settings/linkedin-credentials.ts`, `src/features/settings/linkedin-credentials.integration.test.ts` | Save, validate-by-connect, invalidate, remove |
| API | `src/app/api/settings/linkedin/route.ts`, `src/app/api/settings/linkedin/route.test.ts` | Safe status, redirect URI, writes |
| OAuth | `src/server/linkedin/oauth.ts`, `src/server/linkedin/oauth.test.ts` | Per-owner begin and callback, provenance, scopes |
| Publishing | `src/server/linkedin/publisher.ts`, `src/server/linkedin/publisher.test.ts` | Scope gate only |
| UI | `src/features/settings/settings-page.tsx`, `src/features/settings/settings-page.test.tsx`, `src/features/drafts/editor.tsx`, `src/features/drafts/editor.test.tsx` | Guided panel, `app_required` distinction |
| Docs | `docs/operations.md`, `docs/live-release-check.md`, `src/server/export/user-export.test.ts` | Operator instructions, export safety |

Task 1 lays the schema. Task 2 makes encryption owner-bound for LinkedIn. Task 3 builds the service on both. Task 4 exposes it. Task 5 rewires OAuth onto the service. Task 6 adds the publish gate. Task 7 builds the UI. Task 8 removes the central application from configuration and documentation and verifies the whole release.

---

### Task 1: Private credentials schema and connection provenance

**Files:**
- Create: `supabase/migrations/202609210006_linkedin_app_credentials.sql`
- Modify: `supabase/tests/ownership.sql`
- Modify: `supabase/plain-postgres-tests/ownership.sql`
- Modify: `src/server/db/types.ts`

**Interfaces:**
- Produces: table `public.linkedin_app_credentials`; columns `public.linkedin_connections.client_id`, `public.linkedin_connections.scopes`, `public.oauth_states.client_id`; TypeScript interface `LinkedInAppCredentialsRow`.

- [ ] **Step 1: Add the failing privilege and column checks**

In `supabase/tests/ownership.sql`, raise the plan count on line 2 from `select plan(9);` to `select plan(12);` and add these three assertions immediately before `select * from finish();`:

```sql
select is(has_table_privilege('authenticated','public.linkedin_app_credentials','select'), false,
  'authenticated cannot read encrypted LinkedIn app credentials');
select is(
  (select count(*)::int from information_schema.columns
   where table_schema='public' and table_name='linkedin_connections'
     and column_name in ('client_id','scopes')),
  2,
  'connections record which application issued the token');
select is(
  (select count(*)::int from information_schema.columns
   where table_schema='public' and table_name='oauth_states' and column_name='client_id'),
  1,
  'oauth states record the application that began the flow');
```

In `supabase/plain-postgres-tests/ownership.sql`, add this block inside the existing `do $$ begin ... end $$;` that runs as the `authenticated` role, directly after the `public.user_ai_settings` block:

```sql
 begin
   perform * from public.linkedin_app_credentials;
   raise exception 'browser role read private LinkedIn credentials';
 exception when insufficient_privilege then null; end;
```

- [ ] **Step 2: Run the database tests and confirm the new checks fail**

Run: `npm run db:test`

Expected: FAIL, because `public.linkedin_app_credentials` does not exist.

- [ ] **Step 3: Add the migration**

Create `supabase/migrations/202609210006_linkedin_app_credentials.sql`:

```sql
-- Each user brings their own LinkedIn application. The secret is owner-bound
-- ciphertext no browser role may read; the client id is public by nature and
-- travels in the authorization URL.
create table public.linkedin_app_credentials (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  client_id text not null,
  client_secret_encrypted text not null,
  secret_suffix text not null,
  status text not null default 'unchecked' check (status in ('unchecked','valid','invalid')),
  revision integer not null default 1,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.linkedin_app_credentials enable row level security;
revoke all on public.linkedin_app_credentials from public, anon, authenticated;

-- Which application issued a token, and what it was granted. Nullable: a row
-- restored from a pre-migration backup has neither.
alter table public.linkedin_connections add column client_id text;
alter table public.linkedin_connections add column scopes text;

-- Which application began a flow, so a callback cannot exchange a code against
-- an application the user did not authorize.
alter table public.oauth_states add column client_id text;

-- Every existing token was issued by the central application and is encrypted
-- without owner binding, so it can neither be decrypted nor legitimately used
-- after this change. Publication history is untouched; every user reconnects.
delete from public.linkedin_connections;
```

- [ ] **Step 4: Add the matching row type**

In `src/server/db/types.ts`, after the `UserAiSettingsRow` interface, add:

```ts
export interface LinkedInAppCredentialsRow {
  owner_id: string;
  client_id: string;
  client_secret_encrypted: string;
  secret_suffix: string;
  status: "unchecked" | "valid" | "invalid";
  revision: number;
  validated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
```

Do not look for a connection row interface here — `src/server/db/types.ts` has only `CreationRun` and `UserAiSettingsRow`. `linkedin_connections` rows are typed inline in the `client.query<...>` generics inside `src/server/linkedin/oauth.ts`, and Tasks 5 and 6 widen those generics where they select the new columns.

- [ ] **Step 5: Run schema verification**

Run: `npm run db:test`

Expected: PASS with 12 tests.

Then rebuild the plain-PostgreSQL database and run that harness:

```bash
docker exec -e PGPASSWORD=cadence_test_only cadence-test-pg psql -U postgres -d postgres -q -c "drop database if exists cadence_test2" -c "create database cadence_test2"
docker exec -i -e PGPASSWORD=cadence_test_only cadence-test-pg psql -U postgres -d cadence_test2 -v ON_ERROR_STOP=1 -q < supabase/plain-postgres-tests/bootstrap.sql
for m in supabase/migrations/*.sql; do docker exec -i -e PGPASSWORD=cadence_test_only cadence-test-pg psql -U postgres -d cadence_test2 -v ON_ERROR_STOP=1 -q < "$m"; done
docker exec -i -e PGPASSWORD=cadence_test_only cadence-test-pg psql -U postgres -d cadence_test2 -v ON_ERROR_STOP=1 -q < supabase/plain-postgres-tests/ownership.sql
```

Expected: exit 0 with no `raise exception` output.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/202609210006_linkedin_app_credentials.sql supabase/tests/ownership.sql supabase/plain-postgres-tests/ownership.sql src/server/db/types.ts
git commit -m "feat: add private per-user LinkedIn app credential schema"
```

---

### Task 2: Purpose-keyed owner-bound credential crypto

**Files:**
- Modify: `src/server/credentials/crypto.ts`
- Modify: `src/server/credentials/crypto.test.ts`
- Modify: `src/server/config.ts`
- Modify: `src/server/config.test.ts`
- Delete: `src/server/linkedin/crypto.ts`
- Modify: `src/server/linkedin/oauth.ts` (only the two crypto call sites)
- Modify: `src/server/linkedin/oauth.test.ts` (only the token-crypto test)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `CredentialPurpose = "anthropic-api-key" | "linkedin-access-token" | "linkedin-client-secret"`; `encryptCredential(plaintext: string, context: CredentialContext): string` and `decryptCredential(stored: string, context: CredentialContext): string` unchanged in shape, now keyed by purpose; config group `"linkedinTokens"` requiring `LINKEDIN_TOKEN_KEY`.

- [ ] **Step 1: Write the failing crypto and config tests**

Append to `src/server/credentials/crypto.test.ts`:

```ts
it("keys each purpose to its own encryption key and binds the owner", () => {
  const anthropicKey = randomBytes(32).toString("base64");
  const linkedinKey = randomBytes(32).toString("base64");
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", anthropicKey);
  vi.stubEnv("LINKEDIN_TOKEN_KEY", linkedinKey);
  const ownerA = randomUUID(), ownerB = randomUUID();
  const token = { ownerId: ownerA, purpose: "linkedin-access-token" as const };

  const encrypted = encryptCredential("li-access-token", token);
  expect(encrypted).not.toContain("li-access-token");
  expect(decryptCredential(encrypted, token)).toBe("li-access-token");

  // Owner binding: nothing today protects LinkedIn tokens this way.
  expect(() => decryptCredential(encrypted, { ...token, ownerId: ownerB })).toThrow(CredentialDecryptionError);
  // Purpose binding: the same key, a different purpose, must not open it.
  expect(() => decryptCredential(encrypted, { ownerId: ownerA, purpose: "linkedin-client-secret" })).toThrow(CredentialDecryptionError);
  // Key separation: an Anthropic secret does not open under the LinkedIn key.
  const anthropic = encryptCredential("sk-ant-secret", { ownerId: ownerA, purpose: "anthropic-api-key" });
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", linkedinKey);
  expect(() => decryptCredential(anthropic, { ownerId: ownerA, purpose: "anthropic-api-key" })).toThrow(CredentialDecryptionError);
});

it("reports a missing LinkedIn token key by name", () => {
  vi.stubEnv("LINKEDIN_TOKEN_KEY", "");
  expect(() => encryptCredential("li-access-token", { ownerId: randomUUID(), purpose: "linkedin-access-token" }))
    .toThrow(/Missing or invalid server configuration: LINKEDIN_TOKEN_KEY/);
});
```

Append to `src/server/config.test.ts`:

```ts
it("requires only the token key for LinkedIn encryption and no central application", () => {
  vi.stubEnv("LINKEDIN_TOKEN_KEY", randomBytes(32).toString("base64"));
  expect(readServerConfig("linkedinTokens").LINKEDIN_TOKEN_KEY).toHaveLength(44);
  expect(Object.keys(readServerConfig("linkedinTokens"))).toEqual(["LINKEDIN_TOKEN_KEY"]);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- --run src/server/credentials/crypto.test.ts src/server/config.test.ts`

Expected: FAIL — `"linkedinTokens"` is not a config group and the purpose union does not accept `linkedin-access-token`.

- [ ] **Step 3: Add the config group and drop the central application group**

In `src/server/config.ts`, replace the `linkedin` entry in `groups` with a token-key-only group. The `linkedin` group is removed entirely: after Task 5 nothing needs `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` or `LINKEDIN_REDIRECT_URI`, and the redirect URI is derived from the existing `app` group.

```ts
const groups = {
  auth: ["SUPABASE_URL", "SUPABASE_ANON_KEY"],
  authAdmin: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
  app: ["APP_URL"],
  database: ["DATABASE_URL"],
  credentials: ["CREDENTIAL_ENCRYPTION_KEY"],
  linkedinTokens: ["LINKEDIN_TOKEN_KEY"],
  worker: ["DATABASE_URL", "CREDENTIAL_ENCRYPTION_KEY"],
} as const;
```

- [ ] **Step 4: Key the crypto by purpose**

In `src/server/credentials/crypto.ts`, widen the purpose and select the key from it:

```ts
export type CredentialPurpose = "anthropic-api-key" | "linkedin-access-token" | "linkedin-client-secret";
export type CredentialContext = { ownerId: string; purpose: CredentialPurpose };

/**
 * Two keys, not one.
 *
 * A single key would be simpler, but rotating it would then destroy every
 * provider's secrets at once. Splitting by provider keeps each blast radius
 * to the provider whose key changed. The additional authenticated data still
 * separates purposes inside a shared key.
 */
function encryptionKey(purpose: CredentialPurpose): Buffer {
  const [group, variable] = purpose === "anthropic-api-key"
    ? ["credentials" as const, "CREDENTIAL_ENCRYPTION_KEY"]
    : ["linkedinTokens" as const, "LINKEDIN_TOKEN_KEY"];
  const raw = readServerConfig(group)[variable];
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32) throw new Error(`${variable} must decode to 32 bytes`);
  return decoded;
}
```

Pass `context.purpose` at both call sites: `createCipheriv("aes-256-gcm", encryptionKey(context.purpose), iv)` in `encryptCredential`, and `const key = encryptionKey(context.purpose);` in `decryptCredential`.

- [ ] **Step 5: Move the LinkedIn call sites and delete the old module**

In `src/server/linkedin/oauth.ts`, replace the import `import { encryptToken, decryptToken } from "./crypto";` with `import { encryptCredential, decryptCredential } from "../credentials/crypto";` and change the two call sites:

```ts
// in finishLinkedInConnect, writing the connection
encryptCredential(token.access_token, { ownerId, purpose: "linkedin-access-token" })

// in getLinkedInConnection, reading it
decryptCredential(connection.access_token_encrypted, { ownerId, purpose: "linkedin-access-token" })
```

Delete `src/server/linkedin/crypto.ts`. In `src/server/linkedin/oauth.test.ts`, delete the `"encrypts access tokens with fresh ciphertext"` test and its `import { encryptToken, decryptToken } from "./crypto";` line — Step 1's test covers that behaviour and adds the owner binding it lacked.

- [ ] **Step 6: Run the focused tests**

Run: `npm test -- --run src/server/credentials/crypto.test.ts src/server/config.test.ts src/server/linkedin`

Expected: PASS. The database-backed OAuth test still stubs `LINKEDIN_CLIENT_ID` and friends; it keeps passing here and is rewritten in Task 5.

Run: `npx tsc --noEmit`

Expected: exit 0. A remaining reference to `./crypto` inside `src/server/linkedin/` is a type error and means Step 5 was incomplete.

- [ ] **Step 7: Commit**

```bash
git add src/server/credentials/crypto.ts src/server/credentials/crypto.test.ts src/server/config.ts src/server/config.test.ts src/server/linkedin/oauth.ts src/server/linkedin/oauth.test.ts
git rm src/server/linkedin/crypto.ts
git commit -m "refactor: bind LinkedIn token encryption to its owner"
```

---

### Task 3: LinkedIn credential service

**Files:**
- Create: `src/features/settings/linkedin-credentials.ts`
- Create: `src/features/settings/linkedin-credentials.integration.test.ts`

**Interfaces:**
- Consumes: `LinkedInAppCredentialsRow` (Task 1); `encryptCredential`, `decryptCredential`, `CredentialDecryptionError` (Task 2).
- Produces:
  - `type SafeLinkedInCredentials = { status: "not_configured" | "unchecked" | "valid" | "invalid"; clientId?: string; secretSuffix?: string; validatedAt?: string }`
  - `getSafeLinkedInCredentials(ownerId: string): Promise<SafeLinkedInCredentials>`
  - `saveLinkedInCredentials(ownerId: string, input: { clientId: string; clientSecret?: string }): Promise<SafeLinkedInCredentials>`
  - `getLinkedInAppCredentials(ownerId: string, database?: Pick<pg.Pool | pg.PoolClient, "query">): Promise<{ clientId: string; clientSecret: string; revision: number }>`
  - `markLinkedInCredentialsValid(ownerId: string, revision: number): Promise<void>`
  - `markLinkedInCredentialsInvalid(ownerId: string, revision: number): Promise<void>`
  - `removeLinkedInCredentials(ownerId: string): Promise<void>`
  - `LINKEDIN_ERROR_CODES` — `{ appRequired: "LINKEDIN_APP_REQUIRED", appInvalid: "LINKEDIN_APP_INVALID", appChanged: "LINKEDIN_APP_CHANGED", scopeMissing: "LINKEDIN_SCOPE_MISSING" }`

- [ ] **Step 1: Write the failing service integration test**

Create `src/features/settings/linkedin-credentials.integration.test.ts`:

```ts
import { afterEach, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { getPool } from "../../server/db/client";
import {
  getLinkedInAppCredentials,
  getSafeLinkedInCredentials,
  markLinkedInCredentialsInvalid,
  markLinkedInCredentialsValid,
  removeLinkedInCredentials,
  saveLinkedInCredentials,
} from "./linkedin-credentials";

afterEach(() => vi.unstubAllEnvs());

async function seedOwner(ownerId: string) {
  await getPool().query(
    "insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now())",
    [ownerId, `${ownerId}@test.local`]
  );
}

it.skipIf(!process.env.TEST_DATABASE_URL)("stores an owner-isolated secret and never returns it", async () => {
  const ownerA = randomUUID(), ownerB = randomUUID();
  const pool = getPool();
  vi.stubEnv("LINKEDIN_TOKEN_KEY", randomBytes(32).toString("base64"));
  try {
    await seedOwner(ownerA);
    await seedOwner(ownerB);
    const saved = await saveLinkedInCredentials(ownerA, { clientId: "app-a", clientSecret: "li-secret-aaaa" });
    expect(saved).toMatchObject({ status: "unchecked", clientId: "app-a", secretSuffix: "aaaa" });
    expect(JSON.stringify(saved)).not.toMatch(/li-secret-aaaa|v1:/);
    expect(saved.validatedAt).toBeUndefined();

    expect(await getSafeLinkedInCredentials(ownerB)).toEqual({ status: "not_configured" });
    await expect(getLinkedInAppCredentials(ownerB)).rejects.toMatchObject({ code: "LINKEDIN_APP_REQUIRED", status: 409 });
    expect(await getLinkedInAppCredentials(ownerA)).toMatchObject({ clientId: "app-a", clientSecret: "li-secret-aaaa", revision: 1 });

    const stored = await pool.query("select client_secret_encrypted from public.linkedin_app_credentials where owner_id=$1", [ownerA]);
    expect(stored.rows[0].client_secret_encrypted).toMatch(/^v1:/);
    expect(stored.rows[0].client_secret_encrypted).not.toContain("li-secret");
  } finally {
    await pool.query("delete from auth.users where id=any($1::uuid[])", [[ownerA, ownerB]]);
  }
});

it.skipIf(!process.env.TEST_DATABASE_URL)("refuses a new client id without a secret and resets status on every change", async () => {
  const owner = randomUUID();
  const pool = getPool();
  vi.stubEnv("LINKEDIN_TOKEN_KEY", randomBytes(32).toString("base64"));
  try {
    await seedOwner(owner);
    // Nothing stored: a secret is mandatory.
    await expect(saveLinkedInCredentials(owner, { clientId: "app-a" })).rejects.toMatchObject({ code: "LINKEDIN_APP_REQUIRED" });

    await saveLinkedInCredentials(owner, { clientId: "app-a", clientSecret: "li-secret-aaaa" });
    await markLinkedInCredentialsValid(owner, 1);
    expect((await getSafeLinkedInCredentials(owner)).status).toBe("valid");

    // Re-saving the same application without a secret is a no-op on the secret.
    const resaved = await saveLinkedInCredentials(owner, { clientId: "app-a" });
    expect(resaved).toMatchObject({ status: "unchecked", clientId: "app-a", secretSuffix: "aaaa" });
    expect((await getLinkedInAppCredentials(owner)).clientSecret).toBe("li-secret-aaaa");

    // A different application with the old secret is refused, not stored.
    await expect(saveLinkedInCredentials(owner, { clientId: "app-b" })).rejects.toMatchObject({ code: "LINKEDIN_APP_INVALID" });
    expect((await getSafeLinkedInCredentials(owner)).clientId).toBe("app-a");

    await saveLinkedInCredentials(owner, { clientId: "app-b", clientSecret: "li-secret-bbbb" });
    expect(await getSafeLinkedInCredentials(owner)).toMatchObject({ status: "unchecked", clientId: "app-b", secretSuffix: "bbbb" });
    expect((await getLinkedInAppCredentials(owner)).revision).toBe(4);
  } finally {
    await pool.query("delete from auth.users where id=$1", [owner]);
  }
});

it.skipIf(!process.env.TEST_DATABASE_URL)("drops the connection when the application changes, keeps it when only the secret rotates", async () => {
  const owner = randomUUID();
  const pool = getPool();
  vi.stubEnv("LINKEDIN_TOKEN_KEY", randomBytes(32).toString("base64"));
  const connect = async (clientId: string) => pool.query(
    `insert into public.linkedin_connections(owner_id,person_urn,access_token_encrypted,expires_at,status,client_id,scopes)
     values($1,'urn:li:person:m','v1:x:y:z',now()+interval '30 days','connected',$2,'openid profile w_member_social')
     on conflict(owner_id) do update set client_id=excluded.client_id`, [owner, clientId]
  );
  const connections = async () => (await pool.query("select count(*)::int as count from public.linkedin_connections where owner_id=$1", [owner])).rows[0].count;
  try {
    await seedOwner(owner);
    await saveLinkedInCredentials(owner, { clientId: "app-a", clientSecret: "li-secret-aaaa" });
    await connect("app-a");

    // Rotating the secret leaves the token alone: LinkedIn tokens outlive a
    // secret rotation and publishing sends only the bearer token.
    await saveLinkedInCredentials(owner, { clientId: "app-a", clientSecret: "li-secret-cccc" });
    expect(await connections()).toBe(1);

    // A different application makes the stored token meaningless.
    await saveLinkedInCredentials(owner, { clientId: "app-b", clientSecret: "li-secret-bbbb" });
    expect(await connections()).toBe(0);

    await connect("app-b");
    await removeLinkedInCredentials(owner);
    expect(await connections()).toBe(0);
    expect(await getSafeLinkedInCredentials(owner)).toEqual({ status: "not_configured" });
  } finally {
    await pool.query("delete from auth.users where id=$1", [owner]);
  }
});

it.skipIf(!process.env.TEST_DATABASE_URL)("invalidates only the revision that was loaded", async () => {
  const owner = randomUUID();
  const pool = getPool();
  vi.stubEnv("LINKEDIN_TOKEN_KEY", randomBytes(32).toString("base64"));
  try {
    await seedOwner(owner);
    await saveLinkedInCredentials(owner, { clientId: "app-a", clientSecret: "li-secret-aaaa" });
    const loaded = await getLinkedInAppCredentials(owner);
    await saveLinkedInCredentials(owner, { clientId: "app-a", clientSecret: "li-secret-dddd" });

    // A callback for the replaced secret must not condemn the new one.
    await markLinkedInCredentialsInvalid(owner, loaded.revision);
    expect((await getSafeLinkedInCredentials(owner)).status).toBe("unchecked");

    await markLinkedInCredentialsInvalid(owner, loaded.revision + 1);
    expect((await getSafeLinkedInCredentials(owner)).status).toBe("invalid");
  } finally {
    await pool.query("delete from auth.users where id=$1", [owner]);
  }
});

it.skipIf(!process.env.TEST_DATABASE_URL)("sends the owner back to Settings when a stored secret cannot be decrypted", async () => {
  const owner = randomUUID();
  const pool = getPool();
  vi.stubEnv("LINKEDIN_TOKEN_KEY", randomBytes(32).toString("base64"));
  try {
    await seedOwner(owner);
    await saveLinkedInCredentials(owner, { clientId: "app-a", clientSecret: "li-secret-aaaa" });
    vi.stubEnv("LINKEDIN_TOKEN_KEY", randomBytes(32).toString("base64"));
    await expect(getLinkedInAppCredentials(owner)).rejects.toMatchObject({ code: "LINKEDIN_APP_INVALID", status: 409 });
  } finally {
    await pool.query("delete from auth.users where id=$1", [owner]);
  }
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `TEST_DATABASE_URL=1 DATABASE_URL=postgresql://postgres:cadence_test_only@127.0.0.1:55439/cadence_test2 npm test -- --run src/features/settings/linkedin-credentials.integration.test.ts`

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the service**

Create `src/features/settings/linkedin-credentials.ts`:

```ts
import { getPool, withTransaction } from "../../server/db/client";
import type { LinkedInAppCredentialsRow } from "../../server/db/types";
import { CredentialDecryptionError, decryptCredential, encryptCredential } from "../../server/credentials/crypto";
import { HttpError } from "../../server/auth/http-error";
import type pg from "pg";

export const LINKEDIN_ERROR_CODES = {
  appRequired: "LINKEDIN_APP_REQUIRED",
  appInvalid: "LINKEDIN_APP_INVALID",
  appChanged: "LINKEDIN_APP_CHANGED",
  scopeMissing: "LINKEDIN_SCOPE_MISSING",
} as const;

export type SafeLinkedInCredentials = {
  status: "not_configured" | "unchecked" | "valid" | "invalid";
  clientId?: string;
  secretSuffix?: string;
  validatedAt?: string;
};

export type LinkedInAppCredentials = { clientId: string; clientSecret: string; revision: number };
export type SaveLinkedInCredentialsInput = { clientId: string; clientSecret?: string };

const PURPOSE = "linkedin-client-secret" as const;

function safe(row?: LinkedInAppCredentialsRow): SafeLinkedInCredentials {
  if (!row) return { status: "not_configured" };
  return {
    status: row.status,
    clientId: row.client_id,
    secretSuffix: row.secret_suffix,
    validatedAt: row.validated_at?.toISOString(),
  };
}

type Queryable = Pick<pg.Pool | pg.PoolClient, "query">;

async function getRow(ownerId: string, database: Queryable = getPool()): Promise<LinkedInAppCredentialsRow | undefined> {
  const result = await database.query<LinkedInAppCredentialsRow>(
    "select * from public.linkedin_app_credentials where owner_id=$1", [ownerId]
  );
  return result.rows[0];
}

/**
 * A lock namespace of its own.
 *
 * The AI settings lock uses the single-argument advisory lock; this uses the
 * two-argument form, which is a separate lock space. Saving LinkedIn
 * credentials therefore never waits on an unrelated creation run.
 */
export async function withOwnerLinkedInLock<T>(ownerId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return withTransaction(async client => {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0), 1)", [ownerId]);
    return fn(client);
  });
}

export async function getSafeLinkedInCredentials(ownerId: string): Promise<SafeLinkedInCredentials> {
  return safe(await getRow(ownerId));
}

/**
 * Read the owner's secret, or tell them to fix it in Settings.
 *
 * A secret this deployment cannot decrypt means `LINKEDIN_TOKEN_KEY` was
 * rotated or lost. Retrying will never succeed, so it is reported as a
 * credential problem rather than a transient connection failure.
 */
export async function getLinkedInAppCredentials(ownerId: string, database: Queryable = getPool()): Promise<LinkedInAppCredentials> {
  const row = await getRow(ownerId, database);
  if (!row) throw new HttpError(409, "Add your LinkedIn application in Settings first.", LINKEDIN_ERROR_CODES.appRequired);
  try {
    return {
      clientId: row.client_id,
      clientSecret: decryptCredential(row.client_secret_encrypted, { ownerId, purpose: PURPOSE }),
      revision: row.revision,
    };
  } catch (error) {
    if (error instanceof CredentialDecryptionError) {
      throw new HttpError(409, "Your stored LinkedIn client secret could not be read. Replace it in Settings.", LINKEDIN_ERROR_CODES.appInvalid);
    }
    throw error;
  }
}

export async function saveLinkedInCredentials(ownerId: string, input: SaveLinkedInCredentialsInput): Promise<SafeLinkedInCredentials> {
  const clientId = input.clientId.trim();
  const suppliedSecret = input.clientSecret?.trim();
  if (!clientId) throw new HttpError(400, "Enter your LinkedIn Client ID.", LINKEDIN_ERROR_CODES.appRequired);

  return withOwnerLinkedInLock(ownerId, async client => {
    const existing = await getRow(ownerId, client);
    if (!existing && !suppliedSecret) {
      throw new HttpError(409, "Enter your LinkedIn Client Secret.", LINKEDIN_ERROR_CODES.appRequired);
    }
    // A new application with an old application's secret cannot work. Refusing
    // here turns a confusing invalid_client at connect time into a clear
    // message at save time.
    if (existing && !suppliedSecret && existing.client_id !== clientId) {
      throw new HttpError(409, "Enter the Client Secret for this application.", LINKEDIN_ERROR_CODES.appInvalid);
    }

    const secret = suppliedSecret ?? decryptCredential(existing!.client_secret_encrypted, { ownerId, purpose: PURPOSE });
    const encrypted = suppliedSecret
      ? encryptCredential(secret, { ownerId, purpose: PURPOSE })
      : existing!.client_secret_encrypted;
    const suffix = secret.slice(-4);
    const applicationChanged = !!existing && existing.client_id !== clientId;

    const result = existing
      ? await client.query<LinkedInAppCredentialsRow>(
          `update public.linkedin_app_credentials
             set client_id=$2, client_secret_encrypted=$3, secret_suffix=$4,
                 status='unchecked', revision=revision+1, validated_at=null, updated_at=now()
           where owner_id=$1 returning *`,
          [ownerId, clientId, encrypted, suffix]
        )
      : await client.query<LinkedInAppCredentialsRow>(
          `insert into public.linkedin_app_credentials
             (owner_id,client_id,client_secret_encrypted,secret_suffix,status,revision)
           values($1,$2,$3,$4,'unchecked',1) returning *`,
          [ownerId, clientId, encrypted, suffix]
        );

    // A token issued by the previous application is meaningless under the new
    // one. A secret rotation within the same application keeps the token.
    if (applicationChanged) {
      await client.query("delete from public.linkedin_connections where owner_id=$1", [ownerId]);
    }
    return safe(result.rows[0]);
  });
}

export async function markLinkedInCredentialsValid(ownerId: string, revision: number): Promise<void> {
  await getPool().query(
    "update public.linkedin_app_credentials set status='valid',validated_at=now(),updated_at=now() where owner_id=$1 and revision=$2",
    [ownerId, revision]
  );
}

export async function markLinkedInCredentialsInvalid(ownerId: string, revision: number): Promise<void> {
  await getPool().query(
    "update public.linkedin_app_credentials set status='invalid',updated_at=now() where owner_id=$1 and revision=$2",
    [ownerId, revision]
  );
}

export async function removeLinkedInCredentials(ownerId: string): Promise<void> {
  await withOwnerLinkedInLock(ownerId, async client => {
    await client.query("delete from public.linkedin_connections where owner_id=$1", [ownerId]);
    await client.query("delete from public.linkedin_app_credentials where owner_id=$1", [ownerId]);
  });
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `TEST_DATABASE_URL=1 DATABASE_URL=postgresql://postgres:cadence_test_only@127.0.0.1:55439/cadence_test2 npm test -- --run src/features/settings/linkedin-credentials.integration.test.ts`

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/linkedin-credentials.ts src/features/settings/linkedin-credentials.integration.test.ts
git commit -m "feat: add owner-scoped LinkedIn credential service"
```

---

### Task 4: Settings credentials API

**Files:**
- Create: `src/app/api/settings/linkedin/route.ts`
- Create: `src/app/api/settings/linkedin/route.test.ts`

**Interfaces:**
- Consumes: the whole Task 3 service surface.
- Produces: `GET`, `PUT`, `DELETE` at `/api/settings/linkedin`. `GET` returns `SafeLinkedInCredentials & { redirectUri: string }`.

- [ ] **Step 1: Write the failing route test**

Create `src/app/api/settings/linkedin/route.test.ts`, following the mocking style of `src/app/api/settings/ai/route.test.ts`:

```ts
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getSafe: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("../../../../server/auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("../../../../features/settings/linkedin-credentials", () => ({
  getSafeLinkedInCredentials: mocks.getSafe,
  saveLinkedInCredentials: mocks.save,
  removeLinkedInCredentials: mocks.remove,
}));

import { DELETE, GET, PUT } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_URL", "https://cadence.example");
  mocks.requireUser.mockResolvedValue({ id: "owner-a" });
  mocks.getSafe.mockResolvedValue({ status: "unchecked", clientId: "app-a", secretSuffix: "aaaa" });
  mocks.save.mockResolvedValue({ status: "unchecked", clientId: "app-a", secretSuffix: "aaaa" });
});

function put(body: unknown) {
  return new Request("https://cadence.example/api/settings/linkedin", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

it("returns the safe status with the server-derived redirect URI", async () => {
  const response = await GET();
  const body = await response.json();
  expect(body).toMatchObject({ status: "unchecked", clientId: "app-a", secretSuffix: "aaaa" });
  expect(body.redirectUri).toBe("https://cadence.example/api/linkedin/callback");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(JSON.stringify(body)).not.toMatch(/secret|v1:/i);
});

it("saves a client id with an optional secret and never echoes the secret", async () => {
  const response = await PUT(put({ clientId: "app-a", clientSecret: "li-secret-aaaa" }));
  expect(mocks.save).toHaveBeenCalledWith("owner-a", { clientId: "app-a", clientSecret: "li-secret-aaaa" });
  expect(JSON.stringify(await response.json())).not.toContain("li-secret-aaaa");
});

it("rejects malformed input with a coded error and no provider detail", async () => {
  const response = await PUT(put({ clientId: "" }));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "LINKEDIN_APP_INVALID_INPUT" });
  expect(mocks.save).not.toHaveBeenCalled();
});

it("removes credentials with no content", async () => {
  const response = await DELETE();
  expect(response.status).toBe(204);
  expect(mocks.remove).toHaveBeenCalledWith("owner-a");
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- --run src/app/api/settings/linkedin/route.test.ts`

Expected: FAIL — the route does not exist.

- [ ] **Step 3: Implement the route**

Create `src/app/api/settings/linkedin/route.ts`:

```ts
import { ZodError, z } from "zod";
import { requireUser } from "../../../../server/auth/require-user";
import { errorResponse } from "../../../../server/auth/http-error";
import { readServerConfig } from "../../../../server/config";
import { getSafeLinkedInCredentials, removeLinkedInCredentials, saveLinkedInCredentials } from "../../../../features/settings/linkedin-credentials";

const updateCredentials = z.object({
  clientId: z.string().trim().min(1).max(200),
  clientSecret: z.string().trim().min(8).max(500).optional(),
});

/** Always the server's own callback. A user-supplied value would be an open redirect. */
function redirectUri(): string {
  return new URL("/api/linkedin/callback", readServerConfig("app").APP_URL).toString();
}

export async function GET() {
  try {
    const user = await requireUser();
    const credentials = await getSafeLinkedInCredentials(user.id);
    return Response.json({ ...credentials, redirectUri: redirectUri() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const input = updateCredentials.parse(await request.json());
    return Response.json(await saveLinkedInCredentials(user.id, input));
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ error: "Check the Client ID and Client Secret.", code: "LINKEDIN_APP_INVALID_INPUT" }, { status: 400 });
    }
    return errorResponse(error);
  }
}

export async function DELETE() {
  try {
    const user = await requireUser();
    await removeLinkedInCredentials(user.id);
    return new Response(null, { status: 204 });
  } catch (error) { return errorResponse(error); }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -- --run src/app/api/settings/linkedin/route.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/settings/linkedin
git commit -m "feat: add the LinkedIn credential settings API"
```

---

### Task 5: Per-owner OAuth begin and callback

**Files:**
- Modify: `src/server/linkedin/oauth.ts`
- Modify: `src/server/linkedin/oauth.test.ts`

**Interfaces:**
- Consumes: `getLinkedInAppCredentials`, `markLinkedInCredentialsValid`, `markLinkedInCredentialsInvalid`, `LINKEDIN_ERROR_CODES`, `getSafeLinkedInCredentials` (Task 3).
- Produces: `ConnectionStatus.status` gains `"app_required"`; `linkedin_connections.client_id` and `.scopes` are written on connect.

- [ ] **Step 1: Rewrite the OAuth test around per-owner applications**

In `src/server/linkedin/oauth.test.ts`, delete the four `vi.stubEnv("LINKEDIN_CLIENT_ID"|"LINKEDIN_CLIENT_SECRET"|"LINKEDIN_REDIRECT_URI", …)` lines from the database-backed test and replace that test with the following. Keep the two non-database tests (`"builds the authorization URL…"` and `"retrieves the OpenID subject…"`) as they are.

```ts
it.skipIf(!process.env.TEST_DATABASE_URL)("runs the whole flow against the owner's own application", async () => {
  const owner = randomUUID(), other = randomUUID();
  const pool = getPool();
  vi.stubEnv("LINKEDIN_TOKEN_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("LINKEDIN_VERSION", "202608");
  try {
    await pool.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now()),($3,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$4,'',now(),now())", [owner,`${owner}@test.local`,other,`${other}@test.local`]);

    // No application: there is nothing to authorize against.
    await expect(beginLinkedInConnect(owner)).rejects.toMatchObject({ code: "LINKEDIN_APP_REQUIRED" });
    expect(await getConnectionStatus(owner)).toEqual({ status: "app_required" });

    await saveLinkedInCredentials(owner, { clientId: "owner-app", clientSecret: "li-secret-aaaa" });
    expect(await getConnectionStatus(owner)).toEqual({ status: "disconnected" });

    const url = await beginLinkedInConnect(owner);
    expect(url.searchParams.get("client_id")).toBe("owner-app");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/linkedin/callback");
    const state = url.searchParams.get("state")!;
    await expect(finishLinkedInConnect(other, state, "code")).rejects.toThrow();

    // The exchange uses the owner's own client id and secret.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "test-token", expires_in: 3600, scope: "openid profile w_member_social" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sub: "member-id" }) });
    vi.stubGlobal("fetch", fetchMock);
    const result = await finishLinkedInConnect(owner, state, "code");
    expect(result.personUrn).toBe("urn:li:person:member-id");
    const exchangeBody = String(fetchMock.mock.calls[0][1].body);
    expect(exchangeBody).toContain("client_id=owner-app");
    expect(exchangeBody).toContain("client_secret=li-secret-aaaa");

    const connection = await pool.query("select client_id,scopes from public.linkedin_connections where owner_id=$1", [owner]);
    expect(connection.rows[0]).toMatchObject({ client_id: "owner-app", scopes: "openid profile w_member_social" });
    expect((await getSafeLinkedInCredentials(owner)).status).toBe("valid");
  } finally { await pool.query("delete from auth.users where id=any($1::uuid[])", [[owner,other]]); }
});

it.skipIf(!process.env.TEST_DATABASE_URL)("refuses a callback for an application the owner has since replaced", async () => {
  const owner = randomUUID();
  const pool = getPool();
  vi.stubEnv("LINKEDIN_TOKEN_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("APP_URL", "http://localhost:3000");
  try {
    await pool.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now())", [owner,`${owner}@test.local`]);
    await saveLinkedInCredentials(owner, { clientId: "first-app", clientSecret: "li-secret-aaaa" });
    const state = (await beginLinkedInConnect(owner)).searchParams.get("state")!;

    // The user edits Settings in another tab while the browser is at LinkedIn.
    await saveLinkedInCredentials(owner, { clientId: "second-app", clientSecret: "li-secret-bbbb" });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(finishLinkedInConnect(owner, state, "code")).rejects.toMatchObject({ code: "LINKEDIN_APP_CHANGED" });
    expect(fetchMock).not.toHaveBeenCalled();
  } finally { await pool.query("delete from auth.users where id=$1", [owner]); }
});

it.skipIf(!process.env.TEST_DATABASE_URL)("marks credentials invalid when LinkedIn rejects the application", async () => {
  const owner = randomUUID();
  const pool = getPool();
  vi.stubEnv("LINKEDIN_TOKEN_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("APP_URL", "http://localhost:3000");
  try {
    await pool.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now())", [owner,`${owner}@test.local`]);
    await saveLinkedInCredentials(owner, { clientId: "owner-app", clientSecret: "li-secret-wrong" });
    const state = (await beginLinkedInConnect(owner)).searchParams.get("state")!;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "invalid_client" }), text: async () => "invalid_client" }));

    await expect(finishLinkedInConnect(owner, state, "code")).rejects.toMatchObject({ code: "LINKEDIN_APP_INVALID" });
    expect((await getSafeLinkedInCredentials(owner)).status).toBe("invalid");
  } finally { await pool.query("delete from auth.users where id=$1", [owner]); }
});
```

Add `getConnectionStatus` to the existing `from "./oauth"` import line rather than writing a second import from the same module, and add one new import:

```ts
import { beginLinkedInConnect, buildLinkedInAuthorizationUrl, fetchLinkedInMemberSub, finishLinkedInConnect, getConnectionStatus } from "./oauth";
import { getSafeLinkedInCredentials, saveLinkedInCredentials } from "../../features/settings/linkedin-credentials";
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `TEST_DATABASE_URL=1 DATABASE_URL=postgresql://postgres:cadence_test_only@127.0.0.1:55439/cadence_test2 npm test -- --run src/server/linkedin/oauth.test.ts`

Expected: FAIL — `beginLinkedInConnect` still reads `readServerConfig("linkedin")`, which no longer exists after Task 2, and `app_required` is not a status.

- [ ] **Step 3: Resolve the owner's application in begin**

In `src/server/linkedin/oauth.ts`, replace `beginLinkedInConnect` and add the redirect helper:

```ts
function callbackUrl(): string {
  return new URL("/api/linkedin/callback", readServerConfig("app").APP_URL).toString();
}

export async function beginLinkedInConnect(ownerId: string): Promise<URL> {
  const credentials = await getLinkedInAppCredentials(ownerId);
  const state = randomBytes(32).toString("base64url");
  await getPool().query(
    "insert into public.oauth_states(state_hash,owner_id,client_id,expires_at) values($1,$2,$3,now()+interval '10 minutes')",
    [hash(state), ownerId, credentials.clientId]
  );
  return buildLinkedInAuthorizationUrl(credentials.clientId, callbackUrl(), state);
}
```

- [ ] **Step 4: Exchange against the recorded application in the callback**

In `finishLinkedInConnect`, extend the state query to return `client_id`, carry it out of the transaction, then exchange with the owner's credentials:

```ts
export async function finishLinkedInConnect(ownerId: string, state: string, code: string): Promise<ConnectionStatus> {
  if (!state || !code) throw new HttpError(400,"Missing LinkedIn authorization response");
  let startedWith: string | null = null;
  await withTransaction(async client => {
    const result = await client.query<{ owner_id: string; client_id: string | null; expires_at: Date; used_at: Date | null }>(
      "select owner_id,client_id,expires_at,used_at from public.oauth_states where state_hash=$1 for update", [hash(state)]
    );
    const saved = result.rows[0];
    if (!saved) throw new HttpError(400,"Invalid LinkedIn connection state");
    if (saved.owner_id !== ownerId) throw new HttpError(403,"LinkedIn connection state belongs to another user");
    if (saved.used_at) throw new HttpError(409,"LinkedIn connection state was already used");
    if (saved.expires_at.getTime() < Date.now()) throw new HttpError(400,"LinkedIn connection state expired");
    startedWith = saved.client_id;
    await client.query("update public.oauth_states set used_at=now() where state_hash=$1", [hash(state)]);
  });

  const credentials = await getLinkedInAppCredentials(ownerId);
  // The user may have changed applications while the browser was at LinkedIn.
  // Exchanging this code against a different application would silently attach
  // a token the user never authorized for it.
  if (startedWith && startedWith !== credentials.clientId) {
    throw new HttpError(409,"Your LinkedIn application changed. Connect again.", LINKEDIN_ERROR_CODES.appChanged);
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code", code,
    client_id: credentials.clientId, client_secret: credentials.clientSecret,
    redirect_uri: callbackUrl(),
  });
  const tokenResponse = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, cache: "no-store",
  });
  if (!tokenResponse.ok) {
    if (tokenResponse.status === 400 || tokenResponse.status === 401) {
      await markLinkedInCredentialsInvalid(ownerId, credentials.revision);
      throw new HttpError(409,"LinkedIn rejected this application's credentials. Replace the Client Secret in Settings.", LINKEDIN_ERROR_CODES.appInvalid);
    }
    throw new HttpError(502,"LinkedIn token exchange failed. Reconnect and try again.");
  }
  const token = tokenSchema.parse(await tokenResponse.json());
  const personUrn = `urn:li:person:${await fetchLinkedInMemberSub(token.access_token)}`;
  const expiresAt = new Date(Date.now() + token.expires_in * 1000);
  await getPool().query(
    `insert into public.linkedin_connections(owner_id,person_urn,access_token_encrypted,expires_at,status,client_id,scopes)
     values($1,$2,$3,$4,'connected',$5,$6) on conflict(owner_id) do update set person_urn=excluded.person_urn,
     access_token_encrypted=excluded.access_token_encrypted,expires_at=excluded.expires_at,status='connected',
     client_id=excluded.client_id,scopes=excluded.scopes,updated_at=now()`,
    [ownerId,personUrn,encryptCredential(token.access_token,{ ownerId, purpose: "linkedin-access-token" }),expiresAt,credentials.clientId,token.scope ?? null]
  );
  await markLinkedInCredentialsValid(ownerId, credentials.revision);
  return { status: "connected", personUrn, expiresAt: expiresAt.toISOString() };
}
```

Widen the token schema to capture granted scopes, and the status union, near the top of the file:

```ts
const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().positive(), scope: z.string().optional() });

export type ConnectionStatus = { status: "app_required" | "disconnected" | "connected" | "expired" | "revoked"; personUrn?: string; expiresAt?: string };
```

Add the imports:

```ts
import { getLinkedInAppCredentials, markLinkedInCredentialsInvalid, markLinkedInCredentialsValid, LINKEDIN_ERROR_CODES } from "../../features/settings/linkedin-credentials";
```

- [ ] **Step 5: Distinguish "no application" from "not connected" in status**

Replace the early return in `getConnectionStatus`:

```ts
  const connection = result.rows[0];
  if (!connection) {
    // "Connect your account" is misleading when there is no application to
    // connect through. Tell the user which of the two things is missing.
    const credentials = await getSafeLinkedInCredentials(ownerId);
    return { status: credentials.status === "not_configured" ? "app_required" : "disconnected" };
  }
```

Add `getSafeLinkedInCredentials` to the import added in Step 4.

- [ ] **Step 6: Run the OAuth tests and confirm they pass**

Run: `TEST_DATABASE_URL=1 DATABASE_URL=postgresql://postgres:cadence_test_only@127.0.0.1:55439/cadence_test2 npm test -- --run src/server/linkedin`

Expected: PASS, including every existing assertion in `publisher.test.ts` unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/server/linkedin/oauth.ts src/server/linkedin/oauth.test.ts
git commit -m "feat: run LinkedIn OAuth against each owner's own application"
```

---

### Task 6: Refuse to publish through an unapproved application

**Files:**
- Modify: `src/server/linkedin/oauth.ts` (`getLinkedInConnection` only)
- Modify: `src/server/linkedin/publisher.test.ts`

**Interfaces:**
- Consumes: `linkedin_connections.scopes` (Task 1), `LINKEDIN_ERROR_CODES.scopeMissing` (Task 3).
- Produces: `getLinkedInConnection` throws `409 LINKEDIN_SCOPE_MISSING` for a connection granted without `w_member_social`.

- [ ] **Step 1: Write the failing publish-gate test**

Append to `src/server/linkedin/publisher.test.ts`:

```ts
it.skipIf(!process.env.TEST_DATABASE_URL)("refuses to publish through an application without Share on LinkedIn", async () => {
  const owner = randomUUID();
  const pool = getPool();
  vi.stubEnv("LINKEDIN_TOKEN_KEY", randomBytes(32).toString("base64"));
  try {
    await pool.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now())", [owner,`${owner}@test.local`]);
    await pool.query(
      `insert into public.linkedin_connections(owner_id,person_urn,access_token_encrypted,expires_at,status,client_id,scopes)
       values($1,'urn:li:person:m',$2,now()+interval '30 days','connected','owner-app','openid profile')`,
      [owner, encryptCredential("test-token", { ownerId: owner, purpose: "linkedin-access-token" })]
    );
    await expect(getLinkedInConnection(owner)).rejects.toMatchObject({
      code: "LINKEDIN_SCOPE_MISSING", status: 409,
    });

    // A connection from before scopes were recorded is not second-guessed.
    await pool.query("update public.linkedin_connections set scopes=null where owner_id=$1", [owner]);
    expect((await getLinkedInConnection(owner)).personUrn).toBe("urn:li:person:m");
  } finally { await pool.query("delete from auth.users where id=$1", [owner]); }
});
```

Add whatever of `randomBytes`, `randomUUID`, `getPool`, `encryptCredential` and `getLinkedInConnection` that file does not already import.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `TEST_DATABASE_URL=1 DATABASE_URL=postgresql://postgres:cadence_test_only@127.0.0.1:55439/cadence_test2 npm test -- --run src/server/linkedin/publisher.test.ts`

Expected: FAIL — the connection is returned instead of refused.

- [ ] **Step 3: Add the gate**

In `getLinkedInConnection`, after the existing expiry check and before returning, add:

```ts
  // A brand-new LinkedIn application often has Sign In approved and Share on
  // LinkedIn still pending. Saying so here beats a bare 403 at post time.
  // A null `scopes` means the grant predates this column: trust it and let
  // LinkedIn decide.
  if (connection.scopes !== null && !connection.scopes.split(" ").includes("w_member_social")) {
    throw new HttpError(409,"Your LinkedIn application is not approved for Share on LinkedIn yet. Request that product, then reconnect.", LINKEDIN_ERROR_CODES.scopeMissing);
  }
```

Extend that function's `select` and its row type to include `scopes`.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `TEST_DATABASE_URL=1 DATABASE_URL=postgresql://postgres:cadence_test_only@127.0.0.1:55439/cadence_test2 npm test -- --run src/server/linkedin`

Expected: PASS, with the duplicate-publish and uncertain-outcome assertions unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/server/linkedin/oauth.ts src/server/linkedin/publisher.test.ts
git commit -m "feat: refuse publishing through an unapproved LinkedIn application"
```

---

### Task 7: Guided Settings panel and editor distinction

**Files:**
- Modify: `src/features/settings/settings-page.tsx`
- Modify: `src/features/settings/settings-page.test.tsx`
- Modify: `src/features/drafts/editor.tsx`
- Modify: `src/features/drafts/editor.test.tsx`

**Interfaces:**
- Consumes: `GET/PUT/DELETE /api/settings/linkedin` (Task 4); `app_required` from `/api/linkedin/status` (Task 5).
- Produces: no new module exports.

- [ ] **Step 1: Write the failing Settings panel tests**

Append to `src/features/settings/settings-page.test.tsx`. Match the file's existing fetch-stubbing helper; the page requests `/api/settings/ai/models`, `/api/settings/ai`, `/api/linkedin/status` and now `/api/settings/linkedin`, so route the stub by URL rather than by call order:

```ts
it("walks an unconfigured user through creating a LinkedIn application", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.startsWith("/api/settings/ai/models")) return { ok: true, json: async () => ({ models: [{ id: "claude-sonnet-5", label: "Sonnet 5", roles: ["research","writing"], recommended: true }] }) };
    if (url.startsWith("/api/settings/ai")) return { ok: true, json: async () => ({ status: "valid", keySuffix: "aaaa", researchModel: "claude-sonnet-5", writingModel: "claude-sonnet-5" }) };
    if (url.startsWith("/api/settings/linkedin")) return { ok: true, json: async () => ({ status: "not_configured", redirectUri: "https://cadence.example/api/linkedin/callback" }) };
    return { ok: true, json: async () => ({ status: "app_required" }) };
  }));
  render(<SettingsPage />);
  expect(await screen.findByText(/Create an application/i)).toBeInTheDocument();
  expect(screen.getByText(/Company Page/i)).toBeInTheDocument();
  expect(screen.getByText(/Share on LinkedIn/i)).toBeInTheDocument();
  expect(screen.getByDisplayValue("https://cadence.example/api/linkedin/callback")).toHaveAttribute("readonly");
  expect(screen.getByLabelText("LinkedIn Client ID")).toBeInTheDocument();
  expect(screen.getByLabelText("LinkedIn Client Secret")).toHaveAttribute("type", "password");
  expect(screen.queryByRole("link", { name: /Connect LinkedIn/i })).not.toBeInTheDocument();
});

it("offers Connect once credentials are stored and never shows the secret", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.startsWith("/api/settings/ai/models")) return { ok: true, json: async () => ({ models: [] }) };
    if (url.startsWith("/api/settings/ai")) return { ok: true, json: async () => ({ status: "valid", keySuffix: "aaaa" }) };
    if (url.startsWith("/api/settings/linkedin")) return { ok: true, json: async () => ({ status: "unchecked", clientId: "owner-app", secretSuffix: "aaaa", redirectUri: "https://cadence.example/api/linkedin/callback" }) };
    return { ok: true, json: async () => ({ status: "disconnected" }) };
  }));
  render(<SettingsPage />);
  expect(await screen.findByText("owner-app")).toBeInTheDocument();
  expect(screen.getByText(/••••aaaa|aaaa$/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Connect LinkedIn/i })).toHaveAttribute("href", "/api/linkedin/connect");
  expect(screen.getByRole("button", { name: /Remove credentials/i })).toBeInTheDocument();
});

it("explains rejected credentials without provider detail", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.startsWith("/api/settings/ai/models")) return { ok: true, json: async () => ({ models: [] }) };
    if (url.startsWith("/api/settings/ai")) return { ok: true, json: async () => ({ status: "valid", keySuffix: "aaaa" }) };
    if (url.startsWith("/api/settings/linkedin")) return { ok: true, json: async () => ({ status: "invalid", clientId: "owner-app", secretSuffix: "aaaa", redirectUri: "https://cadence.example/api/linkedin/callback" }) };
    return { ok: true, json: async () => ({ status: "disconnected" }) };
  }));
  render(<SettingsPage />);
  expect(await screen.findByText(/Needs attention/i)).toBeInTheDocument();
  expect(screen.getByText(/rejected/i)).toBeInTheDocument();
});
```

Append to `src/features/drafts/editor.test.tsx`:

```ts
it("asks for a LinkedIn application when the owner has none", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => review })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "app_required" }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<DraftEditor draftId="draft-1" />);
  expect(await screen.findByText(/Add your LinkedIn app/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  expect(screen.getByRole("button", { name: "Publish now" })).toBeDisabled();
});
```

- [ ] **Step 2: Run the UI tests and confirm they fail**

Run: `npm test -- --run src/features/settings/settings-page.test.tsx src/features/drafts/editor.test.tsx`

Expected: FAIL — the checklist, the credential form and the `app_required` copy do not exist.

- [ ] **Step 3: Load credentials alongside the connection**

In `src/features/settings/settings-page.tsx`, add the type and state, and extend the existing `Promise.all` in the `useEffect` to a fourth request for `/api/settings/linkedin` with `cache: "no-store"`, setting it into state next to `setLinkedin(connection)`:

```ts
type LinkedInCredentials = {
  status: "not_configured" | "unchecked" | "valid" | "invalid";
  clientId?: string;
  secretSuffix?: string;
  validatedAt?: string;
  redirectUri: string;
};
```

```ts
const [app, setApp] = useState<LinkedInCredentials | null>(null);
const [clientId, setClientId] = useState("");
const [clientSecret, setClientSecret] = useState("");
const [appEditing, setAppEditing] = useState(false);
```

Extend `SAFE_ERRORS` with the codes from Task 3 and Task 4:

```ts
  LINKEDIN_APP_REQUIRED: "Enter both your LinkedIn Client ID and Client Secret.",
  LINKEDIN_APP_INVALID: "LinkedIn rejected this application. Check the Client Secret belongs to this same application.",
  LINKEDIN_APP_CHANGED: "Your LinkedIn application changed. Connect again.",
  LINKEDIN_APP_INVALID_INPUT: "Check the Client ID and Client Secret.",
  LINKEDIN_SCOPE_MISSING: "Request the Share on LinkedIn product for your application, then reconnect.",
```

- [ ] **Step 4: Add save and remove handlers for the application**

```ts
async function saveApp(event: FormEvent) {
  event.preventDefault();
  setBusy(true); setError("");
  try {
    const payload: { clientId: string; clientSecret?: string } = { clientId: clientId.trim() };
    if (clientSecret.trim()) payload.clientSecret = clientSecret.trim();
    const saved = await readJson<LinkedInCredentials>(await fetch("/api/settings/linkedin", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    }));
    setApp({ ...saved, redirectUri: app?.redirectUri ?? saved.redirectUri });
    setClientSecret(""); setAppEditing(false);
  } catch (caught) {
    setError(caught instanceof Error ? caught.message : "Could not save your LinkedIn application.");
  } finally { setBusy(false); }
}

async function removeApp() {
  if (!window.confirm("Remove your LinkedIn application and disconnect your account?")) return;
  setBusy(true); setError("");
  try {
    const response = await fetch("/api/settings/linkedin", { method: "DELETE" });
    if (!response.ok) await readJson(response);
    setApp(current => current && { status: "not_configured", redirectUri: current.redirectUri });
    setLinkedin({ status: "app_required" });
    setClientId(""); setClientSecret(""); setAppEditing(true);
  } catch (caught) {
    setError(caught instanceof Error ? caught.message : "Could not remove your LinkedIn application.");
  } finally { setBusy(false); }
}
```

- [ ] **Step 5: Replace the LinkedIn panel body**

Replace the panel described at `src/features/settings/settings-page.tsx:161` — the heading that reads "Cadence uses its central LinkedIn application" — with the following. It keeps the section wrapper and status-chip classes of the Claude panel above it, and the dense single-line JSX style used throughout this file.

```tsx
<section className="mt-10 rounded-2xl border p-6">
  <div className="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h2 className="text-xl font-semibold">Your LinkedIn application</h2>
      <p className="mt-1 text-sm text-slate-600">Cadence has no LinkedIn application of its own. You create one, and Cadence connects your account through it.</p>
    </div>
    {app && <span className={`rounded-full px-3 py-1 text-sm font-medium ${linkedin?.status === "connected" ? "bg-emerald-100 text-emerald-800" : app.status === "invalid" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}>
      {linkedin?.status === "connected" ? "Connected" : app.status === "invalid" ? "Needs attention" : app.status === "not_configured" ? "Not configured" : "Not connected"}
    </span>}
  </div>

  {!app && !loadingError && <p role="status" className="mt-5 text-slate-600">Loading LinkedIn settings…</p>}

  {app?.status === "invalid" && <p className="mt-5 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">LinkedIn rejected this application&apos;s credentials. Check that the Client Secret was copied from this same application, and that both products were approved.</p>}

  {app && (app.status === "not_configured" || appEditing) && <div className="mt-6">
    <ol className="list-decimal space-y-3 pl-5 text-sm text-slate-700">
      <li>Create an application at <a href="https://www.linkedin.com/developers/apps" target="_blank" rel="noopener noreferrer" className="underline">linkedin.com/developers/apps</a>. LinkedIn requires a Company Page you administer.</li>
      <li>On the application&apos;s <strong>Products</strong> tab, request <strong>Share on LinkedIn</strong> and <strong>Sign In with LinkedIn using OpenID Connect</strong>.</li>
      <li>On the <strong>Auth</strong> tab, add this exact redirect URI:
        <div className="mt-2 flex gap-2">
          <input readOnly value={app.redirectUri} aria-label="Redirect URI to register" className="w-full rounded-lg border bg-slate-50 p-2 font-mono text-xs" />
          <button type="button" onClick={() => void navigator.clipboard?.writeText(app.redirectUri)} className="shrink-0 rounded-lg border px-3 py-2 text-sm">Copy</button>
        </div>
      </li>
      <li>Paste the Client ID and Primary Client Secret below.</li>
    </ol>
    <form onSubmit={saveApp} className="mt-5 grid gap-4 sm:max-w-lg">
      <div>
        <label htmlFor="linkedin-client-id" className="block font-medium">LinkedIn Client ID</label>
        <input id="linkedin-client-id" value={clientId} onChange={event => setClientId(event.target.value)} className="mt-2 w-full rounded-lg border p-3" />
      </div>
      <div>
        <label htmlFor="linkedin-client-secret" className="block font-medium">LinkedIn Client Secret</label>
        <input id="linkedin-client-secret" type="password" value={clientSecret} onChange={event => setClientSecret(event.target.value)} className="mt-2 w-full rounded-lg border p-3" />
        <p className="mt-2 text-sm text-slate-600">Encrypted before it is stored, and used only for your own connection. Cadence never shows it again.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy || !clientId.trim()} className="rounded-lg bg-slate-900 px-5 py-3 text-white disabled:opacity-50">Save credentials</button>
        {app.status !== "not_configured" && <button type="button" onClick={() => { setAppEditing(false); setClientSecret(""); }} className="rounded-lg border px-5 py-3">Cancel</button>}
      </div>
    </form>
  </div>}

  {app && app.status !== "not_configured" && !appEditing && <div className="mt-6">
    <dl className="grid gap-2 text-sm sm:grid-cols-2 sm:max-w-lg">
      <dt className="text-slate-600">Client ID</dt><dd className="font-mono">{app.clientId}</dd>
      <dt className="text-slate-600">Client Secret</dt><dd className="font-mono">••••{app.secretSuffix}</dd>
      {app.validatedAt && <><dt className="text-slate-600">Last connected</dt><dd>{new Date(app.validatedAt).toLocaleString()}</dd></>}
      {linkedin?.expiresAt && <><dt className="text-slate-600">Access expires</dt><dd>{new Date(linkedin.expiresAt).toLocaleDateString()}</dd></>}
    </dl>
    <div className="mt-5 flex flex-wrap gap-3">
      <a href="/api/linkedin/connect" className="rounded-lg bg-slate-900 px-5 py-3 text-white">{linkedin?.status === "connected" ? "Reconnect LinkedIn" : "Connect LinkedIn"}</a>
      <button type="button" onClick={() => setAppEditing(true)} className="rounded-lg border px-5 py-3">Replace secret</button>
      <button type="button" onClick={() => { setClientId(""); setAppEditing(true); }} className="rounded-lg border px-5 py-3">Change application</button>
      <button type="button" onClick={() => void removeApp()} disabled={busy} className="rounded-lg border px-5 py-3 text-red-700 disabled:opacity-50">Remove credentials</button>
    </div>
    <p className="mt-4 text-sm text-slate-600">Publishing requires approving an exact version, then a separate <strong>Publish now</strong> action.</p>
  </div>}

  {error && <p role="alert" className="mt-5 text-red-700">{error}</p>}
</section>
```

When the page first loads with `app.status === "not_configured"`, set `appEditing` to `true` in the same place the existing effect sets `setEditMode(saved.status === "not_configured" ? "key" : null)`, so the checklist is open rather than requiring a click. Populate `clientId` from `saved.clientId ?? ""` there as well; never populate `clientSecret`.

- [ ] **Step 6: Distinguish `app_required` in the draft editor**

In `src/features/drafts/editor.tsx`, replace the boolean `connected` state with the status string so the editor can tell the two cases apart:

```ts
const [connection, setConnection] = useState<"unknown" | "app_required" | "disconnected" | "connected" | "expired" | "revoked">("unknown");
```

Set it from `/api/linkedin/status` in both `load()` and the `useEffect`, replace the two `!connected` / `!connected ||` uses with `connection !== "connected"`, and replace the "Connect your account in Settings." line with:

```tsx
{connection !== "connected" && <p className="mt-2 text-sm">{connection === "app_required"
  ? <>Add your LinkedIn app in <Link href="/settings" className="underline">Settings</Link>.</>
  : <>Connect your account in <Link href="/settings" className="underline">Settings</Link>.</>}</p>}
```

- [ ] **Step 7: Run the UI tests and confirm they pass**

Run: `npm test -- --run src/features/settings src/features/drafts`

Expected: PASS. Every pre-existing assertion in `settings-page.test.tsx` and `editor.test.tsx` must still pass; the editor's existing tests stub `/api/linkedin/status` as `connected`.

- [ ] **Step 8: Commit**

```bash
git add src/features/settings/settings-page.tsx src/features/settings/settings-page.test.tsx src/features/drafts/editor.tsx src/features/drafts/editor.test.tsx
git commit -m "feat: guide each user through their own LinkedIn application"
```

---

### Task 8: Remove the central application, document, and verify the release

**Files:**
- Modify: `.env.example`
- Modify: `src/server/export/user-export.test.ts`
- Modify: `docs/operations.md`
- Modify: `docs/live-release-check.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: no code interfaces.

- [ ] **Step 1: Strengthen the export test**

In `src/server/export/user-export.test.ts`, inside the existing database-backed test that already inserts a `user_ai_settings` row, also insert a LinkedIn credentials row and assert nothing from it reaches either format:

```ts
await pool.query(
  `insert into public.linkedin_app_credentials(owner_id,client_id,client_secret_encrypted,secret_suffix,status)
   values($1,'owner-app',$2,'aaaa','valid')`,
  [owner, encryptCredential("li-secret-aaaa", { ownerId: owner, purpose: "linkedin-client-secret" })]
);
const json = (await exportUserData(owner, "json")).body;
const markdown = (await exportUserData(owner, "markdown")).body;
for (const body of [json, markdown]) {
  expect(body).not.toContain("li-secret-aaaa");
  expect(body).not.toMatch(/client_secret_encrypted|secret_suffix/);
  expect(body).not.toMatch(/v1:[A-Za-z0-9_-]+:/);
}
```

Add `encryptCredential` to that file's imports and stub `LINKEDIN_TOKEN_KEY` alongside the existing `CREDENTIAL_ENCRYPTION_KEY` stub.

- [ ] **Step 2: Run the export test and confirm it passes**

Run: `TEST_DATABASE_URL=1 DATABASE_URL=postgresql://postgres:cadence_test_only@127.0.0.1:55439/cadence_test2 npm test -- --run src/server/export/user-export.test.ts`

Expected: PASS. `exportUserData` selects table by table, so the new table is excluded by construction; this test is the proof, not a change of behaviour. If it fails, a `select *` somewhere is reaching the credentials table and must be narrowed.

- [ ] **Step 3: Remove the central application from configuration**

In `.env.example`, delete the `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` and `LINKEDIN_REDIRECT_URI` lines. Keep `LINKEDIN_TOKEN_KEY` and `LINKEDIN_VERSION`. Add a comment above `LINKEDIN_TOKEN_KEY`:

```
# Encrypts each user's LinkedIn client secret and access token. Cadence has no
# central LinkedIn application; each user supplies their own in Settings.
LINKEDIN_TOKEN_KEY=
```

- [ ] **Step 4: Scan for leftover central-application reads**

Run: `grep -rn 'LINKEDIN_CLIENT_ID\|LINKEDIN_CLIENT_SECRET\|LINKEDIN_REDIRECT_URI\|encryptToken\|decryptToken\|readServerConfig("linkedin")' src/ scripts/ .env.example`

Expected: no output. Any hit is a path still expecting the central application or the deleted crypto module.

Run: `grep -rn 'client_secret' src/ --include=*.ts --include=*.tsx | grep -v '\.test\.'`

Expected: hits only in `src/features/settings/linkedin-credentials.ts` and the token-exchange body in `src/server/linkedin/oauth.ts`.

- [ ] **Step 5: Rewrite the operator documentation**

In `docs/operations.md`, replace the **LinkedIn preflight** section with per-user application instructions: each user creates their own application against a Company Page they administer, requests **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect**, and registers the single redirect URI `<APP_URL>/api/linkedin/callback`; Cadence operates no LinkedIn application and holds no LinkedIn app secret of its own. State that `LINKEDIN_TOKEN_KEY` now encrypts client secrets as well as access tokens and must stay stable, and that rotating it makes every stored LinkedIn credential unreadable — users must re-enter their secret and reconnect. Add the failure table from the spec's *Errors and recovery* section. Add to the **Database and backups** ordering that migration `202609210006` deletes every existing connection and that every user must reconnect afterwards.

In `docs/live-release-check.md`, rewrite step 7 from "Disconnect and reconnect user A's LinkedIn" to a per-user application check: user A creates or reuses a LinkedIn application, pastes its Client ID and Secret into Settings, connects, and the database shows `linkedin_connections.client_id` equal to that application's id; replacing the Client ID with a second application's credentials clears the connection; removing credentials returns the draft editor to "Add your LinkedIn app in Settings". Keep the instruction not to publish during the credential check.

In `README.md`, update any statement that Cadence uses a central LinkedIn application.

- [ ] **Step 6: Run the complete automated verification**

Run each of these and record the result:

```bash
npm test -- --run
TEST_DATABASE_URL=1 DATABASE_URL=postgresql://postgres:cadence_test_only@127.0.0.1:55439/cadence_test2 npm test -- --run
npm run lint
npx tsc --noEmit
npm run build
npm run db:test
```

Expected: every command exits 0; the full suite passes with no skips in the database run; the build lists `/api/settings/linkedin` alongside `/settings`, `/api/settings/ai` and `/api/settings/ai/models`; `db:test` reports 12 passing tests.

Then rebuild the plain-PostgreSQL database from `bootstrap.sql` plus all migrations and run `supabase/plain-postgres-tests/ownership.sql`, expecting exit 0. Confirm the harness still bites: delete the `revoke all on public.linkedin_app_credentials` line from migration `202609210006` in a scratch copy, rebuild, and confirm the harness fails with `browser role read private LinkedIn credentials`. Restore the migration.

- [ ] **Step 7: Update the verification record**

Add the observed results to the `## Verification record` section of `docs/operations.md`, including that a live per-user LinkedIn connection check remains required with a real LinkedIn application before admitting beta users.

- [ ] **Step 8: Commit**

```bash
git add .env.example README.md docs/operations.md docs/live-release-check.md src/server/export/user-export.test.ts
git commit -m "docs: remove the central LinkedIn application from configuration and operations"
```

---

## Final review gate

- [ ] Compare every acceptance criterion in the design spec with Tasks 1–8.
- [ ] Confirm no production path reads `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, or `LINKEDIN_REDIRECT_URI`.
- [ ] Confirm the credentials API never returns a client secret or its ciphertext.
- [ ] Confirm a LinkedIn access token encrypted for one owner cannot be decrypted in another owner's context.
- [ ] Confirm the duplicate-publish and uncertain-outcome assertions in `publisher.test.ts` pass unchanged.
- [ ] Confirm migration `202609210006` is applied before the new revision serves traffic, and that operators know it deletes existing connections.
- [ ] Run the requesting-code-review skill before declaring the implementation complete.
- [ ] Run the verification-before-completion skill and report exact test, lint, typecheck, build, migration, and pgTAP evidence.
- [ ] Perform the live per-user LinkedIn check from `docs/live-release-check.md` step 7 with a real LinkedIn application.
