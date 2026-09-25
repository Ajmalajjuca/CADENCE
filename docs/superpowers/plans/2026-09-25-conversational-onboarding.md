# Conversational Onboarding and Profile Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw six-page profile form with the approved conversational interview and a section-based returning-user profile editor without changing existing stored profile data.

**Architecture:** Pure form-model helpers normalize API data and create existing step payloads; a focused hook owns loading/saving/resume state; small step panels render one meaningful question at a time inside a shared interview shell. First-time onboarding and returning profile editing reuse the same panels, while the Profile page adds a concise overview.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript, Tailwind CSS 4, Vitest, Testing Library, Playwright, PostgreSQL/Supabase, the UI primitives created by the creation-reliability plan.

**Spec:** `docs/superpowers/specs/2026-09-25-creation-and-onboarding-ux-design.md`

## Global Constraints

- Execute after `2026-09-25-creation-reliability-and-progress.md`; consume its warm-editorial shell and UI primitives.
- Preserve the existing six profile areas, database tables, API route, user data, and exact writing sample/story text.
- First-time setup uses one primary question per screen and resumes from the first incomplete section.
- Preferences, extra samples, and stories remain optional and skippable.
- A skipped optional section must be explicitly saved as empty and must not discard unsaved typed text without confirmation.
- Stories must explain that only submitted details may be used and Cadence never invents personal experiences.
- All controls need visible keyboard focus, semantic labels, useful inline errors, and mobile touch targets.
- Do not add a form library, state-management library, drag-and-drop package, or database migration.

## Review Focus

- An API response with missing profile/rules arrays must normalize to safe empty form values; covered in Task 1.
- Back/forward navigation after a failed save must keep all typed values and remain on the current step; covered in Task 2.
- Clicking Skip with non-empty optional input must request confirmation rather than silently delete it; covered in Task 3.
- Reordering/removing pillars must preserve a maximum of four and submit the visible order; covered in Task 3.
- Cancelling a Profile section while a save is in flight must be disabled so the overview cannot show stale data; covered in Task 4.

---

## File Structure

### New files

- `web/src/features/profile/profile-form-model.ts` — form types, API normalization, completion summaries, and exact step payload creation.
- `web/src/features/profile/profile-form-model.test.ts` — defensive normalization/payload tests.
- `web/src/features/profile/interview-options.ts` — stable labels, hints, suggested choices, and optionality metadata.
- `web/src/features/profile/use-profile-interview.ts` — load/save/resume state and cancellation.
- `web/src/features/profile/use-profile-interview.test.tsx` — request/state lifecycle tests.
- `web/src/features/profile/interview-shell.tsx` — progress, save state, navigation, and card layout.
- `web/src/features/profile/interview-steps.tsx` — focused panels for six stored sections.
- `web/src/features/profile/onboarding-form.test.tsx` — first-time and edit-mode interaction tests.
- `web/src/features/profile/profile-editor.tsx` — section overview and focused edit mode.
- `web/src/features/profile/profile-editor.test.tsx` — overview/edit switching tests.
- `web/e2e/onboarding.spec.ts` — mocked first-time and returning-user journeys.

### Modified files

- `web/src/features/profile/onboarding-form.tsx` — thin orchestration around the new model/hook/panels.
- `web/src/features/profile/schema.ts` and tests — retain exact API shape while pinning optional empty sections.
- `web/src/features/profile/service.ts` and integration tests — confirm step save/resume does not delete unrelated sections.
- `web/src/app/onboarding/page.tsx` — render first-time interview.
- `web/src/app/profile/page.tsx` — render `ProfileEditor` plus data export.
- `web/src/app/api/profile/route.test.ts` — validation response contract.

---

### Task 1: Extract a defensive profile form model

**Files:**
- Create: `web/src/features/profile/profile-form-model.ts`
- Create: `web/src/features/profile/profile-form-model.test.ts`
- Create: `web/src/features/profile/interview-options.ts`
- Modify: `web/src/features/profile/schema.ts`
- Modify: `web/src/features/profile/service.test.ts`

**Interfaces:**
- Produces: `InterviewStep = 1 | 2 | 3 | 4 | 5 | 6`.
- Produces: `ProfileFormState`, `emptyProfileForm`, `normalizeProfileState(raw)`, `payloadForStep(form, step)`, `clearOptionalSection(form, step)`, `firstIncompleteStep(raw)`, and `sectionSummaries(form)`.
- Produces: `INTERVIEW_SECTIONS` and suggested choice arrays.
- Consumes: existing `/api/profile` response and `onboardingInput` step payloads.

