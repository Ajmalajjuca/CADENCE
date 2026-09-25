# Cadence Creation Reliability and Onboarding UX Design

**Date:** 2026-09-25  
**Status:** Approved in conversation; awaiting written-spec review  
**Scope:** Phase 1 creation reliability/progress and Phase 2 voice onboarding/profile editing

## Intent

Cadence should feel like a calm, trustworthy writing workspace. A user who starts a post must understand what is happening, be able to leave safely, and receive a useful next action if generation fails. A new user should be able to teach Cadence the essentials of their voice without completing a dense configuration form.

The work must preserve the existing Next.js, Supabase, Vercel, and Render architecture; existing authentication and user data; per-user Anthropic credentials; and the free Render deployment. It must not expose the Render URL or provider diagnostics to the browser.

## Current Problems

The production run `5012bc2d-0edc-4e06-a742-79d0e81ca67b` remained `queued` because the free Render service had gone idle. Render free web services sleep after fifteen minutes without inbound traffic and can take about a minute to start. Once manually awakened, the worker claimed the run and the idea stage failed. The current worker converted that non-provider exception into the generic `GENERATION_FAILED`, so the database and UI could not explain the cause.

The current run screen displays only one status sentence, such as “Finding ideas.” It has no visible stages, elapsed-time context, worker-wakeup state, delayed-job guidance, or recovery until a failure is recorded.

The current onboarding experience presents six pages of mostly raw text fields. It does not distinguish essential from optional information, explain the benefit of answers, provide useful choices, or make save/resume behavior sufficiently visible. Profile editing repeats the same large wizard without a useful overview.

## Goals

- Wake the free Render worker whenever Cadence enqueues more work.
- Keep Supabase as the durable source of truth for job state.
- Show meaningful queued, waking, processing, choice, success, and failure states.
- Preserve completed stages and make retries idempotent.
- Convert AI and worker failures into safe, actionable categories.
- Make first-time voice setup conversational, resumable, and achievable in roughly three minutes for essential fields.
- Establish a warm editorial UI foundation that can be reused across the rest of the application.
- Preserve keyboard access, screen-reader status announcements, responsive behavior, and reduced-motion preferences.

## Non-goals

- Moving generation into Vercel functions.
- Replacing Supabase or Render.
- Keeping the Render worker permanently awake.
- Exposing raw Anthropic responses, prompts, API keys, or provider messages.
- Deeply redesigning Ideas, Library, Settings, or post editing in this phase. Those pages inherit the new shell and design tokens; their workflows are a later phase.
- Adding real-time infrastructure such as WebSockets or Supabase Realtime. Polling is sufficient for the current scale.

## Selected Product Direction

The approved creation view is a focused, centered progress card. It explains the active work, shows the complete journey, and reassures the user that progress is saved and the page can be left safely.

The approved first-time interview is a guided conversation with one meaningful question at a time. Returning profile editing uses a concise section overview and reopens the same focused editor for an individual section.

The approved visual direction is warm editorial: paper-toned backgrounds, warm white surfaces, ink-green text, restrained terracotta actions, sage success states, editorial headings, readable sans-serif body text, soft borders, and subtle shadows.

## Architecture

The browser continues to call only the Vercel application. It never calls Render directly.

1. The authenticated Vercel route validates a creation request and inserts a queued run in Supabase.
2. The route returns the saved run immediately.
3. Using Next.js `after()`, Vercel makes a bounded server-side request to `WORKER_URL/health`. This inbound request wakes Render without delaying the user response.
4. The Render worker claims a queued stage through the existing database lease function.
5. The worker loads the user's voice and encrypted per-user AI settings, calls Anthropic, validates the output, and persists the completed stage.
6. The browser polls the Vercel run endpoint and renders the state stored in Supabase.
7. Selecting an idea or hook, retrying a failed stage, or explicitly requesting another wake repeats the server-side wake step because each action can enqueue more work.

The health request is an availability signal, not a job command. Supabase remains the queue and source of truth, so duplicate wake requests are harmless and a failed wake request does not lose work.

## Worker Wake Boundary

A focused server module owns worker wake behavior. It reads and validates the private `WORKER_URL`, constructs the health URL, applies a short timeout, and returns a small safe result suitable for structured logging. It never returns the configured URL to client code.

Wake attempts happen after successful mutations that leave a run queued:

- Starting a creation run.
- Selecting an idea.
- Selecting a hook.
- Retrying a failed stage.

When a run remains queued unusually long, the UI offers “Wake worker and check again.” Its authenticated endpoint verifies that the run belongs to the current user and is still queued before issuing another bounded wake request. Requests are rate-limited per run so repeated clicks cannot create an unbounded stream of health requests.

