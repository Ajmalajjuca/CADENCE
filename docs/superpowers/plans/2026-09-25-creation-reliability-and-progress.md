# Creation Reliability and Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every creation mutation wake the free Render worker, classify Claude failures safely, and replace the ambiguous “Finding ideas” text with the approved warm-editorial progress experience.

**Architecture:** Vercel remains the authenticated coordinator, Supabase remains the durable queue, and Render remains the worker. Next.js `after()` schedules a bounded server-only health request after a run is queued; pure view-model code converts persisted run state and elapsed time into accessible UI copy and actions.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript, Tailwind CSS 4, Vitest, Testing Library, Playwright, PostgreSQL/Supabase, Anthropic SDK, Render.

**Spec:** `docs/superpowers/specs/2026-09-25-creation-and-onboarding-ux-design.md`

## Global Constraints

- Preserve the existing Next.js, Supabase, Vercel, and Render architecture and existing user data.
- Keep `WORKER_URL` server-only; never expose it through browser props, JSON, logs, or a `NEXT_PUBLIC_` variable.
- Supabase is the source of truth; a wake request is only an availability signal.
- Use Newsreader for headings and Inter for body/control text through `next/font`.
- Poll every 2.5 seconds only while a run is `queued` or `running`, and pause while the document is hidden.
- Never log keys, prompts, user content, raw provider bodies, or database URLs.
- Do not add WebSockets, Supabase Realtime, an icon package, or a replacement queue.
- Follow tests-first changes and keep the production tree deployable after every task.

## Review Focus

- A malformed or non-HTTPS `WORKER_URL` must produce a safe server configuration failure and never leak the value; covered in Task 2.
- Two simultaneous manual wake requests for the same run must record at most one event in a thirty-second window; covered in Task 3.
- A hidden browser tab must stop polling and resume immediately when visible without creating duplicate timers; covered in Task 5.
- A run response with date strings, missing optional selections, or an unknown error code must still render a safe state; covered in Task 4.
- A Claude response stopped by `max_tokens` or `refusal` must never fall through to `JSON.parse`; covered in Task 1.

---

## File Structure

### New files

- `web/src/server/worker/wake.ts` — validates server-only worker configuration and performs one bounded health request.
- `web/src/server/worker/wake.test.ts` — wake transport/configuration tests.
- `web/src/server/worker/wake-request.ts` — authorizes and rate-limits explicit user wake requests.
- `web/src/server/worker/wake-request.integration.test.ts` — ownership and concurrency tests against PostgreSQL.
- `web/src/server/worker/schedule-wake.ts` — wraps Next.js `after()` and safe wake logging.
- `web/src/server/worker/schedule-wake.test.ts` — scheduling/logging tests.
- `web/src/app/api/creation-runs/[id]/wake/route.ts` — authenticated manual wake endpoint.
- `web/src/features/create/run-view.ts` — pure run-to-view-state derivation and error action mapping.
- `web/src/features/create/run-view.test.ts` — state thresholds and defensive input tests.
- `web/src/features/create/use-creation-run.ts` — cancellable visibility-aware polling hook.
- `web/src/features/create/use-creation-run.test.tsx` — polling lifecycle tests.
- `web/src/features/create/progress-card.tsx` — focused progress timeline/presentation.
- `web/src/components/app-shell.tsx` — responsive application header/navigation.
- `web/src/components/ui.tsx` — small shared button, field, badge, and callout primitives.
- `web/src/components/ui.test.tsx` — primitive semantics, focus hooks, and variant tests.
- `web/src/components/app-shell.test.tsx` — navigation and active-route tests.
- `web/src/app/api/creation-runs/routes-wake.test.ts` — mutation-to-wake route contract tests.
- `web/e2e/creation-progress.spec.ts` — mocked mobile/desktop creation-state journey.

### Modified files

- `web/src/server/config.ts` and `config.test.ts` — add the `workerWake` configuration group.
- `web/src/server/ai/provider-errors.ts` and tests — add output-specific safe failures.
- `web/src/server/ai/claude.ts`, `claude.test.ts`, and `schemas.ts` — stop-reason checks, schema-safe parsing, five ideas, and per-output budgets.
- `web/src/server/db/jobs.ts` and tests — persist the new stable AI failure codes unchanged.
- `web/src/worker/ai-for-run.ts` and tests — safe diagnostic categories/classes.
- Creation and revision route handlers — schedule worker wake after successful queued mutations.
- `web/src/app/layout.tsx` and `globals.css` — fonts, tokens, body, focus, motion, and shared shell.
- `web/src/features/create/create-entry.tsx`, `run-progress.tsx`, pickers, and tests — approved creation UI.
- Home, sign-in, Ideas, Library, Settings, and draft-editor components — adopt the shared shell, colors, surfaces, and controls without workflow changes.
- `web/.env.example` and `README.md` — document `WORKER_URL` and the free-worker behavior.