- [ ] **Step 1: Write normalization, payload, and completion tests**

```ts
it("normalizes a new user without assuming nested arrays", () => {
  expect(normalizeProfileState({ profile: null })).toEqual(expect.objectContaining({
    name: "", work: "", audience: "", pillars: [], samples: [""], stories: [{ title: "", details: "", usageNote: "" }],
  }));
});

it("preserves exact multiline samples and story details", () => {
  const form = normalizeProfileState({ samples: [{ text: "Line one\n\nLine two." }], stories: [{ title: "Launch", details: "Exact — details", usage_note: "Use for lessons" }] });
  expect(payloadForStep(form, 4)).toMatchObject({ samples: ["Line one\n\nLine two."] });
  expect(payloadForStep(form, 6)).toMatchObject({ stories: [{ title: "Launch", details: "Exact — details", usageNote: "Use for lessons" }] });
});

it("creates deliberate empty payloads for optional sections", () => {
  expect(payloadForStep(emptyProfileForm, 4)).toEqual({ step: 4, samples: [], voiceTraits: [] });
  expect(payloadForStep(emptyProfileForm, 6)).toEqual({ step: 6, stories: [] });
});
```

Test step 1–3 required completion, step 4–6 optional completion, four-pillar truncation rejection, missing rules, and `firstIncompleteStep` boundaries.

- [ ] **Step 2: Run the model tests and verify failure**

```bash
cd web
npm test -- --run src/features/profile/profile-form-model.test.ts src/features/profile/service.test.ts
```

Expected: FAIL because the model module does not exist.

- [ ] **Step 3: Implement exact normalization and payload construction**

Define the form with arrays rather than newline-encoded values:

```ts
export type ProfileFormState = {
  name: string; work: string; location: string; audience: string; goal: string;
  pillars: string[]; samples: string[]; voiceTraits: string[];
  lengthPreference: string; casing: string; hashtags: string; emoji: string; cta: string;
  bannedTerms: string[]; notes: string; stories: StoryForm[];
};
```

Normalize missing collections with `Array.isArray`, retain exact sample/story strings, and trim only list labels when creating payloads. `payloadForStep` must return the current `onboardingInput` discriminated-union shape exactly.

`clearOptionalSection` returns a new form with only the selected optional section cleared: samples/traits for step 4, preference fields for step 5, and stories for step 6. It throws for steps 1–3 so a required section can never accidentally use the skip path.

Add metadata:

```ts
export const INTERVIEW_SECTIONS = [
  { step: 1, label: "About you", optional: false },
  { step: 2, label: "Audience and goal", optional: false },
  { step: 3, label: "Content topics", optional: false },
  { step: 4, label: "Writing voice", optional: true },
  { step: 5, label: "Content preferences", optional: true },
  { step: 6, label: "Real stories", optional: true },
] as const;
```

Add fixed choice arrays for audience starters, goal starters, voice traits, post length, capitalization, hashtag frequency, emoji frequency, and ending style. Every list includes a custom path in the UI rather than an “Other” value persisted to the database.

- [ ] **Step 4: Pin optional API inputs in the existing schema tests**

Assert step 4 accepts `samples: []`, step 5 accepts empty strings/lists, and step 6 accepts `stories: []`; continue rejecting blank array items and more than four pillars.

- [ ] **Step 5: Run model/schema tests**

