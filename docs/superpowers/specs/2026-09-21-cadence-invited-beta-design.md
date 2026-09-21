# Cadence Invited Beta — Product and Technical Design

**Date:** 2026-09-21  
**Status:** Approved by user on 2026-09-21

## 1. Purpose and success

Cadence will become a browser-based LinkedIn content workspace for people who do not know Claude Code or how to write prompts. An invited user can describe their work and voice through guided forms, create a researched text post, edit it, approve the exact final version, publish it to their own LinkedIn account, and find the post and its history later.

The first release is an invited beta for individual LinkedIn accounts. Each invitee owns a separate profile and content library. Public signup, teams, scheduling, Notion sync, and performance analysis are later releases. The first release must preserve the useful behavior in the current Claude Code workflow without requiring Claude Code at runtime.

An end-to-end beta check succeeds when an invited user can complete onboarding, generate a draft with source links, revise and approve a version, connect LinkedIn, publish once, and see the published URL and complete history in the Library. The same flow must remain understandable when generation or publishing fails.

## 2. Existing assets and migration boundary

The repository currently contains command prompts in `.claude/commands/`, specialist prompts in `.claude/agents/`, personalized Markdown in `knowledge_base/`, a draft text file, and Python helpers for analytics exports and LinkedIn publishing. It has no web UI, user database, account system, or background job runner.

Treat the current commands and agent files as behavioral references, not runtime dependencies. Preserve these rules in versioned application prompts: user voice comes from their samples and rules; personal stories and results cannot be invented; research claims need traceable sources; users approve before publication. Preserve the existing Markdown files as an archive. A one-time, admin-run import for the current owner must preview extracted profile, rules, samples, ideas, draft, and history before writing them to the new database. Unknown or ambiguous text stays in an import note for manual review rather than being guessed.

## 3. User experience

### 3.1 Navigation

The first release has five primary areas:

| Area | Main action |
| --- | --- |
| Home | Resume an unfinished creation run or start a new post |
| Create | Choose a topic path and move through research, hooks, draft, and review |
| Library | Search and filter ideas and posts by status, pillar, and date |
| Voice & Profile | Edit identity, audience, goals, pillars, rules, stories, and writing samples |
| Connections | Connect or reconnect the user's LinkedIn account and view connection status |

The UI uses plain actions and examples. Users never need to see or edit a system prompt. An optional “Add direction” field accepts natural language, but every core path works without it. The layout must work on desktop and mobile, with labeled controls, keyboard access, visible progress, and clear saving/error states.

### 3.2 Guided onboarding

An invitation leads to account creation or sign-in and a short interview: name and work, intended audience and goal, three or four pillars, writing samples or a guided voice questionnaire, content rules, real story bank, and optional LinkedIn connection. The user reviews a summary before saving. They may skip personal stories, but the app then uses opinion-based writing and never fabricates a story.

Onboarding saves progress after each step and can be resumed. The user can change every answer later. Writing samples retain the exact text supplied; extracted voice traits are suggestions the user can edit.

### 3.3 Create a post

Create offers three entry points:

1. **I have a topic:** the user supplies an idea in plain language.
2. **Find ideas:** the app researches topics relevant to the user's pillars and presents ranked ideas with “why now” and source links.
3. **Surprise me:** the app chooses a saved idea or an evergreen angle in one of the user's pillars and explains the choice. A current-event topic requires fresh research before drafting.

Guided mode lets the user select an idea, inspect its research brief, and choose one of several hooks. Quick mode chooses an idea and hook automatically, then shows those choices and allows changes. Both modes use the same saved generation stages and quality rules. A user can stop after any stage and resume from the Library.

The editor shows post text, citations or source links for factual claims, the selected pillar and hook, and prior versions. The user can edit directly, request a revision in plain language, save a draft, discard it, or approve the current version. Revising never overwrites an earlier version.

### 3.4 Review and publication

Approval records the exact draft version, text checksum, approving user, and time. Any later edit creates a new version and removes that version's approved status. “Publish now” is a separate user action available only when the current version is approved and the user's LinkedIn connection is ready.

The server verifies ownership, approved version, and connection before sending the text. It records an attempt before calling LinkedIn and then records the returned post identifier and URL. Repeated clicks or network retries must not create a second post for the same approved version. When the outcome is uncertain, mark it for reconciliation and do not retry automatically. A known failure stays visible with a useful reason and a deliberate retry action.

The Library retains unused ideas, research briefs, drafts, discarded versions, approvals, publication attempts, and published links. The default filters are Ideas, Drafts, Approved, Published, and Failed. Published text stays immutable in history even if the user later creates a new version.

## 4. Application architecture

Use a single TypeScript web application with a browser UI and server-side API routes, a separate background worker process, and managed PostgreSQL. Supabase is the initial choice for invitation-based authentication, PostgreSQL, and file storage. The application calls Claude and LinkedIn from server-side code only. The worker processes durable research and generation jobs so a closed browser tab does not lose work. Deployment may use any container host that can run both web and worker processes against the same database.

