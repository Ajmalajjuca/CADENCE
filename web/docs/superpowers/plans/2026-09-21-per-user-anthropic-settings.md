# Per-user Anthropic Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require every Cadence user to configure an encrypted personal Anthropic API key and separate supported research and writing models before creating or revising content.

**Architecture:** Store owner-bound AES-256-GCM ciphertext in private PostgreSQL tables accessed only by server code. Snapshot model choices when a run is queued, then let the worker load the claimed run owner's current key and build an Anthropic client for that run. Keep one central Cadence LinkedIn application and surface its existing OAuth connection in the new Settings page.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, PostgreSQL/Supabase, `@anthropic-ai/sdk`, Zod 4, Vitest, Testing Library, AES-256-GCM from `node:crypto`.

**Spec:** `docs/superpowers/specs/2026-09-21-per-user-anthropic-settings-design.md`

## Global Constraints

- Every new creation and revision must use the authenticated owner's Anthropic key; no platform-key fallback is allowed.
- Keep LinkedIn Client ID and Client Secret in server environment variables and keep the current per-user LinkedIn OAuth flow.
- Use `CREDENTIAL_ENCRYPTION_KEY`, a stable base64 encoding of exactly 32 random bytes, on web and worker services.
- Never return, log, export, or place plaintext keys or stored ciphertext in browser-visible data.
- Use a curated catalog only: `claude-sonnet-5` as the recommended balanced model and `claude-opus-5` as the premium model. Both roles may select either model.
- Validate selected model access with the Anthropic Models API before saving; model validation must not create a paid message.
- Limit credential validation to five attempts per user in a rolling minute.
- Preserve existing drafts, completed runs, approvals, LinkedIn connections, and publication history.
- Preserve exact-version approval followed by a separate **Publish now** action.
- The workspace currently has no valid Git metadata. Run the documented commit steps only if the repository is restored before execution.

## Review Focus

- A user replacing a valid key with an invalid key keeps the valid key and models; Task 4 adds the atomic-replacement integration test.
- A stale worker receiving a 401 after the user has replaced their key cannot invalidate the replacement; Task 6 adds the revision-guard test.
- A guided run resumed after model settings change keeps its original model snapshots; Task 5 adds the snapshot test.
- Concurrent or repeated validation requests cannot exceed five attempts in one rolling minute; Task 4 adds the transactional limiter test.
- A response, export, or error path cannot reveal either plaintext or ciphertext; Tasks 4 and 8 add explicit secret-absence assertions.

---

### Task 1: Private settings schema and run snapshots

**Files:**

- Create: `supabase/migrations/202609210005_user_ai_settings.sql`
- Modify: `supabase/tests/ownership.sql`
- Modify: `supabase/plain-postgres-tests/ownership.sql`
- Modify: `src/server/db/types.ts`

**Interfaces:**

- Produces: `public.user_ai_settings`, `public.ai_validation_limits`, and nullable `creation_runs.research_model`, `writing_model`, and `ai_settings_revision` columns.
- Produces: `UserAiSettingsRow` and the three new `CreationRun` fields for later services.

- [x] **Step 1: Add failing ownership and schema checks**

Extend `supabase/tests/ownership.sql` to plan nine assertions and add:

```sql
select is(
  (select count(*)::int from information_schema.columns
   where table_schema='public' and table_name='creation_runs'
     and column_name in ('research_model','writing_model','ai_settings_revision')),
  3,
  'creation runs carry AI setting snapshots'
);
select is(has_table_privilege('authenticated','public.user_ai_settings','select'), false,
  'authenticated cannot read encrypted AI settings');
select is(has_table_privilege('authenticated','public.ai_validation_limits','select'), false,
  'authenticated cannot read validation counters');
```

In `plain_postgres_ownership.sql`, revoke the two private tables after the broad test grant and assert a browser role cannot read them:

```sql
revoke all on public.user_ai_settings, public.ai_validation_limits from authenticated;
set local role authenticated;
do $$ begin
  begin
    perform * from public.user_ai_settings;
    raise exception 'browser role read private AI settings';
  exception when insufficient_privilege then null; end;
end $$;
```

- [x] **Step 2: Run the database tests and confirm the new checks fail**

Run: `supabase test db`

Expected: FAIL because `user_ai_settings`, `ai_validation_limits`, and the creation-run snapshot columns do not exist.

- [x] **Step 3: Add the migration**

Create `202609210005_user_ai_settings.sql` with:

```sql
create table public.user_ai_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null default 'anthropic' check (provider = 'anthropic'),
  api_key_encrypted text not null,
  key_suffix text not null check (length(key_suffix) = 4),
  research_model text not null,
  writing_model text not null,
  status text not null default 'valid' check (status in ('valid','invalid','unchecked')),
  revision integer not null default 1 check (revision > 0),
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_validation_limits (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  updated_at timestamptz not null default now()
);

alter table public.creation_runs
  add column research_model text,
  add column writing_model text,
  add column ai_settings_revision integer check (ai_settings_revision is null or ai_settings_revision > 0);

alter table public.user_ai_settings enable row level security;
alter table public.ai_validation_limits enable row level security;
revoke all on public.user_ai_settings, public.ai_validation_limits from public, anon, authenticated;
```

