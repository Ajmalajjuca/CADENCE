# Cadence Invited Beta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an invitation-only Cadence web app in which each user can onboard, generate and review a sourced LinkedIn text post, approve an exact version, publish it once, and find its history.

**Architecture:** A Next.js TypeScript application serves the UI and authenticated API. Supabase Auth and PostgreSQL store user-owned content; a separate Node worker runs durable Claude generation jobs. Server-only LinkedIn OAuth and publishing code sends only approved versions through the current Posts API.

**Tech Stack:** Node.js 20.9+; Next.js 16 App Router; React 19; TypeScript 5; npm; Supabase Auth/PostgreSQL; `@supabase/ssr`; `@supabase/supabase-js`; `pg`; `@anthropic-ai/sdk`; Zod; Vitest and Testing Library; Playwright; `tsx` for the worker. Pin exact resolved package versions in `web/package-lock.json` when scaffolding.

**Spec:** `docs/superpowers/specs/2026-09-21-cadence-invited-beta-design.md`

## Global Constraints

- The first release is invitation-only and supports individual LinkedIn accounts, text posts, and immediate publishing.
- Every profile, idea, draft, approval, and publication record belongs to one user; enforce ownership in API handlers and PostgreSQL row-level policies.
- Claude and LinkedIn credentials stay server-side. Encrypt per-user LinkedIn tokens at rest.
- Approval applies to one immutable draft version; editing creates a new version and requires new approval. Publishing is a separate action.
- Research claims carry source links; never invent the user's stories, clients, outcomes, quotes, or numbers.
- A repeated publish request cannot send the same approved version twice; an uncertain response is not retried automatically.
- Notion, scheduling, analytics, public signup, team roles, and media posts are outside this plan.
- Preserve the original Markdown files and provide a previewed one-time import plus Markdown/JSON export.
- The current folder has an empty `.git` directory and is not a Git checkout. During execution, work in a real Git checkout before following task commit steps; do not overwrite this snapshot's `.git` directory to force commits.
- Before Task 1, verify in the LinkedIn Developer Portal that the app can request `w_member_social` and an identity scope that yields the current member ID; use a dedicated account to verify the current Posts API request shape with an explicitly approved test post. If access is unavailable, keep Tasks 1–9 implementable but pause Tasks 10–12 until the app has access. This check is a dependency, not permission to publish any other post.

## Review Focus

1. **Cross-account IDs:** when user A sends user B's record ID, API and database access return no data and make no change. Covered in Tasks 2, 3, 5, and 9.
2. **Empty or hostile source material:** when the story bank is empty or a search result contains instructions, generation stays in opinion mode and treats the result as data. Covered in Task 6.
3. **Interrupted creation:** when the browser closes or one stage fails, prior choices and completed stages remain available and retry resumes at the failed stage. Covered in Tasks 7 and 8.
4. **Changed approved text:** when an approved draft is edited, publishing the new version is denied until it is approved. Covered in Tasks 9 and 11.
5. **Unknown LinkedIn outcome:** when the network fails after the request was sent, a repeat click does not issue another POST until reconciliation resolves the attempt. Covered in Task 11.

---

## File Map and Dependency Order

| Area | Files | Responsibility |
| --- | --- | --- |
| App shell | `web/src/app/layout.tsx`, `web/src/app/page.tsx`, `web/src/app/api/health/route.ts` | Navigation, entry point, health check |
| Database | `web/supabase/migrations/202609210001_init.sql`, `web/src/server/db/*.ts` | Tables, policies, typed queries, transactions |
| Auth | `web/src/server/auth/*.ts`, `web/src/app/auth/*`, `web/src/middleware.ts` | Invite session and ownership checks |
| Profile | `web/src/features/profile/*`, `web/src/app/onboarding/*`, `web/src/app/profile/*` | Interview, voice, samples, stories |
| Ideas/Library | `web/src/features/ideas/*`, `web/src/features/library/*`, `web/src/app/ideas/*`, `web/src/app/library/*` | Saved ideas and content history |
| AI | `web/src/server/ai/*`, `web/src/server/jobs/*`, `web/src/worker/*` | Versioned prompts, structured results, durable stages |
| Creation UI | `web/src/features/create/*`, `web/src/app/create/*` | Quick and guided flows |
| Review | `web/src/features/drafts/*`, `web/src/app/posts/*` | Immutable versions, edits, approvals |
| LinkedIn | `web/src/server/linkedin/*`, `web/src/app/api/linkedin/*`, `web/src/app/connections/*` | OAuth, encrypted tokens, publishing |
| Portability | `web/scripts/import-cadence.ts`, `web/src/server/export/*` | Previewed migration and user exports |