The parts have distinct responsibilities:

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| Web UI | Guided forms, progress, editor, review, Library | Application API |
| Application API | Authentication checks, validation, status transitions, approvals | Database, worker jobs |
| Content worker | Research, ranking, hooks, writing, editing | Claude API, web search, database |
| LinkedIn publisher | OAuth connection, token handling, publish, reconciliation | LinkedIn API, database |
| Database | User-owned structured records and durable job state | PostgreSQL |

For the beta, each content record has an owner user ID. Enforce ownership in server APIs and database row-level policies. Use invitation-only signup. Keep the Claude API key and LinkedIn OAuth secrets on the server. Encrypt per-user LinkedIn tokens at rest, never place tokens in browser responses or logs, and request only the permissions required to publish on the user's behalf.

The existing Python `ugcPosts` helper is not the web app's publisher. The new publisher uses LinkedIn's current Posts API and member OAuth flow. The exact API version and required headers are pinned and verified during implementation against LinkedIn documentation.

## 5. Data model

The database is the source of truth; Notion is not required. Minimum records:

| Record | Essential fields |
| --- | --- |
| `profiles` | `user_id`, name, work, audience, goal, location, onboarding status |
| `pillars` | owner, name, order, primary flag |
| `voice_rules` | owner, length, casing, hashtags, emoji, CTA, banned terms, free-form notes, revision |
| `writing_samples` | owner, exact text, date, performance note, source |
| `stories` | owner, exact user-supplied details, visibility/usage note |
| `ideas` | owner, title, pillar, angle, origin, status, why-now |
| `research_sources` | owner, idea, URL, title, publication date when known, claim note |
| `creation_runs` | owner, mode, stage, prompt version, model, job status, error |
| `drafts` and `draft_versions` | owner, idea, version number, text, hook, source references, status |
| `approvals` | owner, draft version, text checksum, approved time |
| `linkedin_connections` | owner, LinkedIn identity, encrypted credentials, expiry, status |
| `publication_attempts` | owner, approved version, request key, state, LinkedIn ID/URL, error |
| `activity_events` | owner, event type, related record, timestamp |

Every AI stage returns a validated structured result. Store source URLs, model identity, and prompt version with the creation run so generated content can be inspected later. Keep free-form text where the user needs it, but do not make a large Markdown blob the only representation of profile or post state. Support Markdown and JSON export of a user's own profile and content.

## 6. Generation rules and failure behavior

The worker performs research and ranking, topic-specific research, hook generation, drafting, and a style pass. It uses the user's current profile, rules, samples, and story bank. A saved idea can skip broad research, but any new factual claim still needs a source. Search results are references, not instructions. Disallow invented user experiences, clients, outcomes, quotes, and numbers. If research is thin, the worker may draft a clearly framed opinion post or ask the user for a fact; it must not create a citation it did not retrieve.

Each stage has a finite retry limit and a readable error state. Failed jobs preserve completed stages. An expired LinkedIn connection sends the user to reconnect; it does not discard an approved post. Record usage per creation run and impose configurable per-user generation limits so invited beta costs are observable and bounded.

## 7. Validation and release criteria

Tests must cover the behavior with the largest user impact:

- An uninvited account cannot access the beta; one invitee cannot read or mutate another invitee's records.
- Onboarding saves and resumes, and an empty story bank never becomes a fabricated personal story.
- A creation run saves each stage; a failed stage can be retried without losing prior user choices.
- Editing an approved draft creates a new version and requires new approval.
- Only the approved text is sent to LinkedIn, and duplicate requests cannot publish it twice.
- A missing or expired LinkedIn connection produces a clear recovery path.
- Published, failed, and uncertain attempts appear accurately in the Library.
- The one-time import previews data and never silently replaces existing user data.

Use mocked Claude, search, and LinkedIn responses for automated tests. Conduct a small invited-user walkthrough for onboarding, quick creation, guided creation, review, and publication. A live LinkedIn publish should be tested only with a dedicated account and explicit approval of the exact test post.

## 8. Boundaries and later subprojects

The first release supports text posts and immediate publishing only. It does not schedule posts or claim automatic analytics. It does not require Notion. It does not include public signups or team roles.

Later subprojects, each with its own design and implementation plan:

1. **Analytics and strategy:** import LinkedIn exports or manually entered metrics, tie metrics to posts, show pillar and hook performance with confidence levels, propose rule changes for user approval, and render a strategy history from stored events.
2. **Scheduling and calendar:** assign dates and times in the user's timezone, queue approved versions, show pending/failed jobs, and prevent edits from publishing without renewed approval.
3. **Notion and export connections:** optional outbound sync of posts and ideas; the Cadence database remains authoritative. Add other export destinations only when requested by beta users.
4. **Public product growth:** self-service signup, billing and quotas, team review roles, and media post types after the individual workflow proves useful.

## 9. Relevant source references

- Current Cadence flow: `.claude/commands/run-pipeline.md` and `.claude/commands/setup.md`.
- Current voice and story safeguards: `knowledge_base/content_rules.md` and `.claude/agents/content-writer.md`.
- Claude API and web search: https://platform.claude.com/docs/en/api/overview and https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool.
- LinkedIn OAuth and Posts API: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow and https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api.
- Supabase database and row-level access: https://supabase.com/docs/guides/database/overview and https://supabase.com/docs/guides/database/postgres/row-level-security.