Keep snapshot columns nullable so completed legacy runs remain readable. New application code will require all three values for newly queued runs.

- [x] **Step 4: Add matching TypeScript row types**

Add to `src/server/db/types.ts`:

```ts
export interface UserAiSettingsRow {
  owner_id: string;
  provider: "anthropic";
  api_key_encrypted: string;
  key_suffix: string;
  research_model: string;
  writing_model: string;
  status: "valid" | "invalid" | "unchecked";
  revision: number;
  validated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
```

Add to `CreationRun`:

```ts
research_model: string | null;
writing_model: string | null;
ai_settings_revision: number | null;
```

- [x] **Step 5: Run schema verification**

Run: `supabase test db`

Expected: PASS, including private-table privilege checks and creation-run snapshot columns.

- [ ] **Step 6: Commit if Git is available**

```bash
git add supabase/migrations/202609210005_user_ai_settings.sql supabase/tests/ownership.sql supabase/plain-postgres-tests/ownership.sql src/server/db/types.ts
git commit -m "feat: add private per-user AI settings schema"
```

### Task 2: Owner-bound credential encryption and server configuration

**Files:**

- Create: `src/server/credentials/crypto.ts`
- Create: `src/server/credentials/crypto.test.ts`
- Modify: `src/server/config.ts`
- Modify: `src/server/config.test.ts`
- Modify: `.env.example`

**Interfaces:**

- Produces: `encryptCredential(plaintext, context): string` and `decryptCredential(stored, context): string`.
- Produces: `CredentialContext = { ownerId: string; purpose: "anthropic-api-key" }`.
- Produces: `readServerConfig("credentials")` and a worker config requiring `DATABASE_URL` plus `CREDENTIAL_ENCRYPTION_KEY`.

- [x] **Step 1: Write failing crypto and configuration tests**

Create `crypto.test.ts`:

```ts
import { afterEach, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { decryptCredential, encryptCredential } from "./crypto";

afterEach(() => vi.unstubAllEnvs());

it("encrypts with fresh ciphertext bound to owner and purpose", () => {
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  const ownerId = randomUUID();
  const context = { ownerId, purpose: "anthropic-api-key" as const };
  const first = encryptCredential("sk-ant-secret", context);
  const second = encryptCredential("sk-ant-secret", context);
  expect(first).not.toBe(second);
  expect(first).not.toContain("sk-ant-secret");
  expect(decryptCredential(first, context)).toBe("sk-ant-secret");
  expect(() => decryptCredential(first, { ...context, ownerId: randomUUID() })).toThrow();
});

it("rejects tampered ciphertext", () => {
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  const context = { ownerId: randomUUID(), purpose: "anthropic-api-key" as const };
  const encrypted = encryptCredential("sk-ant-secret", context);
  expect(() => decryptCredential(`${encrypted}x`, context)).toThrow();
});
```

Replace `config.test.ts` expectations so worker mode fails on a missing credential key and succeeds without `ANTHROPIC_API_KEY`:

```ts
it("requires the credential key for worker mode without requiring a global Anthropic key", () => {
  vi.stubEnv("DATABASE_URL", "postgres://test");
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  expect(() => readServerConfig("worker")).toThrow(/CREDENTIAL_ENCRYPTION_KEY/);
});

it("accepts worker configuration without a global Anthropic key", () => {
  vi.stubEnv("DATABASE_URL", "postgres://test");
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  expect(readServerConfig("worker").DATABASE_URL).toBe("postgres://test");
});
```

- [x] **Step 2: Run tests and confirm failure**

Run: `npm test -- --run src/server/credentials/crypto.test.ts src/server/config.test.ts`

Expected: FAIL because the credential crypto module and configuration group do not exist.

- [x] **Step 3: Implement authenticated encryption**

Implement `crypto.ts` using `aes-256-gcm`, a random 12-byte IV, and additional authenticated data:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type CredentialContext = { ownerId: string; purpose: "anthropic-api-key" };

function encryptionKey(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) throw new Error("Missing CREDENTIAL_ENCRYPTION_KEY");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32) throw new Error("CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes");
  return decoded;
}

function aad(context: CredentialContext): Buffer {
  return Buffer.from(`${context.ownerId}:${context.purpose}`, "utf8");
}