---

### Task 1: Classify Claude output failures and size generation budgets

**Files:**
- Modify: `web/src/server/ai/provider-errors.ts`
- Modify: `web/src/server/ai/provider-errors.test.ts`
- Modify: `web/src/server/ai/claude.ts`
- Modify: `web/src/server/ai/claude.test.ts`
- Modify: `web/src/server/ai/schemas.ts`
- Modify: `web/src/server/db/jobs.test.ts`
- Modify: `web/src/worker/ai-for-run.ts`
- Modify: `web/src/worker/ai-for-run.test.ts`

**Interfaces:**
- Produces: `AiServiceError` codes `AI_OUTPUT_INCOMPLETE` and `AI_OUTPUT_INVALID`.
- Produces: `parseStructuredResponse(response: ClaudeStructuredResponse): unknown`.
- Produces: `parseOutput<T>(schema: z.ZodType<T>, raw: unknown): T`.
- Consumes: existing `mapAnthropicError`, `toRunFailure`, and `describeRunFailure` boundaries.

- [ ] **Step 1: Write failing tests for incomplete and invalid structured output**

Add cases to `claude.test.ts` using a minimal response shape:

```ts
it.each(["max_tokens", "refusal"])("classifies %s before JSON parsing", (stopReason) => {
  expect(() => parseStructuredResponse({ stop_reason: stopReason, content: [{ type: "text", text: "{" }] }))
    .toThrow(expect.objectContaining({ code: "AI_OUTPUT_INCOMPLETE" }));
});

it("classifies malformed JSON without exposing the response", () => {
  expect(() => parseStructuredResponse({ stop_reason: "end_turn", content: [{ type: "text", text: "not-json" }] }))
    .toThrow(expect.objectContaining({ code: "AI_OUTPUT_INVALID" }));
});

it("classifies domain-schema mismatch", () => {
  expect(() => parseOutput(ideasOutput, { ideas: [{ title: "" }] }))
    .toThrow(expect.objectContaining({ code: "AI_OUTPUT_INVALID" }));
});
```

Add assertions that idea requests use five items and 3,200 tokens, research uses 2,400, hooks 1,800, and draft/edit use 3,000. Add `toRunFailure` expectations for both new codes and verify `describeRunFailure` includes the safe class marker `[AiServiceError/ZodError]` without the exception message.

- [ ] **Step 2: Run the targeted tests and verify the new expectations fail**

Run:

```bash
cd web
npm test -- --run src/server/ai/claude.test.ts src/server/ai/provider-errors.test.ts src/server/db/jobs.test.ts src/worker/ai-for-run.test.ts
```

Expected: FAIL because the codes and parser helpers do not exist and budgets remain at 1,800/2,500.

- [ ] **Step 3: Add output error codes and structured-response guards**

Extend `AiErrorCode`, mapping both output errors to HTTP 502. Add these helpers in `claude.ts` and use `parseOutput` for ideas, research, hooks, drafts, and edits:

```ts
type ClaudeStructuredResponse = {
  stop_reason: string | null;
  content: Array<{ type: string; text?: string }>;
};

export function parseStructuredResponse(response: ClaudeStructuredResponse): unknown {
  if (response.stop_reason === "max_tokens" || response.stop_reason === "refusal") {
    throw new AiServiceError("AI_OUTPUT_INCOMPLETE", "Claude returned an incomplete response. Retry this stage.");
  }
  const text = response.content.find(block => block.type === "text")?.text;
  if (!text) throw new AiServiceError("AI_OUTPUT_INCOMPLETE", "Claude returned no usable response. Retry this stage.");
  try { return JSON.parse(text); }
  catch { throw new AiServiceError("AI_OUTPUT_INVALID", "Claude returned an invalid response. Retry this stage."); }
}

export function parseOutput<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const error = new AiServiceError("AI_OUTPUT_INVALID", "Claude returned an invalid response. Retry this stage.");
    error.cause = result.error;
    throw error;
  }
  return result.data;
}
```

