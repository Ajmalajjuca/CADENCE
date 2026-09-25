# Cadence invited beta

Cadence is an invitation-only LinkedIn content workspace. It interviews each user about their voice, researches topics with Claude, saves resumable creation stages, creates immutable draft versions, requires approval of the exact current version, and publishes only after a separate **Publish now** click.

## What is included

- Invitation-only Supabase Auth with magic-link sign-in
- Resumable six-step voice and profile interview
- Saved ideas and a searchable content Library
- Quick and guided creation paths with sourced research and hook choices
- Durable PostgreSQL worker jobs with stage recovery
- Per-user Anthropic API keys encrypted at rest, with separate curated research and writing models
- Immutable drafts, source links, direct editing, AI revisions, and exact-version approval
- Per-user LinkedIn OAuth with encrypted access tokens
- Duplicate-safe immediate publishing through LinkedIn's Posts API
- JSON and Markdown export, plus a preview-first importer for this repository's legacy Markdown

Scheduling, analytics-driven strategy updates, team roles, public signup, media posts, and Notion synchronization remain later projects.

## Local setup

Requirements: Node.js 20.19+, npm, Docker, a Supabase project or local Supabase, and a central LinkedIn application approved for the required member permissions. Each invited user adds their own Anthropic API key in **Settings** after signing in.

```bash
cp .env.example .env.local
npm install
npx supabase start
npx supabase db reset
npm run dev
```

In another terminal:

```bash
npm run worker
```

Disable public signup in Supabase and invite users from the dashboard. See [docs/auth-setup.md](docs/auth-setup.md) and [docs/operations.md](docs/operations.md).

## Web and worker deployment

The browser talks only to the Next.js application on Vercel. Supabase is the
durable job queue, and the separately deployed Render worker claims queued
work from the same database. Render does not need the Vercel URL.

Set the private **WORKER_URL** environment variable in Vercel production,
preview, and development to **https://cadence-3iwy.onrender.com**.

Cadence calls only the worker's **/health** path from server code after work is
queued; the Render URL is never sent to the browser. The request wakes a
sleeping free Render service while Supabase keeps the job safe. The GitHub
keep-awake workflow is best effort only and is not required for correctness.

On Vercel, **DATABASE_URL** must be Supabase's transaction pooler connection
string on port **6543** with **sslmode=require**. Do not use the IPv6-only
direct database hostname there. Keep the direct connection for migrations and
local tools.

## Tests

```bash
npm test -- --run
npm run db:test
npm run lint
npm run build
npm run test:e2e
```

Integration tests run when `TEST_DATABASE_URL=1` and `DATABASE_URL` points at an isolated migrated database. They create temporary users and remove them afterward.

## Legacy import

Preview is always the default and performs zero writes:

```bash
npm run import:legacy -- --root ..
```

After checking the preview, apply its current hash to one existing Supabase Auth user:

```bash
npm run import:legacy -- --root .. --apply --owner USER_UUID --preview-id PREVIEW_SHA256
```

The existing published post is imported as `legacy_published`, with its LinkedIn URL, and is blocked from publication again. Source Markdown files are never changed.