Tasks 1–3 establish the secure foundation. Tasks 4–5 add user-owned data and UI. Tasks 6–8 add generation. Tasks 9–11 add review and publication. Task 12 verifies the complete product and migration.

### Task 1: Runnable web and worker foundation

**Files:** Create `web/package.json`, `web/package-lock.json`, `web/tsconfig.json`, `web/vitest.config.ts`, `web/playwright.config.ts`, `web/src/app/layout.tsx`, `web/src/app/page.tsx`, `web/src/app/api/health/route.ts`, `web/src/worker/main.ts`, `web/src/server/config.ts`, `web/.env.example`, `web/src/app/api/health/route.test.ts`.

**Interfaces:** Produce `readServerConfig(): ServerConfig` and `GET /api/health -> {status:"ok"}`. Later tasks import `readServerConfig`; the worker starts independently with `npm run worker`.

- [ ] **Step 1: Scaffold the test harness, then write failing health/config tests.** Run `npx create-next-app@16 web --typescript --eslint --app --src-dir --import-alias '@/*' --use-npm`; install Vitest and add an `npm test` script. Assert health returns 200 and `readServerConfig()` rejects a missing `ANTHROPIC_API_KEY` in worker mode without exposing its value in the error. Use `vitest` and `vi.stubEnv`.

  ```ts
  import { expect, it } from 'vitest';
  import { GET } from './route';
  it('answers health without external credentials', async () => {
    expect(await (await GET()).json()).toEqual({ status: 'ok' });
  });
  ```
- [ ] **Step 2: Verify failure.** Run `npm test -- --run src/app/api/health/route.test.ts`; expect missing module or failed assertions.
- [ ] **Step 3: Implement.** Add Testing Library, Playwright, Supabase SDKs and CLI, Anthropic SDK, `pg`, Zod, and `tsx`. Implement `GET()` returning `Response.json({status:'ok'})`. Implement a Zod server config containing `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `ANTHROPIC_API_KEY`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_REDIRECT_URI`, `LINKEDIN_TOKEN_KEY`, `APP_URL`, and `LINKEDIN_VERSION`; parse only on the server path that needs each group so the public health route works without external services. Add `npm run db:test` for `supabase test db`.

  ```ts
  export function GET() {
    return Response.json({ status: 'ok' });
  }
  ```
- [ ] **Step 4: Verify.** Run targeted tests, `npm run lint`, and `npm run build`; expect success. Start `npm run dev` and check `/api/health` returns `{"status":"ok"}`.
- [ ] **Step 5: Commit in the execution checkout.** `git add web && git commit -m "feat: scaffold Cadence web and worker"`.

### Task 2: Schema, ownership policies, and job storage

**Files:** Create `web/supabase/migrations/202609210001_init.sql`, `web/supabase/tests/ownership.sql`, `web/src/server/db/types.ts`, `web/src/server/db/client.ts`, `web/src/server/db/jobs.ts`, `web/src/server/db/jobs.test.ts`.

**Interfaces:** Produce `enqueueCreationRun(ownerId, input): Promise<CreationRun>`, `claimNextRun(workerId): Promise<CreationRun|null>`, and `saveRunStage(runId, stage, payload): Promise<void>`. Database records use UUID primary keys, `owner_id uuid not null` for user-owned tables, and UTC timestamps.

- [ ] **Step 1: Write failing ownership and claim tests.** SQL tests create two auth users, insert an idea for A, and assert B cannot select/update it. Unit tests assert two workers cannot claim the same queued run and a failed stage retains earlier stage payloads.

  ```ts
  const [a, b] = await Promise.all([claimNextRun('worker-a'), claimNextRun('worker-b')]);
  expect([a, b].filter(Boolean)).toHaveLength(1);
  ```