export function encryptCredential(plaintext: string, context: CredentialContext): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(aad(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptCredential(stored: string, context: CredentialContext): string {
  const [version, iv, tag, ciphertext] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Invalid encrypted credential format");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAAD(aad(context));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
```

- [x] **Step 4: Update configuration groups and environment example**

Change `src/server/config.ts` groups to include:

```ts
credentials: ["CREDENTIAL_ENCRYPTION_KEY"],
worker: ["DATABASE_URL", "CREDENTIAL_ENCRYPTION_KEY"],
```

Keep the temporary `ai` group until Task 6 removes the last environment-based worker caller. Add this to `.env.example` without a value:

```env
CREDENTIAL_ENCRYPTION_KEY=
```

- [x] **Step 5: Run focused tests**

Run: `npm test -- --run src/server/credentials/crypto.test.ts src/server/config.test.ts`

Expected: PASS with wrong-owner and tamper checks.

- [ ] **Step 6: Commit if Git is available**

```bash
git add src/server/credentials src/server/config.ts src/server/config.test.ts .env.example
git commit -m "feat: add owner-bound credential encryption"
```

### Task 3: Curated model catalog and safe Anthropic validation

**Files:**

- Create: `src/server/ai/model-catalog.ts`
- Create: `src/server/ai/model-catalog.test.ts`
- Create: `src/server/ai/provider-errors.ts`
- Create: `src/server/ai/provider-errors.test.ts`
- Create: `src/server/ai/validate-credentials.ts`
- Create: `src/server/ai/validate-credentials.test.ts`
- Modify: `src/server/ai/claude.ts`
- Modify: `src/server/ai/claude.test.ts`
- Modify: `src/server/auth/http-error.ts`
- Modify: `src/worker/main.ts`

**Interfaces:**

- Produces: `listModels(role?)`, `requireAllowedModel(id, role)`, and `AiModelRole`.
- Produces: `validateAnthropicCredentials(apiKey, researchModel, writingModel): Promise<void>`.
- Produces: `AiServiceError` with a stable `code` and `mapAnthropicError(error)`.
- Changes: `AnthropicTransport` and `createCadenceAi` require explicit credentials and model IDs.

- [x] **Step 1: Write failing catalog, validation, and provider-error tests**

Pin the catalog behavior:

```ts
expect(listModels("research").map(model => model.id)).toEqual(["claude-sonnet-5", "claude-opus-5"]);
expect(requireAllowedModel("claude-sonnet-5", "writing").recommended).toBe(true);
expect(() => requireAllowedModel("claude-retired", "research")).toThrow(/supported/i);
```

Inject a fake Models API into credential validation and verify both models are checked without a Messages API call:

```ts
const retrieve = vi.fn().mockResolvedValue({ capabilities: { structured_outputs: { supported: true } } });
await validateAnthropicCredentials("sk-ant-test", "claude-sonnet-5", "claude-opus-5", { retrieve });
expect(retrieve).toHaveBeenCalledTimes(2);
```

Pin sanitized error mapping:

```ts
const mapped = mapAnthropicError({ status: 401, message: "bad key sk-ant-secret" });
expect(mapped).toMatchObject({ code: "AI_SETTINGS_INVALID", message: "Your Anthropic API key was rejected." });
expect(mapped.message).not.toContain("sk-ant-secret");
```

Update `claude.test.ts` to assert explicit construction:

```ts
expect(() => createCadenceAi({ apiKey: "", researchModel: "claude-sonnet-5", writingModel: "claude-sonnet-5" })).toThrow();
```

- [x] **Step 2: Run focused tests and confirm failure**

Run: `npm test -- --run src/server/ai/model-catalog.test.ts src/server/ai/provider-errors.test.ts src/server/ai/validate-credentials.test.ts src/server/ai/claude.test.ts`

Expected: FAIL because the catalog, validator, and explicit factory do not exist.

- [x] **Step 3: Add coded HTTP errors and implement the curated catalog**

Extend `HttpError` without breaking existing two-argument callers:

```ts
export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message);
    this.name = "HttpError";
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status });
  }
  return Response.json({ error: "Unexpected server error" }, { status: 500 });
}
```

Use one immutable catalog:

```ts
export type AiModelRole = "research" | "writing";
export type AiModelOption = {
  id: string; label: string; description: string;
  roles: readonly AiModelRole[]; recommended: boolean;
};

export const AI_MODEL_CATALOG = [
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", description: "Fast, balanced quality and cost", roles: ["research","writing"], recommended: true },
  { id: "claude-opus-5", label: "Claude Opus 5", description: "Higher quality with higher cost", roles: ["research","writing"], recommended: false },
] as const satisfies readonly AiModelOption[];
```

`requireAllowedModel` throws `new HttpError(400, "Choose a supported Claude model", "AI_MODEL_NOT_ALLOWED")`.

- [x] **Step 4: Implement validation and safe error mapping**

Use `new Anthropic({ apiKey }).models.retrieve(modelId)` for each distinct selected model. Require `capabilities?.structured_outputs?.supported !== false`; catalog membership already guarantees research-tool eligibility. Map status 401 to `AI_SETTINGS_INVALID`, 403/404 to `AI_MODEL_UNAVAILABLE`, 429 to `AI_RATE_LIMITED`, billing/credit 400 responses to `AI_CREDIT_REQUIRED`, and 5xx/network failures to `AI_PROVIDER_UNAVAILABLE`. Each mapped error has a fixed message and retains only safe status and provider request ID metadata.

Define the stable error type explicitly:

```ts
export type AiErrorCode =
  | "AI_SETTINGS_REQUIRED" | "AI_SETTINGS_INVALID" | "AI_MODEL_NOT_ALLOWED"
  | "AI_MODEL_UNAVAILABLE" | "AI_RATE_LIMITED" | "AI_CREDIT_REQUIRED"
  | "AI_PROVIDER_UNAVAILABLE";