Change `AnthropicTransport.generate` to return `parseStructuredResponse(response)`. Change the ideas schema/prompt to a maximum of five ideas and pass `maxTokens: 3200`; pass the explicit budgets from the spec to the other calls.

Update `describeRunFailure` to append only safe error class names:

```ts
const errorName = error instanceof Error ? error.name : "UnknownError";
const causeName = error instanceof Error && error.cause instanceof Error ? error.cause.name : undefined;
const classes = causeName ? `${errorName}/${causeName}` : errorName;
return `Run ${run.id} failed at ${run.stage}: ${code} [${classes}]${trace}`;
```

- [ ] **Step 4: Run targeted and worker integration tests**

Run:

```bash
cd web
npm test -- --run src/server/ai/claude.test.ts src/server/ai/provider-errors.test.ts src/server/db/jobs.test.ts src/worker/ai-for-run.test.ts src/worker/process-run.integration.test.ts
```

Expected: PASS, including proof that raw malformed output is absent from public messages/log descriptions.

- [ ] **Step 5: Commit the AI reliability boundary**

```bash
git add web/src/server/ai web/src/server/db/jobs.test.ts web/src/worker/ai-for-run.ts web/src/worker/ai-for-run.test.ts
git commit -m "fix: classify incomplete Claude output"
```

---

### Task 2: Build the server-only worker wake transport

**Files:**
- Modify: `web/src/server/config.ts`
- Modify: `web/src/server/config.test.ts`
- Create: `web/src/server/worker/wake.ts`
- Create: `web/src/server/worker/wake.test.ts`

**Interfaces:**
- Produces: `wakeWorker(fetcher?: typeof fetch): Promise<WorkerWakeResult>`.
- Produces: `WorkerWakeResult = { outcome: "reachable" | "requested" | "failed"; status?: number }`.
- Consumes: `readServerConfig("workerWake")` returning `{ WORKER_URL: string }`.

- [ ] **Step 1: Write configuration and transport tests**

```ts
it("requires an HTTPS worker URL", () => {
  vi.stubEnv("WORKER_URL", "http://cadence.example.com");
  expect(() => readServerConfig("workerWake")).toThrow(/WORKER_URL/);
});

it("calls only the worker health path", async () => {
  vi.stubEnv("WORKER_URL", "https://cadence-worker.onrender.com");
  const fetcher = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
  await expect(wakeWorker(fetcher)).resolves.toEqual({ outcome: "reachable", status: 200 });
  expect(fetcher).toHaveBeenCalledWith("https://cadence-worker.onrender.com/health", expect.objectContaining({ cache: "no-store" }));
});

it("treats an abort timeout as a wake request without exposing the URL", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))));
  const pending = wakeWorker(fetcher as typeof fetch);
  await vi.advanceTimersByTimeAsync(8_000);
  await expect(pending).resolves.toEqual({ outcome: "requested" });
});
```

Also test non-OK responses as `{ outcome: "failed", status }`, localhost HTTP acceptance for development, and that thrown results/messages do not contain the configured URL.

- [ ] **Step 2: Run the tests and verify failure**

```bash
cd web
npm test -- --run src/server/config.test.ts src/server/worker/wake.test.ts
```

Expected: FAIL because `workerWake` and `wakeWorker` do not exist.

- [ ] **Step 3: Implement strict configuration and the bounded request**

Add `workerWake: ["WORKER_URL"]` to the config groups and validate the parsed URL after the existing Zod check. Permit `http:` only for `localhost`/`127.0.0.1`; require `https:` otherwise.

Implement `wake.ts`:

```ts
export type WorkerWakeResult = { outcome: "reachable" | "requested" | "failed"; status?: number };

export async function wakeWorker(fetcher: typeof fetch = fetch): Promise<WorkerWakeResult> {
  const { WORKER_URL } = readServerConfig("workerWake");
  const health = new URL("/health", WORKER_URL).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetcher(health, { method: "GET", cache: "no-store", signal: controller.signal });
    return response.ok ? { outcome: "reachable", status: response.status } : { outcome: "failed", status: response.status };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return { outcome: "requested" };
    return { outcome: "failed" };
  } finally { clearTimeout(timer); }
}
```

- [ ] **Step 4: Run the wake/config tests**