- [ ] **Step 2: Verify failure.** Run `npm run db:test` and `npm test -- --run src/server/db/jobs.test.ts`; expect missing tables/functions.
- [ ] **Step 3: Implement one migration.** Create tables named in spec §5, plus `oauth_states` for one-use OAuth nonces. Use `owner_id` foreign keys to `auth.users` except `profiles.user_id`. Add `unique(draft_id, version_no)` and indexes on `(owner_id,status,created_at)`. Give `creation_runs` a `kind` of `post` or `revision`. Give publication attempts an `attempt_no`; add a partial unique index on `approval_id` while state is `pending`, `uncertain`, or `published`, so a known failed attempt can be retried and history retained. Enable RLS on every exposed table. For user-facing tables, add select/insert/update/delete policies using `auth.uid() = owner_id`; approval and publication writes occur only through server code after validation. Deny direct authenticated access to encrypted connection tokens and OAuth states. Add a `claim_creation_run` transaction using `FOR UPDATE SKIP LOCKED`, a lease expiry, and a bounded attempt count.

  ```sql
  alter table public.ideas enable row level security;
  create policy ideas_select_own on public.ideas for select to authenticated
    using (owner_id = (select auth.uid()));
  create policy ideas_insert_own on public.ideas for insert to authenticated
    with check (owner_id = (select auth.uid()));
  create policy ideas_update_own on public.ideas for update to authenticated
    using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));
  create policy ideas_delete_own on public.ideas for delete to authenticated
    using (owner_id = (select auth.uid()));
  ```
- [ ] **Step 4: Verify.** Run SQL and unit tests. Check that unauthenticated requests and user B cannot access A's data; run migration twice only through Supabase migration tooling, never by replaying raw SQL.
- [ ] **Step 5: Commit.** `git add web/supabase web/src/server/db && git commit -m "feat: add owned content schema and durable jobs"`.

### Task 3: Invitation-only authentication and server guards

**Files:** Create `web/src/server/auth/supabase.ts`, `web/src/server/auth/require-user.ts`, `web/src/server/auth/require-user.test.ts`, `web/src/app/auth/callback/route.ts`, `web/src/app/sign-in/page.tsx`, `web/src/middleware.ts`, `web/docs/auth-setup.md`.

**Interfaces:** Produce `requireUser(): Promise<{id:string;email:string}>`; each feature service queries its own owner-scoped records. Protected routes return 401 for no session and 404 for another user's ID.

- [ ] **Step 1: Write tests.** Mock Supabase `auth.getUser()` and assert missing session → 401, valid session → user ID, user B's record ID → 404. Add a Playwright test for sign-in redirect from `/create`.

  ```ts
  expect(await requestAs(userB).get(`/api/ideas/${ideaOwnedByA}`)).toMatchObject({ status: 404 });
  expect(await requestWithoutSession().get('/api/profile')).toMatchObject({ status: 401 });
  ```
- [ ] **Step 2: Verify tests fail.** Run the targeted Vitest file and Playwright spec.
- [ ] **Step 3: Implement.** Add Supabase SSR cookie clients and auth callback. Protect application routes in middleware, then repeat `requireUser` in every API handler. Disable public signups in Supabase Auth; document admin invitations through `inviteUserByEmail` or the dashboard. Do not build a public registration page.

  ```ts
  export async function requireUser() {
    const { data: { user }, error } = await createServerClient().auth.getUser();
    if (error || !user) throw new HttpError(401, 'Sign in required');
    return { id: user.id, email: user.email ?? '' };
  }
  ```
- [ ] **Step 4: Verify.** Run tests and test manually with two invited accounts and one unauthenticated browser session.
- [ ] **Step 5: Commit.** `git add web/src/server/auth web/src/app/auth web/src/app/sign-in web/src/middleware.ts web/docs/auth-setup.md && git commit -m "feat: require invited user sessions"`.

### Task 4: Guided onboarding and editable voice profile

**Files:** Create `web/src/features/profile/schema.ts`, `web/src/features/profile/service.ts`, `web/src/features/profile/service.test.ts`, `web/src/features/profile/onboarding-form.tsx`, `web/src/app/onboarding/page.tsx`, `web/src/app/profile/page.tsx`, `web/src/app/api/profile/route.ts`, `web/src/app/api/profile/route.test.ts`.

