# Live two-user release check

The last item of `docs/superpowers/plans/2026-09-21-per-user-anthropic-settings.md` (Task 8, Step 6). Everything else in that plan is implemented, verified, and committed; this check needs two real Anthropic keys and a running web plus worker, so it is run by hand.

Use **dedicated test keys**, not a production user's key. One harmless draft per user is enough.

## 0. Before you start

Remove the three leftover global Anthropic variables from `.env.local`:

```
ANTHROPIC_API_KEY
ANTHROPIC_RESEARCH_MODEL
ANTHROPIC_WRITING_MODEL
```

No code reads them any more (`grep -rn 'ANTHROPIC_API_KEY\|ANTHROPIC_MODEL' src/` is empty), but deleting them removes any doubt that generation is running on a per-user key.

### Which database is this running against?

```bash
grep -E '^(SUPABASE_URL|APP_URL)=' .env.local
```

`.env.local` currently points at the **hosted** Supabase project, so everything below would touch real project data and real email delivery. Pick one before going further:

**Option A — run the check against the local stack (recommended).** Keep a copy of your current `.env.local`, then point it at the local stack: `SUPABASE_URL=http://127.0.0.1:54321`, the local anon and service-role keys, and `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres` (all four are printed by `supabase status`). Magic links then land in Inbucket at `http://localhost:54324` and the two test users never exist anywhere real. Restore your file afterwards.

**Option B — run it against the hosted project.** Then use two real addresses you can receive mail at instead of `@example.test`, delete both users from the Supabase dashboard when you are done, and run the SQL below in the dashboard's SQL editor rather than through `psql`.

Note on `psql` and your URL: the hosted password contains `@`, and `psql` splits on the *first* `@` while `pg` splits on the last, so `psql "$DATABASE_URL"` fails with a hostname error even though the app connects fine. Use the SQL editor, or percent-encode the password as `%40`.

Confirm the migration is applied against whichever database you chose — this must return a count, even zero:

```sql
select count(*) from public.user_ai_settings;
```

An `undefined table` error means migration `202609210005` has not been applied there; apply migrations before going further.

Start both processes in separate terminals:

```bash
npm run dev      # http://localhost:3000
npm run worker   # must be running, or runs stay queued
```

## 1. Create two invited users

Public signup is disabled, so create both accounts with the admin API:

```bash
set -a; . ./.env.local; set +a
for email in cadence-a@example.test cadence-b@example.test; do
  curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "content-type: application/json" \
    -d "{\"email\":\"$email\",\"email_confirm\":true}" | head -c 200; echo
done
```

Sign in at `http://localhost:3000/sign-in`. On the local stack the magic link is caught by Inbucket at `http://localhost:54324`; against the hosted project it is a real email to a real address. Use two browser profiles (or one normal and one private window) so both sessions can be open at once. Finish onboarding for each user — Create is gated on a complete voice profile as well as on Claude settings.

## 2. User A saves key A · Sonnet research, Opus writing

Settings → Claude: paste key A, pick **Claude Sonnet 5** for research and **Claude Opus 5** for writing, then **Validate and save**.

Expect: status `Configured`, only the last four characters of the key shown, and a validation timestamp.

## 3. User B saves key B · Opus research, Sonnet writing

Same page as user B, with the models the other way round. This is the check that matters most — it proves the two users' choices are independent, not global.

## 4. Each user creates one harmless draft

Create → "I have a topic" → something innocuous, Quick mode. Watch the worker terminal. Each run should reach `complete`, and the worker should log nothing but run ids, stages and codes — no key material, no Anthropic error text.

## 5. Inspect the database

Run this against the database you chose in step 0 — the SQL editor for the hosted project, or `psql` for the local stack:

```sql
-- Each run carries its own owner's snapshot, and they differ between users.
select owner_id, research_model, writing_model, ai_settings_revision, status
from public.creation_runs order by created_at desc limit 10;

-- Only an encrypted envelope and a four-character suffix are stored.
select owner_id, left(api_key_encrypted, 3) as envelope, length(api_key_encrypted) as len, key_suffix, status
from public.user_ai_settings;

-- Nothing that looks like a key is stored in the clear. Both must return 0.
select count(*) as plaintext_keys from public.user_ai_settings where api_key_encrypted like 'sk-%';
select count(*) as keys_in_runs from public.creation_runs
where stages::text like '%sk-ant-%' or coalesce(error_message,'') like '%sk-ant-%';

-- No column anywhere else in public is holding a key.
select table_name, column_name from information_schema.columns
where table_schema='public' and column_name ilike '%api_key%';
```

Expect: A's runs `claude-sonnet-5` / `claude-opus-5`, B's the reverse; `envelope` = `v1:` for both rows; all three counts zero; the only `%api_key%` column is `user_ai_settings.api_key_encrypted`.

## 6. Replace user A's key

Settings → **Replace key** with a second valid test key, save, then create one more draft as A. It should succeed, and `ai_settings_revision` on the new run should be higher than on A's first run.

## 7. Disconnect and reconnect user A's LinkedIn

Settings → LinkedIn: disconnect, then connect again. **Do not publish during this check.** You are confirming the OAuth connection still uses Cadence's single central application and survives an AI-settings change — not testing publishing.

## 8. Remove user B's AI settings

After B's run has finished: Settings → **Remove key** as user B, then open Create. Expect the "Claude setup required" gate with an **Open Settings** link, and no creation actions.

Removal is refused while a run is still `queued`, `running`, or `waiting_for_user` — that refusal is correct behavior, not a failure. Wait for the run to finish and try again.

## When it passes

Tick Task 8 Step 6 and the final verification line in the plan, and replace the last line of the `## Verification record` in `docs/operations.md` with what you observed. If anything diverges from the expectations above, capture the run id and the stage and stop before admitting beta users.