```bash
cd web
npm test -- --run src/server/config.test.ts src/server/worker/wake.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the wake transport**

```bash
git add web/src/server/config.ts web/src/server/config.test.ts web/src/server/worker
git commit -m "feat: add private worker wake transport"
```

---

### Task 3: Schedule wakes after mutations and add the manual recovery endpoint

**Files:**
- Create: `web/src/server/worker/schedule-wake.ts`
- Create: `web/src/server/worker/schedule-wake.test.ts`
- Create: `web/src/server/worker/wake-request.ts`
- Create: `web/src/server/worker/wake-request.integration.test.ts`
- Create: `web/src/app/api/creation-runs/[id]/wake/route.ts`
- Create: `web/src/app/api/creation-runs/routes-wake.test.ts`
- Modify: `web/src/app/api/creation-runs/route.ts`
- Modify: `web/src/app/api/creation-runs/[id]/route.ts`
- Modify: `web/src/app/api/creation-runs/[id]/choice/route.ts`
- Modify: `web/src/app/api/posts/[draftId]/revise/route.ts`

**Interfaces:**
- Produces: `scheduleWorkerWake(schedule?: typeof after): void`.
- Produces: `registerWakeRequest(ownerId: string, runId: string): Promise<"scheduled" | "cooldown">`.
- Consumes: Task 2 `wakeWorker()`.

- [ ] **Step 1: Write scheduling, route, ownership, and concurrency tests**

Test scheduling without provider detail leakage:

```ts
it("runs the wake after the response lifecycle", async () => {
  const callbacks: Array<() => Promise<void>> = [];
  scheduleWorkerWake(callback => callbacks.push(callback as () => Promise<void>));
  expect(wakeWorker).not.toHaveBeenCalled();
  await callbacks[0]();
  expect(wakeWorker).toHaveBeenCalledOnce();
});
```

Mock `scheduleWorkerWake` in `routes-wake.test.ts` and assert that start, retry, idea choice, hook choice, and revision routes call it only after their service returns a queued run. For the explicit route, assert invalid UUID is 404 and non-owned/non-queued service errors keep their stable status.

In the PostgreSQL integration test, create two users and one queued run. Assert the other owner is rejected, a completed run is rejected, and two concurrent `registerWakeRequest(owner, run)` calls return one `scheduled` and one `cooldown` with exactly one `worker.wake_requested` event.

- [ ] **Step 2: Run targeted tests and verify failure**

```bash
cd web
npm test -- --run src/server/worker/schedule-wake.test.ts src/app/api/creation-runs/routes-wake.test.ts src/server/worker/wake-request.integration.test.ts
```

Expected: FAIL because the scheduler, endpoint, and registration service do not exist.

- [ ] **Step 3: Implement safe scheduling**

```ts
import { after } from "next/server";
import { wakeWorker } from "./wake";