**Interfaces:** Produce `saveOnboardingStep(ownerId, step, input): Promise<ProfileState>` and `getVoiceContext(ownerId): Promise<VoiceContext>`. `VoiceContext` contains identity, audience, goals, ordered pillars, rules, exact samples, and exact stories.

- [ ] **Step 1: Write tests.** Save step 1, reload, then finish later; assert exact sample text survives. Assert empty stories yield `stories: []` and `voiceMode: 'opinion'`. Assert an owner mismatch cannot update the profile.

  ```ts
  expect((await getVoiceContext(userId)).stories).toEqual([]);
  expect((await getVoiceContext(userId)).voiceMode).toBe('opinion');
  expect((await getVoiceContext(userId)).samples[0].text).toBe(originalPastedText);
  ```
- [ ] **Step 2: Verify failure.** Run targeted tests.
- [ ] **Step 3: Implement.** Build six steps: identity/work; audience/goal; pillars; samples or voice questionnaire; rules; stories and review. Save each step via authenticated `PATCH /api/profile`, validate with Zod, and store the last completed step. Let users edit the same fields at `/profile`. Treat extracted tone traits as editable suggestions; never replace exact writing samples.

  ```ts
  const OnboardingInput = z.discriminatedUnion('step', [identitySchema, audienceSchema,
    pillarsSchema, samplesSchema, rulesSchema, storiesSchema]);
  export async function saveOnboardingStep(ownerId: string, raw: unknown) {
    const input = OnboardingInput.parse(raw);
    return profileRepository.saveStep(ownerId, input);
  }
  ```
- [ ] **Step 4: Verify.** Run tests and a browser walkthrough that closes and reopens onboarding midway.
- [ ] **Step 5: Commit.** `git add web/src/features/profile web/src/app/onboarding web/src/app/profile web/src/app/api/profile && git commit -m "feat: add resumable voice onboarding"`.

### Task 5: Ideas, activity, and Library foundation

**Files:** Create `web/src/features/ideas/schema.ts`, `web/src/features/ideas/service.ts`, `web/src/features/ideas/service.test.ts`, `web/src/features/library/service.ts`, `web/src/features/library/library-list.tsx`, `web/src/app/ideas/page.tsx`, `web/src/app/library/page.tsx`, `web/src/app/api/ideas/route.ts`, `web/src/app/api/library/route.ts`.

**Interfaces:** Produce `createIdea(ownerId,input): Promise<Idea>`, `listIdeas(ownerId,filter): Promise<Idea[]>`, and `listLibrary(ownerId,filter): Promise<LibraryItem[]>`. `LibraryItem` has a stable ID, kind, status, title, pillar, and updated time.

- [ ] **Step 1: Write tests.** A's ideas do not appear in B's search; filtering by pillar/status returns matching items; discard changes status but preserves the item; blank title is rejected.

  ```ts
  expect(await listIdeas(userB, { query: 'agent' })).toEqual([]);
  expect((await listIdeas(userA, { status: 'discarded' }))[0].id).toBe(savedIdea.id);
  ```
- [ ] **Step 2: Verify failure.** Run `npm test -- --run src/features/ideas/service.test.ts`.
- [ ] **Step 3: Implement.** Add idea CRUD routes and a searchable Library list with Ideas, Drafts, Approved, Published, and Failed filters. Record activity events for create/discard; the list queries structured rows rather than a Markdown log. Show a useful empty state with links to Create.

  ```ts
  export async function createIdea(ownerId: string, raw: unknown) {
    const input = ideaSchema.parse(raw);
    return db.ideas.insert({ ...input, owner_id: ownerId, status: 'saved' });
  }
  ```
- [ ] **Step 4: Verify.** Run tests and check keyboard filtering and mobile layout in Playwright.
- [ ] **Step 5: Commit.** `git add web/src/features/ideas web/src/features/library web/src/app/ideas web/src/app/library web/src/app/api/ideas web/src/app/api/library && git commit -m "feat: add owned idea and content library"`.

### Task 6: Versioned Claude adapters and source-aware outputs

**Files:** Create `web/src/server/ai/types.ts`, `web/src/server/ai/schemas.ts`, `web/src/server/ai/prompts.ts`, `web/src/server/ai/claude.ts`, `web/src/server/ai/claude.test.ts`, `web/src/server/ai/prompt-versions/v1.ts`.