export class AiServiceError extends Error {
  constructor(public readonly code: AiErrorCode, message: string, public readonly providerRequestId?: string) {
    super(message);
    this.name = "AiServiceError";
  }
}
```

- [x] **Step 5: Make Claude construction explicit**

Change `AnthropicTransport` to require `apiKey: string` and replace the environment-reading factory with:

```ts
export type CadenceAiConfig = { apiKey: string; researchModel: string; writingModel: string };

export function createCadenceAi(config: CadenceAiConfig): CadenceAi {
  if (!config.apiKey) throw new Error("Anthropic API key is required");
  requireAllowedModel(config.researchModel, "research");
  requireAllowedModel(config.writingModel, "writing");
  return new CadenceAi(new AnthropicTransport(config.apiKey), config.researchModel, config.writingModel);
}
```

Keep the worker compiling at this intermediate point by reading the temporary `ai` config group in `src/worker/main.ts` and passing all three values explicitly to `createCadenceAi`. Task 6 replaces that startup client with owner-specific settings and removes this temporary environment read.

Wrap Anthropic calls in `try/catch` and rethrow `mapAnthropicError(error)` so raw SDK error bodies never reach run records.

- [x] **Step 6: Run focused tests**

Run: `npm test -- --run src/server/ai/model-catalog.test.ts src/server/ai/provider-errors.test.ts src/server/ai/validate-credentials.test.ts src/server/ai/claude.test.ts`

Expected: PASS; catalog rejection, no-message validation, and sanitized provider mappings are covered.

- [ ] **Step 7: Commit if Git is available**

```bash
git add src/server/ai src/server/auth/http-error.ts src/worker/main.ts
git commit -m "feat: validate curated Claude models safely"
```

### Task 4: AI settings service and authenticated API

**Files:**

- Create: `src/features/settings/ai-settings.ts`
- Create: `src/features/settings/ai-settings.integration.test.ts`
- Create: `src/app/api/settings/ai/route.ts`
- Create: `src/app/api/settings/ai/models/route.ts`
- Create: `src/app/api/settings/ai/route.test.ts`

**Interfaces:**

- Produces: `SafeAiSettings`, `AiRuntimeSettings`, `getSafeAiSettings`, `getValidAiSettingsSnapshot`, `saveAiSettings`, `removeAiSettings`, `getAiRuntimeSettings`, and `markAiSettingsInvalid`.
- Produces: JSON errors shaped as `{ error: string, code?: string }`.
- Consumes: encryption from Task 2 and validation/catalog functions from Task 3.

- [x] **Step 1: Write failing service integration tests**

Create two test users and verify:

```ts
const validator = vi.fn().mockResolvedValue(undefined);
const saved = await saveAiSettings(ownerA, {
  apiKey: "sk-ant-owner-a", researchModel: "claude-sonnet-5", writingModel: "claude-opus-5",
}, validator);
expect(saved).toMatchObject({ status: "valid", keySuffix: "er-a", researchModel: "claude-sonnet-5" });
expect(JSON.stringify(saved)).not.toContain("sk-ant-owner-a");
expect(JSON.stringify(saved)).not.toContain("v1:");
await expect(getAiRuntimeSettings(ownerB)).rejects.toMatchObject({ code: "AI_SETTINGS_REQUIRED" });
```

Test atomic replacement by saving a valid key, making the validator reject a replacement, then asserting `getAiRuntimeSettings(ownerA).apiKey` is still the original key. Test model-only updates, wrong-owner isolation, removal blocked by a `waiting_for_user` run, and conditional invalidation:

```ts
const runtime = await getAiRuntimeSettings(ownerA);
await markAiSettingsInvalid(ownerA, runtime.revision - 1);
expect((await getSafeAiSettings(ownerA)).status).toBe("valid");
await markAiSettingsInvalid(ownerA, runtime.revision);
expect((await getSafeAiSettings(ownerA)).status).toBe("invalid");
```

Test six concurrent `consumeValidationAttempt(ownerA)` calls with `Promise.allSettled`; exactly five fulfill and one rejects with HTTP 429.

- [x] **Step 2: Write failing route tests**

Mock `requireUser` and the service. Assert `GET` returns only safe fields, `PUT` rejects an unknown model with `AI_MODEL_NOT_ALLOWED`, `DELETE` surfaces active-run conflicts, and the models route returns only catalog metadata. Add an assertion that serialized route bodies contain neither `apiKey` nor `api_key_encrypted`.

- [x] **Step 3: Run focused tests and confirm failure**

Run: `npm test -- --run src/features/settings/ai-settings.integration.test.ts src/app/api/settings/ai/route.test.ts`

Expected: FAIL because the settings service and routes do not exist.

- [x] **Step 4: Implement the settings service**

Define:

```ts
export type SafeAiSettings = {
  status: "not_configured" | "valid" | "invalid" | "unchecked";
  keySuffix?: string;
  researchModel?: string;
  writingModel?: string;
  validatedAt?: string;
};