```bash
cd web
npm test -- --run src/features/profile/profile-form-model.test.ts src/features/profile/service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the profile form model**

```bash
git add web/src/features/profile/profile-form-model.ts web/src/features/profile/profile-form-model.test.ts web/src/features/profile/interview-options.ts web/src/features/profile/schema.ts web/src/features/profile/service.test.ts
git commit -m "refactor: model conversational profile interview"
```

---

### Task 2: Build cancellable load, save, and resume state

**Files:**
- Create: `web/src/features/profile/use-profile-interview.ts`
- Create: `web/src/features/profile/use-profile-interview.test.tsx`
- Modify: `web/src/app/api/profile/route.test.ts`

**Interfaces:**
- Produces: `useProfileInterview({ edit, initialStep })` with `form`, `step`, `loaded`, `saving`, `saveState`, `error`, `update`, `saveAndContinue`, `skipAndContinue`, `goBack`, and `goToStep`.
- Consumes: Task 1 normalization/payload helpers and `/api/profile` GET/PATCH.

- [ ] **Step 1: Write hook lifecycle tests**

Use a probe component and mocked fetch. Cover loading an empty profile, resuming from `onboarding_step + 1`, edit mode starting at the requested section, successful PATCH, failed PATCH retaining values/current step, and abort on unmount.

```ts
it("keeps typed answers when save fails", async () => {
  mockProfileGet({ profile: { onboarding_step: 1 } });
  mockProfilePatch({ ok: false, body: { error: "Please check the required fields" } });
  render(<Probe />);
  await user.type(await screen.findByLabelText("Audience"), "AI founders");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByLabelText("Audience")).toHaveValue("AI founders");
  expect(screen.getByText("Please check the required fields")).toBeVisible();
  expect(screen.getByTestId("step")).toHaveTextContent("2");
});
```

Add a test that a second click while `saving` is true sends only one PATCH.

- [ ] **Step 2: Run the hook/API tests and verify failure**

```bash
cd web
npm test -- --run src/features/profile/use-profile-interview.test.tsx src/app/api/profile/route.test.ts
```

Expected: FAIL because the hook does not exist and the route validation response is not fully asserted.

- [ ] **Step 3: Implement the hook as the only network owner**

The initial request uses an `AbortController`. Successful loading chooses `initialStep` in edit mode or `Math.min(6, onboarding_step + 1)` in first-time mode. The save function never clears form state before PATCH:

```ts
async function persist(target: InterviewStep) {
  if (saving) return false;
  setSaving(true); setError(""); setSaveState("saving");
  try {
    const response = await fetch("/api/profile", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify(payloadForStep(form, target)),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Could not save this section.");
    setSaveState("saved");
    return true;
  } catch (caught) {
    setSaveState("idle");
    setError(caught instanceof Error ? caught.message : "Could not save this section.");
    return false;
  } finally { setSaving(false); }
}
```

Only advance after `persist()` returns true. `goBack` never saves implicitly. `skipAndContinue` calculates `const cleared = clearOptionalSection(form, step)`, submits `payloadForStep(cleared, step)` directly so it cannot observe stale React state, and sets `form` to `cleared` only as part of that operation.

- [ ] **Step 4: Expand the profile route contract test**

Mock `saveOnboardingStep`; assert a Zod error returns status 400 with stable top-level copy and details, while service success returns the updated state. Do not expose database errors.

- [ ] **Step 5: Run the hook/API tests**

```bash
cd web
npm test -- --run src/features/profile/use-profile-interview.test.tsx src/app/api/profile/route.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit interview persistence**

```bash
git add web/src/features/profile/use-profile-interview.ts web/src/features/profile/use-profile-interview.test.tsx web/src/app/api/profile/route.test.ts
git commit -m "feat: add resumable profile interview state"
```

---

### Task 3: Build the conversational interview shell and six focused panels

**Files:**
- Create: `web/src/features/profile/interview-shell.tsx`
- Create: `web/src/features/profile/interview-steps.tsx`
- Modify: `web/src/features/profile/onboarding-form.tsx`
- Create: `web/src/features/profile/onboarding-form.test.tsx`
- Modify: `web/src/app/onboarding/page.tsx`

**Interfaces:**
- Produces: `InterviewShell` with progress, saved state, Back/Skip/Continue actions.
- Produces: `InterviewStepPanel({ step, form, update })`.
- Produces: `OnboardingForm({ edit?, initialStep?, onDone?, onCancel?, onSavingChange? })`.
- Consumes: creation-plan UI primitives and Tasks 1–2 form model/hook.

- [ ] **Step 1: Write first-time interaction and accessibility tests**

Cover visible `2 of 6` progress, one `h1`, choice chips implemented as buttons with `aria-pressed`, inline validation, custom choices, ordered/removable pillars, up to five samples, preferences as segmented choices, optional story usage note, Back, Skip, save state, and final navigation to `/create`.

```ts
it("requires essentials but lets the user explicitly skip stories", async () => {
  render(<OnboardingForm />);
  await advanceToStep(6);
  expect(screen.getByText(/Cadence will never invent personal experiences/i)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Skip for now" }));
  expect(fetch).toHaveBeenLastCalledWith("/api/profile", expect.objectContaining({
    method: "PATCH",
    body: JSON.stringify({ step: 6, stories: [] }),
  }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/create"));
});

it("confirms before skipping typed optional content", async () => {
  await user.type(screen.getByLabelText("Writing sample 1"), "Keep this draft");
  await user.click(screen.getByRole("button", { name: "Skip for now" }));
  expect(screen.getByRole("alertdialog", { name: "Discard this section?" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText("Writing sample 1")).toHaveValue("Keep this draft");
  expect(fetch).not.toHaveBeenCalledWith("/api/profile", expect.objectContaining({ method: "PATCH" }));
});
```

- [ ] **Step 2: Run the component test and verify failure**

```bash
cd web
npm test -- --run src/features/profile/onboarding-form.test.tsx
```

Expected: FAIL against the current dense form.

- [ ] **Step 3: Build the interview shell**

Render the section label, `Step N of 6`, progress bar with `aria-valuenow`, save-state text, card body, and navigation. Keep the title inside the panel so each step asks one primary question. Navigation buttons use the shared Button primitive and remain disabled while saving.

```tsx
<div role="progressbar" aria-label="Profile setup progress" aria-valuemin={1} aria-valuemax={6} aria-valuenow={step}>
  <div style={{ width: `${(step / 6) * 100}%` }} />
</div>
```

- [ ] **Step 4: Implement six focused step panels**

Use the fixed options from Task 1 and always provide a labeled custom field. Pillars are ordered by their visible array position and use Move up/Move down buttons rather than drag-only behavior. Preferences use radio/segmented controls with explicit values such as `short`, `medium`, `long`; `sentence`, `title`, `lower`; `none`, `few`, `several`; and matching human labels.

The story panel includes this exact explanation: “Cadence may use only the details you add here. It will never invent personal experiences.” Each story exposes title, details, usage note, and Remove.

- [ ] **Step 5: Replace `OnboardingForm` with thin orchestration**

Load the hook, render a matching skeleton while loading, render a recoverable alert if GET fails, and pass the active panel to `InterviewShell`. If an optional section contains typed data, Skip opens an inline `role="alertdialog"` with “Keep editing” and “Discard and skip”; only the latter calls the hook's atomic `skipAndContinue`. Empty optional sections skip directly. Notify `onSavingChange` whenever saving changes. On successful step 6 in first-time mode, navigate to `/create`; saving one section in edit mode calls `onDone` instead of advancing. In edit mode, `onCancel` returns to the overview and its button is disabled while saving.

- [ ] **Step 6: Run component and service tests**

```bash
cd web
npm test -- --run src/features/profile/onboarding-form.test.tsx src/features/profile/use-profile-interview.test.tsx src/features/profile/profile-form-model.test.ts src/features/profile/service.test.ts
npm run lint
```

Expected: PASS with no duplicate labels, invalid nesting, or hook warnings.

- [ ] **Step 7: Commit conversational onboarding**

```bash
git add web/src/features/profile web/src/app/onboarding/page.tsx
git commit -m "feat: redesign voice onboarding interview"
```

---

### Task 4: Add the returning-user profile overview and focused editing

**Files:**
- Create: `web/src/features/profile/profile-editor.tsx`
- Create: `web/src/features/profile/profile-editor.test.tsx`
- Modify: `web/src/app/profile/page.tsx`
- Modify: `web/src/features/profile/service.integration.test.ts`

**Interfaces:**
- Produces: `ProfileEditor()` with overview/edit modes.
- Consumes: Task 1 `sectionSummaries` and Task 3 `OnboardingForm` edit contract.

- [ ] **Step 1: Write overview and edit-mode tests**

```ts
it("summarizes sections and edits only the selected section", async () => {
  mockProfileGet(profileFixture);
  render(<ProfileEditor />);
  expect(await screen.findByRole("heading", { name: "Your voice profile" })).toBeVisible();
  expect(screen.getByText("3 content topics")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Edit Content topics" }));
  expect(screen.getByRole("heading", { name: /What topics do you want to be known for/ })).toBeVisible();
  expect(screen.queryByText("Step 1 of 6")).not.toBeInTheDocument();
});
```

Add tests for optional-section “Not added yet” labels, cancel returning to the overview, successful save refreshing summaries, and the Cancel button remaining disabled while a save is pending.

- [ ] **Step 2: Run the test and verify failure**

```bash
cd web
npm test -- --run src/features/profile/profile-editor.test.tsx
```

Expected: FAIL because `ProfileEditor` does not exist.

- [ ] **Step 3: Implement the section overview**

Fetch `/api/profile`, normalize it, and render six cards in stored order. Each card contains label, one safe summary, completeness badge, and an `Edit {label}` button. When selected, render `OnboardingForm edit initialStep={selected}` with `onDone`, `onCancel`, and `onSavingChange`; successful save returns to overview and reloads once.

Prevent stale switching by disabling overview buttons while the edit child reports saving. Do not render all six forms simultaneously.

- [ ] **Step 4: Update the Profile page without moving export controls**

Replace `<OnboardingForm edit />` with `<ProfileEditor />`. Keep JSON/Markdown export in its existing separate section, restyled with the shared Button/link classes.

- [ ] **Step 5: Add an integration assertion for unrelated-section preservation**

Extend the profile integration test: save steps 1–6, then update only step 3 and assert samples, rules, and stories remain byte-for-byte unchanged. Update only step 5 and assert pillars remain unchanged.

- [ ] **Step 6: Run component and database integration tests**

```bash
cd web
npm test -- --run src/features/profile/profile-editor.test.tsx
TEST_DATABASE_URL=1 DATABASE_URL=postgresql://postgres:cadence_test_only@127.0.0.1:55439/cadence_test2 npm test -- --run src/features/profile/service.integration.test.ts
```

Expected: PASS. If the isolated database is unavailable, establish it before reporting integration success.

- [ ] **Step 7: Commit profile overview/editing**

```bash
git add web/src/features/profile/profile-editor.tsx web/src/features/profile/profile-editor.test.tsx web/src/features/profile/service.integration.test.ts web/src/app/profile/page.tsx
git commit -m "feat: add focused voice profile editor"
```

---

### Task 5: Exercise the onboarding journey and run the final gate

**Files:**
- Create: `web/e2e/onboarding.spec.ts`
- Modify: `web/README.md`

**Interfaces:**
- Consumes: all previous onboarding plan interfaces and the shared UI foundation.
- Produces: repeatable mobile/desktop onboarding and profile-edit smoke coverage.

- [ ] **Step 1: Write the mocked first-time journey**

Intercept GET/PATCH `/api/profile`. Complete required steps using both suggested chips and custom text, skip preferences/stories, and assert each PATCH step number and final `/create` navigation.

```ts
await page.goto("/onboarding");
await expect(page.getByRole("heading", { name: /What should we call you/ })).toBeVisible();
await page.getByLabel("Name").fill("Ajmal");
await page.getByLabel("Work").fill("Founder");
await page.getByRole("button", { name: "Continue" }).click();
await expect(page.getByText("Step 2 of 6")).toBeVisible();
```

Finish by asserting the story consent explanation and that Skip sends `{ step: 6, stories: [] }`.

- [ ] **Step 2: Add returning profile and responsive checks**

Navigate to `/profile`, assert all six summary cards, edit Content topics, save, and return to the overview. Run in both configured Playwright projects and assert no horizontal document overflow:

```ts
expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
```

- [ ] **Step 3: Run the onboarding browser tests**

```bash
cd web
npm run test:e2e -- onboarding.spec.ts
```

Expected: PASS on desktop and Pixel 7 projects.

- [ ] **Step 4: Update product documentation**

Change README onboarding copy from a generic “six-step interview” to “a resumable guided voice interview,” documenting that samples, preferences, and stories can be added later and stories are never invented.

- [ ] **Step 5: Run the complete application gate**

```bash
cd web
npm test -- --run
npm run lint
npm run build
npm run test:e2e
```

Expected: all commands exit 0. Report database-dependent skipped tests separately instead of counting them as passes.

- [ ] **Step 6: Commit end-to-end coverage and documentation**

```bash
git add web/e2e/onboarding.spec.ts web/README.md
git commit -m "test: cover conversational onboarding journey"
```

- [ ] **Step 7: Production smoke check**

Deploy Vercel, sign in with an invited test account, complete or edit one profile section, reload to verify resume/persistence, check `/create` still accepts the completed profile, and confirm mobile layout at a narrow viewport. Do not use or alter another user's profile data.