**Interfaces:** Produce `researchIdeas(context,seed): Promise<RankedIdea[]>`, `researchTopic(context,idea): Promise<ResearchBrief>`, `makeHooks(context,brief): Promise<Hook[]>`, `writeDraft(context,brief,hook): Promise<DraftResult>`, and `editDraft(context,draft,direction): Promise<DraftResult>`. Each result contains `promptVersion`, `model`, and any source URLs used.

- [ ] **Step 1: Write adapter tests with a fake Claude client.** Assert structured responses are schema-validated; a source URL absent from the research result is rejected from a draft's claim references; empty stories set opinion mode; a retrieved page saying “ignore your rules” remains quoted source data and cannot change system instructions.

  ```ts
  expect(() => validateClaims(draftWithUnknownUrl, brief)).toThrow('Unknown source');
  expect(buildVoicePrompt({ stories: [] })).toContain('opinion');
  ```
- [ ] **Step 2: Verify failure.** Run targeted Vitest tests.
- [ ] **Step 3: Implement.** Move useful instructions from `.claude/agents/` and `knowledge_base/content_rules.md` into a versioned prompt module. Use the Anthropic server SDK, structured JSON output, and Claude web search for current topics. Keep prompt and user data in separate message fields; validate every returned object with Zod before persistence. Use configured research and writing model IDs and record usage. Return a typed error for rate limits, tool failure, and thin research; never fabricate a fallback citation.

  ```ts
  export const PROMPT_VERSION = 'cadence-v1';
  export function validateClaims(draft: DraftResult, brief: ResearchBrief) {
    const known = new Set(brief.sources.map(source => source.url));
    for (const claim of draft.claims) if (!known.has(claim.sourceUrl)) throw new Error('Unknown source');
    return draft;
  }
  ```
- [ ] **Step 4: Verify.** Run adapter tests. With a test API account, run one read-only research call and inspect that its links resolve; no publishing occurs.
- [ ] **Step 5: Commit.** `git add web/src/server/ai && git commit -m "feat: add source-aware Claude generation adapters"`.

### Task 7: Durable creation worker and resumable stages

**Files:** Create `web/src/server/jobs/creation-service.ts`, `web/src/server/jobs/creation-service.test.ts`, `web/src/worker/process-run.ts`, `web/src/worker/process-run.test.ts`, `web/src/app/api/creation-runs/route.ts`, `web/src/app/api/creation-runs/[id]/route.ts`, `web/src/app/api/creation-runs/[id]/choice/route.ts`; modify `web/src/worker/main.ts`.

**Interfaces:** Produce `startCreationRun(ownerId,{mode,entry,ideaId?,direction?}): Promise<CreationRun>`, `chooseRunIdea(ownerId,runId,ideaId): Promise<void>`, `chooseRunHook(ownerId,runId,hookId): Promise<void>`, `startRevisionRun(ownerId,draftId,direction): Promise<CreationRun>`, and `processCreationRun(runId,deps): Promise<void>`. Stages are `idea`, `research`, `hooks`, `draft`, `style`, `revision`, `ready`; statuses are `queued`, `running`, `waiting_for_user`, `failed`, `complete`.

- [ ] **Step 1: Write tests.** Start a run and assert its owner and queued state. Fake a failure at hooks and assert saved research remains. Retry and assert processing resumes at hooks, not broad research. Assert user B cannot fetch user A's run.

  ```ts
  await expect(processCreationRun(run.id, failingAtHooks)).rejects.toThrow();
  expect((await getRun(userA, run.id)).stages.research).toEqual(savedResearch);
  expect((await retryRun(userA, run.id)).stage).toBe('hooks');
  ```
- [ ] **Step 2: Verify failure.** Run targeted tests.
- [ ] **Step 3: Implement.** API handlers enqueue and read runs; add owner-checked selection endpoints under `/api/creation-runs/[id]/choice`. Worker claims with a lease, saves each structured stage in a transaction, releases at guided checkpoints, and resumes after the user's selection. A revision run calls `editDraft` with the user's direction and creates a new draft version. Quick mode selects a documented idea/hook automatically. Cap attempts per stage; mark permanent failure with a user-readable code. On worker restart, expired leases become claimable without deleting saved stages.

  ```ts
  const run = await claimNextRun(workerId);
  if (run?.stage === 'research') {
    const brief = await deps.researchTopic(run.voiceContext, run.selectedIdea);
    await saveRunStage(run.id, 'research', brief);
  }
  ```