export type AiSettingsSnapshot = {
  researchModel: string;
  writingModel: string;
  revision: number;
};

export type AiRuntimeSettings = {
  apiKey: string;
  researchModel: string;
  writingModel: string;
  revision: number;
};
```

Use `INSERT ... ON CONFLICT(owner_id) DO UPDATE` with `revision=user_ai_settings.revision+1` only after validation succeeds. `getValidAiSettingsSnapshot` requires `status='valid'` and returns only the two model IDs and revision. `getAiRuntimeSettings` selects one owner's row, requires `status='valid'`, and decrypts with owner-bound context. `markAiSettingsInvalid` updates only `where owner_id=$1 and revision=$2`. `removeAiSettings` uses a transaction, checks statuses `queued`, `running`, and `waiting_for_user`, then deletes only the settings row. Keep the validation-limit row so DELETE cannot reset the rate limit; it disappears automatically when the auth user is deleted.

Implement the limiter atomically:

```sql
insert into public.ai_validation_limits(owner_id,window_started_at,attempts)
values($1,now(),1)
on conflict(owner_id) do update set
  window_started_at = case when ai_validation_limits.window_started_at <= now()-interval '1 minute' then now() else ai_validation_limits.window_started_at end,
  attempts = case when ai_validation_limits.window_started_at <= now()-interval '1 minute' then 1 else ai_validation_limits.attempts+1 end,
  updated_at = now()
returning attempts
```

Reject returned values above five with `new HttpError(429, "Too many validation attempts. Wait one minute and try again.", "AI_RATE_LIMITED")`.

- [x] **Step 5: Implement routes and schemas**

Use a Zod schema:

```ts
const updateAiSettings = z.object({
  apiKey: z.string().trim().min(8).max(500).optional(),
  researchModel: z.string().min(1).max(100),
  writingModel: z.string().min(1).max(100),
});
```

Every handler begins with `requireUser()`. `GET /api/settings/ai` sets `Cache-Control: no-store`. `PUT` consumes one validation attempt, then calls `saveAiSettings`. The models route returns `{ models: listModels() }` with `Cache-Control: public, max-age=300`.

- [x] **Step 6: Run focused tests**

Run: `TEST_DATABASE_URL=1 DATABASE_URL=postgresql://postgres:cadence_test_only@127.0.0.1:55439/cadence_test2 npm test -- --run src/features/settings/ai-settings.integration.test.ts src/app/api/settings/ai/route.test.ts`

Expected: PASS with the test database running and migration applied.

- [ ] **Step 7: Commit if Git is available**

```bash
git add src/features/settings src/app/api/settings
git commit -m "feat: add secure per-user AI settings API"
```

### Task 5: Enforce settings and snapshot models when runs are queued

**Files:**

- Modify: `src/server/db/jobs.ts`
- Modify: `src/server/db/jobs.test.ts`
- Modify: `src/server/jobs/creation-service.ts`
- Modify: `src/server/jobs/creation-service.test.ts`

**Interfaces:**

- Changes: `enqueueCreationRun(ownerId, input, aiSettings)` requires `{ researchModel, writingModel, revision }`.
- Changes: both new-post and revision services call `getValidAiSettingsSnapshot` before enqueueing.
- Produces: newly queued runs always have non-null model snapshots and settings revision.

- [x] **Step 1: Write failing service and enqueue tests**

Add tests that stub settings lookup and assert the enqueue arguments:

```ts
expect(enqueue).toHaveBeenCalledWith(ownerId, expect.objectContaining({ entry: "topic" }), {
  researchModel: "claude-sonnet-5",
  writingModel: "claude-opus-5",
  revision: 3,
});
```

Add missing and invalid cases:

```ts
await expect(startCreationRun(ownerId, validInput)).rejects.toMatchObject({
  status: 409, code: "AI_SETTINGS_REQUIRED",
});
await expect(startRevisionRun(ownerId, draftId, "Shorter")).rejects.toMatchObject({
  status: 409, code: "AI_SETTINGS_INVALID",
});
```

Add an integration assertion that a guided run contains the settings models and revision. Pause it at an owner-choice stage, update that owner's default models, resume the run, and verify its original snapshot remains unchanged while the next new run receives the updated snapshot.

- [x] **Step 2: Run focused tests and confirm failure**

Run: `npm test -- --run src/server/jobs/creation-service.test.ts src/server/db/jobs.test.ts`

Expected: FAIL because enqueueing does not require settings or write snapshots.

- [x] **Step 3: Update enqueueing and creation services**

Import `AiSettingsSnapshot` from the settings service and insert its fields with the creation run. In `startCreationRun`, call `getValidAiSettingsSnapshot` after profile ownership checks and before the daily-limit insert. In `startRevisionRun`, verify draft ownership, then load the safe snapshot and enqueue with the same contract. Neither path decrypts the key.