The explicit endpoint permits one wake request per owned run every thirty seconds. It records only the run ID and event type in the existing `activity_events` table; it does not require a new table or store the worker URL.

Missing or invalid `WORKER_URL` is a server configuration failure. The queued run remains intact, the server logs a safe configuration category, and the user sees delayed-job recovery rather than an exposed environment error.

## Creation Experience

The progress card displays these user-facing stages:

1. Find an idea.
2. Research the angle.
3. Create hooks.
4. Write the draft.
5. Polish your voice.

Revision runs use a shorter variant that clearly labels the revision step. Completed stages show a check, the active stage uses the terracotta progress treatment, and future stages remain visible but subdued.

### State behavior

| Persisted condition | User experience | Available action |
| --- | --- | --- |
| Initial load | Skeleton matching the progress card | None |
| Queued for under 10 seconds | “Preparing your run” | Leave safely |
| Queued for 10–90 seconds | “Worker is waking up—usually 30–90 seconds” | Leave safely |
| Queued for more than 90 seconds | “This is taking longer than expected” | Wake worker and check again |
| Running | Active stage, elapsed time, saved-progress reassurance | Leave safely |
| Waiting for idea | Idea choices replace the passive progress body | Choose an idea |
| Waiting for hook | Hook choices replace the passive progress body | Choose a hook |
| Complete | Completion confirmation | Review draft |
| Recoverable failure | Stage-specific explanation; prior work remains visible | Retry stage |
| Settings failure | Configuration explanation | Open Settings |
| Load/network failure | Connection explanation without discarding the last known run | Try again |

Polling runs every 2.5 seconds only while the job is queued or running. It stops in waiting, complete, and failed states and pauses while the document is hidden. Requests use cancellation to avoid updates after unmount. Status changes are announced through a polite live region without repeatedly announcing an unchanged poll result.

## AI Reliability and Error Handling

The AI transport and domain boundary classify failures before they reach the generic worker catch.

Public error categories include:

- `AI_SETTINGS_REQUIRED`: configure Claude.
- `AI_SETTINGS_INVALID`: replace or revalidate the key.
- `AI_MODEL_UNAVAILABLE`: choose an available model.
- `AI_CREDIT_REQUIRED`: add provider credit.
- `AI_RATE_LIMITED`: wait and retry.
- `AI_PROVIDER_UNAVAILABLE`: retry later.
- `AI_OUTPUT_INCOMPLETE`: Claude stopped because of refusal, output limit, or missing structured text.
- `AI_OUTPUT_INVALID`: returned JSON did not satisfy Cadence's expected shape.
- `GENERATION_FAILED`: unexpected internal failure with no safe specific category.

The Anthropic response parser checks `stop_reason` before parsing, confirms a text block exists, handles JSON parsing separately, and validates the domain schema separately. Provider SDK failures retain a provider request ID where available.

Token limits are sized per output type. Idea generation requests up to five concise ideas with a 3,200-token output budget. Research uses 2,400 tokens, hooks use 1,800 tokens, and drafts, style passes, and revisions use 3,000 tokens. An incomplete response is never passed to `JSON.parse` as though it were complete.

Server logs contain only the run ID, stage, stable category, safe error class, attempt count, and provider request ID. They never include encrypted credentials, decrypted API keys, prompts, user content, raw provider bodies, or database connection strings.

## Conversational Voice Interview

The stored domain model remains compatible with the current six profile areas:

1. About you.
2. Audience and goal.
3. Content topics.
4. Writing voice.
5. Content preferences.
6. Real stories.

Each first-time screen has one primary question, a short explanation, examples, suggested choices where applicable, a custom answer path, visible progress, and clear Back/Continue controls. Optional sections also offer “Skip for now.” Successful navigation confirms that the section was saved. A returning user resumes at the first incomplete section.

### Input improvements

- Audience and goal offer common choices plus custom text.
- Topics use removable ordered items with a four-topic limit and clear primary-topic meaning.
- Writing voice supports samples and selectable tone traits, with custom traits available.
- Length, capitalization, hashtags, emojis, and ending style use understandable choice controls instead of unexplained text fields.
- Banned terms and additional rules remain text inputs with examples.
- Stories explain that Cadence may use only submitted details and will not invent personal experiences.

The essential path emphasizes identity, audience, goals, topics, and enough voice guidance to create useful output. Extra samples, detailed preferences, and stories remain editable later. Skipping optional content stores a deliberate empty result rather than silently losing typed text.

The Profile page becomes a section overview with completion summaries. Opening a section uses the same focused interview component in edit mode. Data export remains available as a separate account action.

## UI Foundation