- [ ] **Step 4: Verify.** Run tests; kill a local worker after research and confirm a restarted worker resumes from the stored stage.
- [ ] **Step 5: Commit.** `git add web/src/server/jobs web/src/worker web/src/app/api/creation-runs && git commit -m "feat: run resumable content jobs"`.

### Task 8: Quick and guided Create UI

**Files:** Create `web/src/features/create/create-entry.tsx`, `web/src/features/create/idea-picker.tsx`, `web/src/features/create/research-panel.tsx`, `web/src/features/create/hook-picker.tsx`, `web/src/features/create/run-progress.tsx`, `web/src/app/create/page.tsx`, `web/src/app/create/[runId]/page.tsx`, `web/e2e/create.spec.ts`.

**Interfaces:** Consume creation-run API from Task 7 and route completed runs to `/posts/{draftId}`. No client component calls Claude directly.

- [ ] **Step 1: Write Playwright tests.** An invited user sees three entry points. Quick mode reaches a draft without entering a prompt. Guided mode lets the user change the suggested hook. Reloading mid-run shows stored progress and choices. A failed stage shows Retry and preserves earlier work.

  ```ts
  await page.getByRole('button', { name: 'Surprise me' }).click();
  await expect(page.getByText('Research')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Research')).toBeVisible();
  ```
- [ ] **Step 2: Verify tests fail.** Run `npx playwright test e2e/create.spec.ts` against mock API fixtures.
- [ ] **Step 3: Implement.** Render “I have a topic,” “Find ideas,” and “Surprise me” as the first choice. Poll or stream persisted run state; show stage labels, source links, choice explanations, retry, and resume controls. Maintain keyboard focus on stage changes and expose progress as status text. Keep the optional direction field collapsed by default.

  ```tsx
  <button onClick={() => startCreation({ entry: 'surprise', mode: 'quick' })}>Surprise me</button>
  <div role="status" aria-live="polite">{stageLabel(run.stage)}</div>
  ```
- [ ] **Step 4: Verify.** Run Playwright at desktop and mobile widths and verify no API keys appear in client bundles or network responses.
- [ ] **Step 5: Commit.** `git add web/src/features/create web/src/app/create web/e2e/create.spec.ts && git commit -m "feat: add guided and quick post creation"`.

### Task 9: Immutable drafts, edits, and exact-version approval

**Files:** Create `web/src/features/drafts/service.ts`, `web/src/features/drafts/service.test.ts`, `web/src/features/drafts/editor.tsx`, `web/src/app/posts/[draftId]/page.tsx`, `web/src/app/api/posts/[draftId]/versions/route.ts`, `web/src/app/api/posts/[draftId]/revise/route.ts`, `web/src/app/api/posts/[draftId]/approve/route.ts`, `web/e2e/review.spec.ts`.

**Interfaces:** Produce `createVersion(ownerId,draftId,text,sourceRefs): Promise<DraftVersion>` and `approveVersion(ownerId,versionId): Promise<Approval>`. Approval stores SHA-256 of UTF-8 text. `getCurrentApprovedVersion(ownerId,draftId)` returns null when current version differs.

- [ ] **Step 1: Write tests.** Editing version 1 creates version 2 and leaves version 1 immutable. Approval of version 1 does not approve version 2. User B cannot approve A's version. An empty post cannot be approved. Browser test displays source links and a final text preview.

  ```ts
  const next = await createVersion(userA, draft.id, 'Revised text', []);
  expect(next.versionNo).toBe(2);
  expect(await getCurrentApprovedVersion(userA, draft.id)).toBeNull();
  ```
- [ ] **Step 2: Verify failure.** Run targeted Vitest and Playwright tests.
- [ ] **Step 3: Implement.** Save an initial version when a run completes. Direct editing creates a new version immediately; a plain-language revision request starts the worker path from Task 7 and creates a new version when it completes. Approval is an authenticated POST that reloads the current version inside a transaction, computes the checksum, and writes the approval. Show “Approve this version” and a separate disabled “Publish now” until approved.

  ```ts
  const checksum = createHash('sha256').update(current.text, 'utf8').digest('hex');
  await tx.approvals.insert({ owner_id: ownerId, draft_version_id: current.id,
    text_checksum: checksum, approved_at: new Date() });
  ```