Do not put the plaintext API key into `EnqueueInput`, SQL parameters, or `creation_runs`; destructure only model IDs and revision from the runtime settings object.

- [x] **Step 4: Preserve snapshots across guided choices and retries**

Confirm `chooseRunIdea`, `chooseRunHook`, and `retryRun` update status/stage only and never rewrite the three snapshot columns. Reject retry of a legacy run whose snapshots are null with `AI_SETTINGS_REQUIRED` rather than silently attaching current models.

- [x] **Step 5: Run focused and database-backed tests**

Run: `npm test -- --run src/server/jobs/creation-service.test.ts src/server/db/jobs.test.ts`

Run with the test database: `TEST_DATABASE_URL=1 DATABASE_URL=postgresql://postgres:cadence_test_only@127.0.0.1:55439/cadence_test2 npm test -- --run src/worker/process-run.integration.test.ts`

Expected: PASS and the integration run contains stable model snapshots.

- [ ] **Step 6: Commit if Git is available**

```bash
git add src/server/db src/server/jobs
git commit -m "feat: require AI settings for creation runs"
```

### Task 6: Build an owner-specific Claude client for each claimed run

**Files:**

- Create: `src/worker/ai-for-run.ts`
- Create: `src/worker/ai-for-run.test.ts`
- Modify: `src/worker/main.ts`
- Modify: `src/worker/process-run.ts`
- Modify: `src/worker/process-run.test.ts`
- Modify: `src/worker/process-run.integration.test.ts`
- Modify: `src/server/db/jobs.ts`
- Modify: `src/server/config.ts`
- Modify: `src/server/config.test.ts`

**Interfaces:**

- Produces: `loadAiForRun(run): Promise<{ ai: CadenceAi; settingsRevision: number }>`.
- Produces: `handleRunFailure(run, error, settingsRevision?)` that records safe codes and conditionally invalidates settings.
- Changes: `failRun(runId, stage, error)` stores `AiServiceError.code` and fixed message rather than raw provider data.

- [x] **Step 1: Write failing worker selection and stale-invalidation tests**

Test two claimed runs with two setting loaders:

```ts
expect(factory).toHaveBeenNthCalledWith(1, {
  apiKey: "sk-ant-user-a", researchModel: "claude-sonnet-5", writingModel: "claude-opus-5",
});
expect(factory).toHaveBeenNthCalledWith(2, {
  apiKey: "sk-ant-user-b", researchModel: "claude-opus-5", writingModel: "claude-sonnet-5",
});
```

Assert `loadAiForRun` rejects null model snapshots without calling the factory. Simulate a 401 for settings revision 4, replace the key to revision 5 before failure handling, and assert revision 5 remains valid. Add a test that an error message containing `sk-ant-secret` is stored only as `Your Anthropic API key was rejected.` with code `AI_SETTINGS_INVALID`.

- [x] **Step 2: Run worker tests and confirm failure**

Run: `npm test -- --run src/worker/ai-for-run.test.ts src/worker/process-run.test.ts`

Expected: FAIL because the worker still owns one startup-time Claude client.

- [x] **Step 3: Implement per-run loading**

In `ai-for-run.ts`:

```ts
export async function loadAiForRun(run: CreationRun) {
  if (!run.research_model || !run.writing_model || !run.ai_settings_revision) {
    throw new AiServiceError("AI_SETTINGS_REQUIRED", "Configure Claude in Settings before creating content.");
  }
  requireAllowedModel(run.research_model, "research");
  requireAllowedModel(run.writing_model, "writing");
  const settings = await getAiRuntimeSettings(run.owner_id);
  return {
    ai: createCadenceAi({
      apiKey: settings.apiKey,
      researchModel: run.research_model,
      writingModel: run.writing_model,
    }),
    settingsRevision: settings.revision,
  };
}
```

The current settings revision is returned for conditional invalidation; it does not need to equal the historical snapshot revision because a replaced key may continue an existing run.

- [x] **Step 4: Refactor the worker loop**

Remove `const deps = makeProcessDependencies(createCadenceAi())` from module startup. After each claim:

```ts
let loadedRevision: number | undefined;
try {
  const loaded = await loadAiForRun(run);
  loadedRevision = loaded.settingsRevision;
  await processCreationRun(run, makeProcessDependencies(loaded.ai));
} catch (error) {
  await handleRunFailure(run, error, loadedRevision);
}
```

Make failure handling idempotent because `processCreationRun` may already have marked a generation-stage failure. For credential-loading failures, call `failRun` directly. For `AI_SETTINGS_INVALID`, call `markAiSettingsInvalid(run.owner_id, loadedRevision)` only when a revision was loaded.

Remove the temporary `ai` configuration group and all reads of `ANTHROPIC_API_KEY`, `ANTHROPIC_RESEARCH_MODEL`, and `ANTHROPIC_WRITING_MODEL` from runtime code. Keep the `worker` group as `DATABASE_URL` plus `CREDENTIAL_ENCRYPTION_KEY`. Update `config.test.ts` so it has no `readServerConfig("ai")` expectation.

