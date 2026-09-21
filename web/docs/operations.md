# Cadence operations

## Environment

Copy `.env.example` and supply all values on the web and worker services as needed. Keep `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `CREDENTIAL_ENCRYPTION_KEY`, `LINKEDIN_CLIENT_SECRET`, and `LINKEDIN_TOKEN_KEY` in the server secret store. Never expose these values through `NEXT_PUBLIC_` variables.

Generate each encryption key as 32 random bytes encoded with base64:

```bash
openssl rand -base64 32
```

Install the same `CREDENTIAL_ENCRYPTION_KEY` on the web and worker services. Keep it stable across deployments: changing or losing it makes every saved user Anthropic key undecryptable. Back it up in the deployment secret store. Generate `LINKEDIN_TOKEN_KEY` with the same command and keep that value stable as well.

The worker does not use a platform Anthropic key. Each invited user must save and validate their own key in **Settings** before creating or revising content. Set `CADENCE_DAILY_RUN_LIMIT` to bound invited-user generation. The worker and web service must deploy from the same revision.

The curated model catalog lives in `src/server/ai/model-catalog.ts`. Review it against Anthropic's [model overview](https://platform.claude.com/docs/en/models/overview) and [model deprecation notices](https://platform.claude.com/docs/en/about-claude/models/model-deprecations) before adding, replacing, or removing an ID. Removing a model affects new selections; queued runs keep their model snapshots.

## Database and backups

1. Stop or drain workers until no creation run is `queued`, `running`, or `waiting_for_user`.
2. Back up the Supabase PostgreSQL database and the current encryption keys.
3. Install `CREDENTIAL_ENCRYPTION_KEY` on both web and worker services.
4. Apply migrations in filename order before starting the new web or worker revision.
5. Run `supabase test db` against a non-production database.
6. Deploy the web and worker from the same revision, then restart both.
7. Confirm RLS is enabled and test user A cannot select or update user B's rows.
8. Ask each invited user to validate their Anthropic key and model choices in **Settings**.

The migration preserves completed legacy runs by leaving their model snapshot columns nullable. New runs require valid per-user settings. Rollback can restore application code and schema from backup, but it cannot recover credentials if `CREDENTIAL_ENCRYPTION_KEY` was changed or lost.

Draft versions are protected by an immutability trigger. Publication attempts and activity events are historical records; retain them during routine cleanup.

## Invitations

Disable public signup. Invite each beta user with the Supabase dashboard or Admin API. The web UI only signs in an existing invited address because it sends magic links with `shouldCreateUser: false`.

## LinkedIn preflight

The LinkedIn application must have the **Share on LinkedIn** product (`w_member_social`) and **Sign In with LinkedIn using OpenID Connect** (`openid profile`). Cadence reads the member ID from `GET /v2/userinfo`. Register the exact `LINKEDIN_REDIRECT_URI`. Pin a currently supported `Linkedin-Version` in `YYYYMM` form and review it before that API version sunsets.

For local development, register `http://localhost:3000/api/linkedin/callback` under the application's **Auth → Authorized redirect URLs**. Add the application's Client ID and Client Secret to `.env.local`; keep the secret server-side. Restart the web process after changing environment variables, sign into Cadence in the same browser, and use **Settings → Connect LinkedIn**.

Before admitting beta users, connect a dedicated test member and explicitly approve one exact harmless test post. Confirm the request returns HTTP 201 and an `x-restli-id`, the public post URL works, and the Library records `published`. Do not use an old shared token from the legacy root `.env`.

## Publication incidents

- `failed`: LinkedIn returned a known rejection. A deliberate retry may create a new attempt. A 401 marks the connection expired and requires reconnecting.
- `uncertain`: the request may have reached LinkedIn, but Cadence did not receive a definitive response. Cadence does not automatically retry. Check the member's LinkedIn activity and resolve manually before adding a future reconciliation action.
- `pending` older than five minutes: the next request converts it to `uncertain`; it does not send another POST.

Never change an uncertain row to failed solely to make the button reusable. A duplicate public post is worse than waiting for manual confirmation.

## Verification record

Automated local verification on 2026-09-21:

- Unit tests cover health/config, authentication guard, onboarding parsing, Claude source validation, credential encryption, settings APIs and UI, safe provider errors, worker failure preservation, Create gating, and import preview.
- Isolated PostgreSQL integration tests cover RLS account isolation, private AI settings, validation limits, run model snapshots, stale revision protection, single-worker job claiming, resumable quick generation, exact-version approval, OAuth state and encryption, duplicate-safe publication with uncertain outcomes, credential-free owner export, and legacy import.
- ESLint and the Next.js production build pass.
- The Supabase pgTAP suite passes locally with private AI settings inaccessible to browser roles.
- A live two-user Anthropic credential check and a dedicated-account LinkedIn publish remain required with real external credentials before admitting beta users.