- [ ] **Step 4: Verify.** Run tests and inspect the database to confirm prior versions remain unchanged.
- [ ] **Step 5: Commit.** `git add web/src/features/drafts web/src/app/posts web/src/app/api/posts web/e2e/review.spec.ts && git commit -m "feat: require exact-version post approval"`.

### Task 10: Per-user LinkedIn OAuth connection

**Files:** Create `web/src/server/linkedin/crypto.ts`, `web/src/server/linkedin/oauth.ts`, `web/src/server/linkedin/oauth.test.ts`, `web/src/app/api/linkedin/connect/route.ts`, `web/src/app/api/linkedin/callback/route.ts`, `web/src/app/api/linkedin/status/route.ts`, `web/src/app/connections/page.tsx`.

**Interfaces:** Produce `beginLinkedInConnect(ownerId): Promise<URL>`, `finishLinkedInConnect(ownerId,state,code): Promise<ConnectionStatus>`, and `getLinkedInConnection(ownerId): Promise<DecryptedConnection>`, server-only.

- [ ] **Step 1: Write tests.** Reject missing/mismatched/expired/reused OAuth state, preserve the initiating owner, encrypt a token so database ciphertext differs from plaintext, and never return token material from `/status`.

  ```ts
  expect(await finishLinkedInConnect(userA, 'expired-state', code)).rejects.toThrow('expired');
  expect(encryptToken('secret-token')).not.toContain('secret-token');
  ```
- [ ] **Step 2: Verify failure.** Run targeted tests.
- [ ] **Step 3: Implement.** Generate a random one-use state stored with owner and 10-minute expiry. Redirect to LinkedIn's authorization code flow requesting `w_member_social` plus the approved identity scope from the preflight; exchange the code server-side, retrieve the current member ID through the documented identity endpoint, and form the `urn:li:person:{id}` author value. Encrypt access token with AES-256-GCM using `LINKEDIN_TOKEN_KEY` and save expiry and member URN. The Connections page shows connected, expiring, or reconnect states. Do not treat a token from the old local `.env` as a shared beta credential.

  ```ts
  const state = randomBytes(32).toString('base64url');
  await oauthStates.insert({ owner_id: ownerId, state_hash: sha256(state),
    expires_at: new Date(Date.now() + 10 * 60_000) });
  // Store AES-256-GCM IV, auth tag, and ciphertext; validate key decodes to 32 bytes.
  ```
- [ ] **Step 4: Verify.** Run tests and manually complete OAuth with a dedicated test LinkedIn account; verify token values are absent from logs and browser responses.
- [ ] **Step 5: Commit.** `git add web/src/server/linkedin web/src/app/api/linkedin web/src/app/connections && git commit -m "feat: connect individual LinkedIn accounts"`.

### Task 11: Publish once and record every outcome

**Files:** Create `web/src/server/linkedin/publisher.ts`, `web/src/server/linkedin/publisher.test.ts`, `web/src/server/linkedin/reconcile.ts`, `web/src/app/api/posts/[draftId]/publish/route.ts`, `web/src/features/library/publication-status.tsx`, `web/e2e/publish.spec.ts`.

**Interfaces:** Produce `publishApprovedVersion(ownerId,draftId): Promise<PublicationResult>`. States are `pending`, `published`, `failed`, `uncertain`; only a known failed attempt may be retried after explicit user action.

- [ ] **Step 1: Write tests.** Unapproved or edited drafts return 409 without network call; B's draft returns 404; two concurrent calls to publish the same approval issue one LinkedIn POST; a timed-out POST moves to `uncertain` and a repeated call does not POST again; a 401 gives reconnect guidance; a 201 stores the post URN and URL.

  ```ts
  await Promise.all([publishApprovedVersion(userA, draft.id), publishApprovedVersion(userA, draft.id)]);
  expect(linkedInPostSpy).toHaveBeenCalledTimes(1);
  await expect(publishApprovedVersion(userA, editedDraft.id)).rejects.toMatchObject({ status: 409 });
  ```