export function scheduleWorkerWake(schedule: typeof after = after): void {
  schedule(async () => {
    const result = await wakeWorker();
    if (result.outcome === "failed") console.error(`Worker wake failed${result.status ? ` with status ${result.status}` : ""}.`);
  });
}
```

Do not pass user IDs, run IDs, or URLs to this log.

- [ ] **Step 4: Implement owned, rate-limited manual wake registration**

Use one transaction and an advisory lock tied to the run ID:

```ts
export async function registerWakeRequest(ownerId: string, runId: string) {
  return withTransaction(async client => {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`worker-wake:${runId}`]);
    const run = await client.query("select status from public.creation_runs where id=$1 and owner_id=$2", [runId, ownerId]);
    if (!run.rows[0]) throw new HttpError(404, "Creation run not found");
    if (run.rows[0].status !== "queued") throw new HttpError(409, "Only a queued run can wake the worker");
    const recent = await client.query(
      "select 1 from public.activity_events where owner_id=$1 and related_id=$2 and event_type='worker.wake_requested' and created_at > now()-interval '30 seconds' limit 1",
      [ownerId, runId],
    );
    if (recent.rowCount) return "cooldown" as const;
    await client.query("insert into public.activity_events(owner_id,event_type,related_id) values($1,'worker.wake_requested',$2)", [ownerId, runId]);
    return "scheduled" as const;
  });
}
```

The POST endpoint calls this service, schedules a wake only for `scheduled`, and returns `{ status: "scheduled" | "cooldown" }`.

- [ ] **Step 5: Schedule wake after every queued mutation**

In each route, store the returned run before serializing it:

```ts
const run = await startCreationRun(user.id, await request.json());
scheduleWorkerWake();
return Response.json(run, { status: 201 });
```

Apply the same pattern to retry, idea/hook choice, and revision. Do not schedule when validation, auth, or domain service execution throws.

- [ ] **Step 6: Run targeted and database-backed tests**

Run the fast suite, then the isolated integration test database command already used by the repository:

```bash
cd web
npm test -- --run src/server/worker/schedule-wake.test.ts src/app/api/creation-runs/routes-wake.test.ts
TEST_DATABASE_URL=1 DATABASE_URL=postgresql://postgres:cadence_test_only@127.0.0.1:55439/cadence_test2 npm test -- --run src/server/worker/wake-request.integration.test.ts
```

Expected: PASS; if the local isolated database is unavailable, start/reset that database before claiming integration success.

- [ ] **Step 7: Commit route wake orchestration**

```bash
git add web/src/server/worker web/src/app/api/creation-runs web/src/app/api/posts/[draftId]/revise/route.ts
git commit -m "feat: wake worker after queued creation work"
```

---

### Task 4: Derive defensive creation view states

**Files:**
- Create: `web/src/features/create/run-view.ts`
- Create: `web/src/features/create/run-view.test.ts`
- Modify: `web/src/server/db/types.ts`

**Interfaces:**
- Produces: `CreationRunJson`, the API-safe form with ISO date strings.
- Produces: `deriveRunView(run: CreationRunJson, nowMs: number): RunView`.
- Produces: `RunView` with `title`, `description`, `tone`, `activeStage`, `steps`, and `action`.

- [ ] **Step 1: Write table-driven state and error tests**

```ts
it.each([
  [5_000, "Preparing your run", undefined],
  [30_000, "Worker is waking up", undefined],
  [91_000, "This is taking longer than expected", "wake"],
])("derives queued copy at %sms", (age, title, action) => {
  expect(deriveRunView(queuedRun, Date.parse(queuedRun.updated_at) + age))
    .toMatchObject({ title, action: action ? { kind: action } : null });
});

it.each([
  ["AI_SETTINGS_INVALID", "settings"],
  ["AI_CREDIT_REQUIRED", "settings"],
  ["AI_RATE_LIMITED", "retry"],
  ["AI_OUTPUT_INCOMPLETE", "retry"],
  ["UNKNOWN_CODE", "retry"],
])("maps %s to a safe %s action", (code, action) => {
  expect(deriveRunView(failedRun(code), Date.now()).action?.kind).toBe(action);
});
```

Add tests for running each stage, waiting choices, complete, revision, malformed dates, and null selections.

- [ ] **Step 2: Run the test and verify failure**

```bash
cd web
npm test -- --run src/features/create/run-view.test.ts
```

Expected: FAIL because the pure view model does not exist.

- [ ] **Step 3: Implement the pure view model**

Define the exact stage metadata once:

```ts
export const POST_STEPS = [
  { stage: "idea", label: "Find an idea" },
  { stage: "research", label: "Research the angle" },
  { stage: "hooks", label: "Create hooks" },
  { stage: "draft", label: "Write the draft" },
  { stage: "style", label: "Polish your voice" },
] as const;
```

For queued state, calculate a non-negative age from `updated_at`; invalid dates use zero. Use exact 10,000 and 90,000 millisecond boundaries. For failures, select copy/actions from a closed safe map and use a generic retry state for unknown codes. The view model must never pass `error_message` directly to the UI unless the code is recognized and the message is already generated by Cadence.

- [ ] **Step 4: Run the view-state tests**

```bash
cd web
npm test -- --run src/features/create/run-view.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit state derivation**

```bash
git add web/src/features/create/run-view.ts web/src/features/create/run-view.test.ts web/src/server/db/types.ts
git commit -m "feat: derive creation progress states"
```

---

### Task 5: Add visibility-aware polling

**Files:**
- Create: `web/src/features/create/use-creation-run.ts`
- Create: `web/src/features/create/use-creation-run.test.tsx`

**Interfaces:**
- Produces: `useCreationRun(runId: string): { run: CreationRunJson | null; loading: boolean; error: string; refresh(): Promise<void> }`.
- Consumes: Task 4 `CreationRunJson`.

- [ ] **Step 1: Write fake-timer polling tests**

Render a small probe component around the hook. Verify immediate fetch, one fetch after 2.5 seconds for queued/running, no further fetch for failed/waiting/complete, abort on unmount, and this hidden-tab case:

```ts
Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
document.dispatchEvent(new Event("visibilitychange"));
await vi.advanceTimersByTimeAsync(7_500);
expect(fetchMock).toHaveBeenCalledTimes(1);

Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
document.dispatchEvent(new Event("visibilitychange"));
await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
await vi.advanceTimersByTimeAsync(2_500);
expect(fetchMock).toHaveBeenCalledTimes(3);
```

- [ ] **Step 2: Run the polling tests and verify failure**

```bash
cd web
npm test -- --run src/features/create/use-creation-run.test.tsx
```

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement a single self-scheduling timeout**

Use one `AbortController` per request and one timeout, not `setInterval`. After each successful response, schedule the next request only if `status` is queued/running and `document.visibilityState === "visible"`. A visibility listener cancels the timeout when hidden and calls `refresh()` once when visible. Preserve the last successful run when a later poll fails.

Core scheduling shape:

```ts
const shouldPoll = data.status === "queued" || data.status === "running";
if (shouldPoll && document.visibilityState === "visible") {
  timer.current = window.setTimeout(() => void load(), 2_500);
}
```

- [ ] **Step 4: Run polling tests**

```bash
cd web
npm test -- --run src/features/create/use-creation-run.test.tsx
```

Expected: PASS with no act warnings or leaked timers.

- [ ] **Step 5: Commit polling behavior**

```bash
git add web/src/features/create/use-creation-run.ts web/src/features/create/use-creation-run.test.tsx
git commit -m "feat: add resilient creation polling"
```

---

### Task 6: Apply the warm-editorial foundation and focused creation UI

**Files:**
- Create: `web/src/components/app-shell.tsx`
- Create: `web/src/components/ui.tsx`
- Create: `web/src/features/create/progress-card.tsx`
- Modify: `web/src/app/layout.tsx`
- Modify: `web/src/app/globals.css`
- Modify: `web/src/features/create/create-entry.tsx`
- Modify: `web/src/features/create/create-entry.test.tsx`
- Modify: `web/src/features/create/run-progress.tsx`
- Create: `web/src/features/create/run-progress.test.tsx`
- Modify: `web/src/features/create/idea-picker.tsx`
- Modify: `web/src/features/create/hook-picker.tsx`
- Modify: `web/src/features/create/research-panel.tsx`

**Interfaces:**
- Produces: `Button`, `Field`, `ChoiceChip`, `StatusBadge`, and `Callout` primitives with `className` passthrough, plus `page-container`, `page-heading`, `display-heading`, `page-intro`, `eyebrow`, and `surface-card` CSS utilities.
- Produces: `ProgressCard({ view }: { view: RunView })`.
- Consumes: Tasks 3–5 wake endpoint, view model, and polling hook.

- [ ] **Step 1: Add failing component tests for approved behavior**

Extend `create-entry.test.tsx` to assert semantic choice cards, Quick/Guided descriptions, busy copy, and safe API error rendering. Add `run-progress.test.tsx` cases:

```ts
it("explains a cold worker and lets the user leave", async () => {
  vi.setSystemTime(new Date("2026-09-25T05:04:00Z"));
  mockRun({ status: "queued", updated_at: "2026-09-25T05:03:30Z" });
  render(<RunProgress runId="run-1" />);
  expect(await screen.findByRole("heading", { name: "Worker is waking up" })).toBeInTheDocument();
  expect(screen.getByText(/You can leave this page/)).toBeInTheDocument();
  expect(screen.getByText("Find an idea")).toHaveAttribute("data-state", "active");
});

it("offers a manual wake after ninety seconds", async () => {
  mockRun({ status: "queued", updated_at: "2026-09-25T05:00:00Z" });
  render(<RunProgress runId="run-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Wake worker and check again" }));
  expect(fetch).toHaveBeenCalledWith("/api/creation-runs/run-1/wake", { method: "POST" });
  expect(screen.getByText("Wake request sent. Checking again…")).toBeVisible();
  expect(screen.getByRole("button", { name: "Wake worker and check again" })).toBeDisabled();
});
```

Also assert Settings links for settings/credit failures, retry for transient/output failures, unchanged live-region text across identical polls, choice pickers, and completion link.

- [ ] **Step 2: Run component tests and verify failure**

```bash
cd web
npm test -- --run src/features/create/create-entry.test.tsx src/features/create/run-progress.test.tsx
```

Expected: FAIL against the current text-only progress screen.

- [ ] **Step 3: Add tokens, fonts, focus, and reduced motion**