Global CSS variables define background, surfaces, ink, muted text, accent, success, waiting, danger, borders, radii, shadows, focus rings, and spacing. Typography uses Newsreader for editorial headings and Inter for controls and body copy, loaded through `next/font` with serif and system-sans fallbacks.

Reusable UI boundaries include:

- Application shell and responsive navigation.
- Page heading and content containers.
- Button variants.
- Text input, text area, select, choice chips, and segmented controls.
- Status badges and alert callouts.
- Progress timeline and progress card.
- Empty, loading, error, and retry states.
- Interview shell, step progress, and save indicator.

Controls have visible keyboard focus, semantic labels, at least comfortable touch targets, sufficient contrast, and non-color indicators. Motion is restrained and disabled or reduced for users who request reduced motion.

Phase 1–2 fully applies these components to Create, creation progress, onboarding, and profile editing. Other application pages adopt the global typography, colors, surfaces, controls, and navigation without changing their underlying workflows.

## Component and Module Boundaries

The design favors small units with one purpose:

- Worker wake configuration and transport are server-only.
- Creation state derivation converts persisted run data and elapsed time into a view model.
- Progress presentation renders that view model without knowing how the worker is hosted.
- Run actions own API mutations and refresh behavior.
- Interview section definitions own labels, hints, optionality, and choice data.
- Interview persistence maps one section to the existing profile API.
- UI primitives own visual consistency and accessibility behavior.

This separation makes wake behavior, state derivation, polling, interview persistence, and presentation independently testable.

## Security and Privacy

- `WORKER_URL` is private server configuration and is not prefixed with `NEXT_PUBLIC_`.
- Wake endpoints require an authenticated user and ownership of the queued run.
- Existing row ownership checks remain mandatory for every run and profile operation.
- Per-user Anthropic keys remain encrypted and are decrypted only by server/worker code.
- Public errors contain stable codes and safe messages only.
- The application does not log user writing samples, stories, prompts, or generated post text as diagnostics.

## Testing Strategy

Development follows tests-first changes for each behavior.

### Unit and component tests

- Worker wake success, timeout, non-OK response, invalid configuration, and URL privacy.
- Run view-model derivation for every queued-time threshold and terminal state.
- Polling lifecycle, document visibility, cancellation, and unchanged live-region text.
- Error-category-to-message/action mapping.
- Anthropic refusal, max-token, missing-text, invalid-JSON, and schema-validation responses.
- Idea-generation token-budget and concise-count parameters.
- Interview navigation, validation, choices, custom answers, skipped optional sections, and edit mode.
- UI keyboard behavior and accessible names/status roles.

### Integration tests

- Enqueueing a run schedules a wake without delaying or changing the saved response.
- Idea/hook choice and retry leave the run queued and schedule another wake.
- The explicit wake endpoint rejects non-owned or non-queued runs.
- Profile sections save and resume without deleting unrelated sections.
- Stable failure codes survive the worker-to-database-to-API path.

### End-to-end verification

A mocked journey covers sign-in, essential onboarding, starting “Find ideas,” cold-worker messaging, active progress, guided choices, a recoverable failure, retry, and opening a completed draft. Responsive layouts are checked at mobile and desktop widths.

Before deployment, the full test suite, lint, and production build must pass. After deployment, a real owned test run verifies that Vercel wakes Render and that the run proceeds beyond the idea stage. If Anthropic rejects the request, the safe server category and provider request ID must make the specific integration problem diagnosable without revealing provider content.

## Rollout

1. Add the private `WORKER_URL` to Vercel production, preview, and development environments.
2. Deploy the server wake boundary and AI error categorization with tests.
3. Deploy the creation progress experience and verify a real cold-start run.
4. Deploy the UI foundation and conversational onboarding/profile editor.
5. Run production smoke checks for authentication, profile save/resume, creation, retry, and draft review.
6. Retain the existing GitHub keep-awake workflow only as best effort; correctness must not depend on its schedule.

## Acceptance Criteria

- Starting a run causes a server-side Render wake request without exposing Render to the browser.
- A cold worker produces a clear waking message rather than an indefinite generic “Finding ideas” state.
- A user can leave and reopen a run without losing progress.
- Every stable run state has a distinct accessible presentation and appropriate action.
- Provider, output, settings, and unexpected failures no longer all collapse into the same message.
- The known production idea-stage failure becomes diagnosable and either completes after the integration fix or displays the correct actionable category.
- A new user can complete essential voice setup through the conversational flow and resume after leaving.
- A returning user can edit one profile section without stepping through the entire interview.
- Create, progress, onboarding, and profile pages match the approved warm editorial direction on mobile and desktop.
- Existing data, authentication, per-user AI settings, LinkedIn configuration, and publishing behavior remain intact.
- Tests, lint, and the production build pass before deployment.