- [x] **Step 5: Store stable safe run errors**

Update `failRun` to use:

```ts
const code = error instanceof AiServiceError ? error.code : "GENERATION_FAILED";
const message = error instanceof AiServiceError ? error.message : "Generation failed. Try again.";
```

Do not persist `error.stack`, SDK bodies, authorization headers, or arbitrary `error.message` values.

- [x] **Step 6: Run worker tests**

Run: `npm test -- --run src/worker/ai-for-run.test.ts src/worker/process-run.test.ts src/server/config.test.ts`

Run with the test database: `TEST_DATABASE_URL=1 DATABASE_URL=postgresql://postgres:cadence_test_only@127.0.0.1:55439/cadence_test2 npm test -- --run src/worker/process-run.integration.test.ts`

Expected: PASS for owner-specific keys, snapshot models, safe failures, and revision-guarded invalidation.

- [ ] **Step 7: Commit if Git is available**

```bash
git add src/worker src/server/db/jobs.ts src/server/config.ts src/server/config.test.ts
git commit -m "feat: run Claude jobs with owner credentials"
```

### Task 7: Settings UI, navigation, and Create-page gate

**Files:**

- Create: `src/app/settings/page.tsx`
- Create: `src/features/settings/settings-page.tsx`
- Create: `src/features/settings/settings-page.test.tsx`
- Modify: `src/app/connections/page.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/features/create/create-entry.tsx`
- Modify: `src/features/create/create-entry.test.tsx`

**Interfaces:**

- Consumes: `/api/settings/ai`, `/api/settings/ai/models`, and existing `/api/linkedin/status` and `/api/linkedin/connect`.
- Produces: a single `/settings` experience and a Create-page setup gate.

- [x] **Step 1: Write failing Settings UI tests**

Using Testing Library, test the unconfigured state:

```tsx
render(<SettingsPage />);
expect(await screen.findByLabelText("Anthropic API key")).toHaveAttribute("type", "password");
expect(screen.getByLabelText("Research model")).toBeInTheDocument();
expect(screen.getByLabelText("Writing model")).toBeInTheDocument();
expect(screen.queryByText(/sk-ant-owner-a/)).not.toBeInTheDocument();
```

Submit and assert `PUT /api/settings/ai` contains the typed key and selected IDs. In a configured response, assert only `•••• 1234` appears, there is no prefilled key input, and buttons exist for model changes, key replacement, and removal. Test invalid-key, rate-limit, active-run deletion conflict, and LinkedIn disconnected/connected states with user-readable messages.

- [x] **Step 2: Write the failing Create gate test**

Mock the first safe-settings request as `{ status: "not_configured" }` and assert:

```ts
expect(await screen.findByText("Claude setup required")).toBeInTheDocument();
expect(screen.getByRole("link", { name: "Open Settings" })).toHaveAttribute("href", "/settings");
expect(screen.queryByRole("button", { name: "Surprise me" })).not.toBeInTheDocument();
```

Keep the existing successful creation test with `{ status: "valid" }` returned before the POST.

- [x] **Step 3: Run UI tests and confirm failure**

Run: `npm test -- --run src/features/settings/settings-page.test.tsx src/features/create/create-entry.test.tsx`

Expected: FAIL because Settings and the Create gate do not exist.

- [x] **Step 4: Implement the Settings page**

Make `src/app/settings/page.tsx` render the client component. The component loads the model catalog, safe AI status, and LinkedIn status in parallel. Use controlled password/model inputs, accessible labels, `aria-live` status messages, disabled busy states, and explicit confirmation before DELETE. Never place the key in component state after a successful save; clear it immediately.

Map stable codes to these messages:

```ts
const messages = {
  AI_SETTINGS_INVALID: "Anthropic rejected this API key. Check it and try again.",
  AI_MODEL_UNAVAILABLE: "Your Anthropic account cannot use one of these models.",
  AI_RATE_LIMITED: "Too many validation attempts. Wait one minute and try again.",
  AI_PROVIDER_UNAVAILABLE: "Anthropic could not validate the settings right now. Try again shortly.",
};
```

Keep the LinkedIn panel's existing publish-safety copy and link to `/api/linkedin/connect`.

- [x] **Step 5: Update navigation and compatibility route**

Change the root navigation link from `/connections` to `/settings` with label **Settings**. Replace the old client page with a server redirect:

```ts
import { redirect } from "next/navigation";
export default function ConnectionsPage() { redirect("/settings"); }
```

- [x] **Step 6: Add the Create-page safe-status gate**

On mount, fetch `/api/settings/ai`. Render a loading state until it resolves. Render the setup card for any status other than `valid`; render the existing creation controls only for `valid`. The API remains the authoritative gate from Task 5.

- [x] **Step 7: Run UI tests and accessibility-focused assertions**