- [ ] **Step 2: Verify failure.** Run targeted tests.
- [ ] **Step 3: Implement.** In a database transaction, lock the current draft and approval, compare checksum, and insert one unique publication attempt. Make the LinkedIn request to `POST https://api.linkedin.com/rest/posts` with the connected member URN as `author`, exact approved text as `commentary`, `visibility: 'PUBLIC'`, `lifecycleState: 'PUBLISHED'`, and required distribution fields. Send `Linkedin-Version` and `X-Restli-Protocol-Version` headers. Store the returned ID. If the result is unknown, reconcile by checking LinkedIn before any retry; if the account lacks read permission, keep `uncertain` and require manual resolution. Never automatically repeat an uncertain POST.

  ```ts
  const body = { author: connection.personUrn, commentary: approved.text,
    visibility: 'PUBLIC', lifecycleState: 'PUBLISHED',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] } };
  const response = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST', headers: linkedInHeaders(connection.token), body: JSON.stringify(body) });
  ```
- [ ] **Step 4: Verify.** Run mocked tests and Playwright flow. Then publish one explicitly approved test post through the dedicated account and verify its URL and Library record.
- [ ] **Step 5: Commit.** `git add web/src/server/linkedin web/src/app/api/posts web/src/features/library web/e2e/publish.spec.ts && git commit -m "feat: publish approved LinkedIn posts once"`.

### Task 12: Previewed import, export, and complete release checks

**Files:** Create `web/scripts/import-cadence.ts`, `web/scripts/import-cadence.test.ts`, `web/src/server/export/user-export.ts`, `web/src/server/export/user-export.test.ts`, `web/src/app/api/export/route.ts`, `web/e2e/full-flow.spec.ts`, `web/README.md`, `web/docs/operations.md`.

**Interfaces:** Produce `previewLegacyImport(rootPath): ImportPreview`, `applyLegacyImport(ownerId,previewId): Promise<ImportReport>`, and `exportUserData(ownerId,format:'json'|'markdown'): Promise<Download>`.

- [ ] **Step 1: Write tests.** Preview parses the current known Markdown files and draft without writing; ambiguous content is reported in notes; apply refuses an owner who already has data unless the import is explicitly confirmed; export excludes secrets and another user's records. Full-flow Playwright test covers invite → onboarding → quick draft → edit → approve → publish → Library.

  ```ts
  const preview = await previewLegacyImport(repoRoot);
  expect(preview.writes).toBe(0);
  expect(preview.samples[0].text).toContain('dear manager');
  expect((await exportUserData(userA, 'json')).body).not.toContain('access_token');
  ```
- [ ] **Step 2: Verify failure.** Run targeted tests and `npx playwright test e2e/full-flow.spec.ts`.
- [ ] **Step 3: Implement.** Make the CLI's default action preview and require `--apply --owner <uuid> --preview-id <id>` to write. Preserve source files. Provide JSON and Markdown downloads from authenticated API. Document invitation setup, environment variables, database migration, worker startup, OAuth redirect configuration, backup, generation limits, and failed/uncertain publication operations.

  ```ts
  const previewId = createHash('sha256').update(sourceFilesInStableOrder.join('\n')).digest('hex');
  if (apply && submittedPreviewId !== previewId) throw new Error('Source files changed; preview again');
  ```
- [ ] **Step 4: Verify.** Run `npm test -- --run`, `npm run lint`, `npm run build`, and all Playwright tests. Run a two-user manual walkthrough and inspect the dedicated-account publish from Task 11 without sending a second post. Record observed results in `web/docs/operations.md`; stop if ownership, approval, or duplicate-publish checks fail.
- [ ] **Step 5: Commit.** `git add web/scripts web/src/server/export web/src/app/api/export web/e2e/full-flow.spec.ts web/README.md web/docs/operations.md && git commit -m "feat: import Cadence data and verify invited beta"`.

## Release Handoff

The beta can be offered to invitees after Task 12 passes, the required server secrets and LinkedIn OAuth redirect are configured, and one dedicated-account publish has been inspected. Deploy web and worker from the same revision, apply database migrations before starting either process, and keep public signup disabled. The later subprojects in spec §8 each need their own reviewed design and plan.

## Implementation References

- Next.js installation and Node requirement: https://nextjs.org/docs/app/getting-started/installation
- Supabase invitations: https://supabase.com/docs/guides/auth/users
- Claude structured output: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- LinkedIn OAuth: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
- LinkedIn Posts API: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