Use `Newsreader` and `Inter` in `layout.tsx`, expose them as CSS variables, and render `AppShell` around children. Define tokens in `globals.css`:

```css
:root {
  --paper: #f4f0e8;
  --surface: #fffdf8;
  --ink: #25312e;
  --muted: #68726c;
  --accent: #b44f32;
  --accent-strong: #963b24;
  --sage: #46634d;
  --warning: #9a5a22;
  --danger: #9d3535;
  --border: #ded7ca;
  --focus: #3157a4;
  --shadow-card: 0 16px 38px rgba(67, 57, 43, 0.08);
}

:focus-visible { outline: 3px solid color-mix(in srgb, var(--focus) 70%, white); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; animation-duration: 0.01ms !important; } }
```

Build an accessible responsive header in `AppShell`; mark the active pathname with `aria-current="page"` and retain all existing destinations.

- [ ] **Step 4: Build shared primitives and the focused progress card**

Keep primitives thin and native-element based. Example button contract:

```tsx
export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet" | "danger" }) {
  return <button {...props} className={`${buttonStyles[variant]} ${className}`} />;
}
```

`ProgressCard` renders one `ol` of stages. Every item has `data-state="complete|active|upcoming"`, a visible symbol in addition to color, and only the active state is announced in the surrounding live region.

- [ ] **Step 5: Rebuild create entry and run progress around the approved view**

Keep the existing API payloads. Make the three entry choices full semantic sections with distinct buttons, keep topic entry inline, and disable all start actions while a request is in flight. In `RunProgress`, consume `useCreationRun` and `deriveRunView`, update elapsed copy once per second without adding network requests, and implement:

```ts
async function wake() {
  setBusy(true);
  const response = await fetch(`/api/creation-runs/${runId}/wake`, { method: "POST" });
  if (!response.ok) setError("Could not wake the worker. Your run is still saved; try again shortly.");
  await refresh();
  setBusy(false);
}
```

After a successful manual wake, store a local `wakeRequestedAt` timestamp, show “Wake request sent. Checking again…”, disable the button for thirty seconds, and keep polling the durable run. A server `cooldown` response uses the same local state. Retain selected idea, research, hook, and choices below the progress card. Use the same Button/Card/Callout styles in the pickers and research panel.

- [ ] **Step 6: Run component tests, accessibility assertions, and lint**

```bash
cd web
npm test -- --run src/features/create/create-entry.test.tsx src/features/create/run-view.test.ts src/features/create/use-creation-run.test.tsx src/features/create/run-progress.test.tsx
npm run lint
```

Expected: PASS with no hook, accessibility, or Tailwind parsing errors.

- [ ] **Step 7: Commit the approved creation experience**

```bash
git add web/src/app/layout.tsx web/src/app/globals.css web/src/components web/src/features/create
git commit -m "feat: redesign creation progress experience"
```

---

### Task 7: Apply the shared foundation to the remaining application shell

**Files:**
- Create: `web/src/components/ui.test.tsx`
- Create: `web/src/components/app-shell.test.tsx`
- Modify: `web/src/app/page.tsx`
- Modify: `web/src/app/sign-in/page.tsx`
- Modify: `web/src/app/ideas/page.tsx`
- Modify: `web/src/app/library/page.tsx`
- Modify: `web/src/features/library/library-list.tsx`
- Modify: `web/src/features/settings/settings-page.tsx`
- Modify: `web/src/features/settings/settings-page.test.tsx`
- Modify: `web/src/features/drafts/editor.tsx`
- Modify: `web/src/features/drafts/editor.test.tsx`

**Interfaces:**
- Consumes: Task 6 `AppShell`, `Button`, `Field`, `StatusBadge`, and `Callout`.
- Produces: one consistent global visual/accessibility foundation without changing page API contracts.

- [ ] **Step 1: Pin primitive and navigation semantics**

Test native button/link behavior, disabled state, class passthrough, callout roles, and active navigation:

```ts
it("marks only the current destination", () => {
  mockPathname.mockReturnValue("/library");
  render(<AppShell><p>Page</p></AppShell>);
  expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Create" })).not.toHaveAttribute("aria-current");
});

it("keeps primary buttons native and disableable", () => {
  render(<Button disabled>Save</Button>);
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});
```

- [ ] **Step 2: Run the new component tests and verify failure**

```bash
cd web
npm test -- --run src/components/ui.test.tsx src/components/app-shell.test.tsx
```