Run: `npm test -- --run src/features/settings/settings-page.test.tsx src/features/create/create-entry.test.tsx`

Expected: PASS for setup, configured, failure, LinkedIn, and Create gate states.

- [ ] **Step 8: Commit if Git is available**

```bash
git add src/app/settings src/app/connections src/app/layout.tsx src/features/settings src/features/create
git commit -m "feat: add secure AI settings experience"
```

### Task 8: Export safety, deployment configuration, and full release verification

**Files:**

- Modify: `src/server/export/user-export.test.ts`
- Modify: `docs/operations.md`
- Modify: `.env.example`
- Modify: `README.md` if it contains startup environment instructions

**Interfaces:**

- Confirms: user exports and operational documentation never expose credential material.
- Documents: encryption-key generation, migration order, per-user setup, model-catalog maintenance, and rollback limits.

- [x] **Step 1: Strengthen the export secret test**

Insert an encrypted settings row for the exporting owner:

```ts
await pool.query(
  `insert into public.user_ai_settings
   (owner_id,api_key_encrypted,key_suffix,research_model,writing_model,status,validated_at)
   values($1,'v1:secret-ciphertext','1234','claude-sonnet-5','claude-opus-5','valid',now())`,
  [a],
);
```

Assert both JSON and Markdown omit `secret-ciphertext`, `api_key_encrypted`, and `1234`. Do not add `user_ai_settings` to `exportUserData` queries.

- [x] **Step 2: Run the export test and verify behavior**

Run: `TEST_DATABASE_URL=1 DATABASE_URL=postgresql://postgres:cadence_test_only@127.0.0.1:55439/cadence_test2 npm test -- --run src/server/export/user-export.test.ts`

Expected: PASS; settings are absent because export code never queries the private table.

- [x] **Step 3: Update operational documentation**

Document this exact key-generation command without printing or committing a generated value:

```bash
openssl rand -base64 32
```

Document that the same `CREDENTIAL_ENCRYPTION_KEY` must be installed on web and worker services, changing it makes saved user keys undecryptable, active runs must be drained before migration, and users must validate their own key in Settings after deployment. Remove `ANTHROPIC_API_KEY`, `ANTHROPIC_RESEARCH_MODEL`, and `ANTHROPIC_WRITING_MODEL` from `.env.example` after all callers are removed.

Link model-catalog maintenance to Anthropic's official model overview and deprecation pages:

- `https://platform.claude.com/docs/en/models/overview`
- `https://platform.claude.com/docs/en/about-claude/models/model-deprecations`

- [x] **Step 4: Scan for legacy global-key use and accidental secret serialization**

Run:

```bash
grep -R -n -E 'ANTHROPIC_API_KEY|ANTHROPIC_RESEARCH_MODEL|ANTHROPIC_WRITING_MODEL' src .env.example
```

Expected: no matches.

Run:

```bash
grep -R -n -E 'api_key_encrypted|apiKey' src/app src/features src/server/export
```

Expected: `apiKey` appears only in the settings PUT input/client submission path; `api_key_encrypted` does not appear in browser components or export code.

- [x] **Step 5: Run the complete automated verification**

Run: `npm test -- --run`

Expected: all unit tests pass; database integration tests skip unless `TEST_DATABASE_URL` is set.

Run with the migrated test database:

```bash
TEST_DATABASE_URL=1 DATABASE_URL=postgresql://postgres:cadence_test_only@127.0.0.1:55439/cadence_test2 npm test -- --run
```

Expected: all unit and integration tests pass.

Run: `npm run lint`

Expected: exit 0 with no ESLint errors.

Run: `npm run build`

Expected: exit 0 with `/settings`, `/api/settings/ai`, and `/api/settings/ai/models` in the route list.

- [ ] **Step 6: Perform the live two-user release check**

With dedicated test keys rather than production user keys:

1. User A saves key A with Sonnet research and Opus writing.
2. User B saves key B with Opus research and Sonnet writing.
3. Each user creates one harmless draft.
4. Database inspection confirms each run's model snapshots and no plaintext key columns.
5. Replace user A's key and confirm a new run succeeds.
6. Disconnect and reconnect user A's LinkedIn account; do not publish during this credential test.
7. Remove user B's AI settings after all B runs complete and confirm Create shows the setup gate.

- [ ] **Step 7: Commit if Git is available**

```bash
git add src/server/export/user-export.test.ts docs/operations.md .env.example README.md
git commit -m "docs: document per-user Anthropic credential operations"
```

## Final review gate

- [ ] Compare every acceptance criterion in the design spec with Tasks 1–8.
- [ ] Confirm no production path reads a global Anthropic key or model variable.
- [ ] Confirm LinkedIn OAuth and publish tests still pass unchanged.
- [ ] Confirm the Settings API never returns plaintext or ciphertext.
- [ ] Confirm the migration is applied before starting the new worker.
- [ ] Run the requesting-code-review skill before declaring the implementation complete.
- [ ] Run the verification-before-completion skill and report exact test, lint, build, migration, and live-check evidence.