Expected: FAIL until the Task 6 primitives expose the tested semantics and active-route behavior.

- [ ] **Step 3: Normalize page structure and surfaces**

For each listed page, preserve fetch calls, payloads, button conditions, and navigation. Replace hard-coded slate/blue surface classes with the shared page container, surface, text, callout, status, and action classes/components. Use one page eyebrow and one `h1`, and keep existing headings in logical order.

The mechanical pattern is:

```tsx
<main className="page-container">
  <header className="page-heading">
    <p className="eyebrow">Library</p>
    <h1 className="display-heading">Your content, in one place</h1>
    <p className="page-intro">Your ideas, drafts, approvals, and published posts.</p>
  </header>
  <section className="surface-card">...</section>
</main>
```

Use `<Button>` for actual buttons and the exported link style for navigation anchors. Do not turn links into click-handled buttons or change publish/approval safeguards.

- [ ] **Step 4: Preserve behavior with existing component tests**

Update queries only where visible copy intentionally changes. Keep assertions for Claude safe errors, exact-version approval, revision settings failures, and LinkedIn connection state. Add one assertion per page that its alert/status still uses the correct semantic role after restyling.

- [ ] **Step 5: Run page tests, public browser test, and lint**

```bash
cd web
npm test -- --run src/components/ui.test.tsx src/components/app-shell.test.tsx src/features/settings/settings-page.test.tsx src/features/drafts/editor.test.tsx
npm run test:e2e -- public.spec.ts
npm run lint
```

Expected: PASS on desktop and mobile, with the sign-in flow and workflow safeguards unchanged.

- [ ] **Step 6: Commit the application-wide foundation pass**

```bash
git add web/src/components web/src/app/page.tsx web/src/app/sign-in/page.tsx web/src/app/ideas/page.tsx web/src/app/library/page.tsx web/src/features/library web/src/features/settings web/src/features/drafts
git commit -m "style: apply Cadence editorial UI foundation"
```

---

### Task 8: Document, exercise, and deploy the creation path

**Files:**
- Create: `web/e2e/creation-progress.spec.ts`
- Modify: `web/.env.example`
- Modify: `web/README.md`

**Interfaces:**
- Consumes: all prior task interfaces.
- Produces: documented `WORKER_URL` configuration and a repeatable browser smoke test.

- [ ] **Step 1: Write the mocked browser journey**

Intercept `/api/settings/ai`, POST `/api/creation-runs`, GET `/api/creation-runs/run-e2e`, and the manual wake route. Return queued responses at 5, 30, and 95 seconds, then running, waiting for an idea, and failed/output-invalid states. Assert the visible copy/action for each and repeat in the configured desktop/mobile Playwright projects.

Central sequence:

```ts
await page.goto("/create");
await page.getByRole("button", { name: "Find ideas" }).click();
await expect(page).toHaveURL(/\/create\/run-e2e/);
await expect(page.getByRole("heading", { name: /Worker is waking up/ })).toBeVisible();
await expect(page.getByText("Find an idea")).toBeVisible();
```

- [ ] **Step 2: Run Playwright and verify the new test passes**

```bash
cd web
npm run test:e2e -- creation-progress.spec.ts
```

Expected: PASS on desktop and Pixel 7 projects.

- [ ] **Step 3: Document configuration and operational behavior**

Add to `.env.example`:

```dotenv
WORKER_URL=http://localhost:10000
```

Document that Vercel production/preview/development should use `https://cadence-3iwy.onrender.com`, Render itself does not need the Vercel URL, and the GitHub keep-awake workflow is best effort only.

- [ ] **Step 4: Run the complete verification gate**

```bash
cd web
npm test -- --run
npm run lint
npm run build
npm run test:e2e
```

Expected: every command exits 0. Record any integration tests skipped because `TEST_DATABASE_URL` is absent; do not describe skipped tests as passed.

- [ ] **Step 5: Commit documentation and end-to-end coverage**

```bash
git add web/e2e/creation-progress.spec.ts web/.env.example web/README.md
git commit -m "test: cover worker wake creation journey"
```

- [ ] **Step 6: Configure and smoke-test production**

Set `WORKER_URL=https://cadence-3iwy.onrender.com` in Vercel production, preview, and development, redeploy, then start one owned “Find ideas” run. Verify the Render logs show the worker start/claim, the run advances beyond `idea`, and any failure records one of the safe categories. Do not print secret environment values while verifying configuration.
