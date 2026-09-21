# Per-user LinkedIn app credentials — design

**Status:** approved 2026-09-21, pending implementation plan.

**Supersedes:** the decision in `2026-09-21-per-user-anthropic-settings-design.md` to "keep one central Cadence LinkedIn application and surface its existing OAuth connection in the new Settings page". That line no longer holds; everything else in that spec stands.

## Purpose

Each Cadence user supplies their own LinkedIn application credentials — Client ID and Client Secret — and connects their own LinkedIn account through their own app. Cadence stops operating a central LinkedIn application.

Each user already connects their own LinkedIn *account*: `linkedin_connections` holds one row per owner with their own `person_urn` and their own encrypted access token, and posts publish as that member. What changes is the *application* the OAuth flow runs against, which today comes from server environment variables shared by every user.

## Scope

In scope:

- A private, owner-scoped table holding each user's encrypted LinkedIn client secret.
- A guided LinkedIn panel in Settings that walks a user through creating the app and pasting its credentials.
- An OAuth begin and callback that resolve the signed-in owner's application rather than a server-wide one.
- Owner-bound encryption for LinkedIn access tokens, which they currently lack.
- Removal of `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, and `LINKEDIN_REDIRECT_URI` from configuration.
- A migration that disconnects every existing connection so each user reconnects under their own app.

Out of scope:

- Any change to publishing, duplicate-safety, or the approval checkpoint. Publishing sends only the bearer token and is untouched.
- LinkedIn refresh tokens. Cadence stores an access token and its expiry, as today.
- A fallback to a central application. There is exactly one code path.

## User experience

### The LinkedIn panel in Settings

The panel has four states, driven by the credential status and the connection status.

**No credentials.** A numbered checklist followed by the credential form:

1. Create an application at `https://www.linkedin.com/developers/apps`. LinkedIn requires a Company Page the user administers; an app cannot be created without one.
2. On the application's **Products** tab, request **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect**.
3. On the **Auth** tab, add the redirect URI shown in a read-only copy field.
4. Paste the Client ID and the Primary Client Secret into the fields below and choose **Save credentials**.

The form has a text input for the Client ID, a password input for the secret with a show/hide control, and a **Save credentials** action. There is no "validate and save": see *Validation* below.

**Credentials saved, not connected.** The Client ID, the last four characters of the secret, a **Connect LinkedIn** action, and **Replace secret**, **Change app**, and **Remove credentials** actions.

**Connected.** A `Connected` status, the access token expiry date, **Reconnect LinkedIn**, and the same credential summary and actions.

**Credentials rejected.** A `Needs attention` status explaining that LinkedIn rejected the application's credentials, the two things to check — that the secret was copied from this same application, and that both products were approved — and a **Replace secret** action.

The redirect URI is computed on the server from `APP_URL` and returned with the credential status. The browser never constructs it, so the value a user copies into LinkedIn is always the value the server will send.

### Validation

A LinkedIn client secret cannot be verified without completing an authorization-code exchange. There is no probe equivalent to Anthropic's model retrieval. Saving therefore stores the credentials with status `unchecked`, and the connect flow is the validation:

- A successful token exchange sets status `valid` and records `validated_at`.
- A token exchange LinkedIn rejects as `invalid_client` sets status `invalid`, guarded by the stored revision so a stale flow cannot invalidate credentials the user has since replaced.

### Publishing gates

`ConnectionStatus.status` gains `app_required`, returned when the owner has no stored credentials. The draft editor uses it to say "add your LinkedIn app in Settings" instead of "connect your account", which would be misleading when there is no app to connect through.

A connection whose token was granted without the `w_member_social` scope is recorded as connected but flagged, and publishing refuses it with a message naming the missing **Share on LinkedIn** product. This is the most likely failure for a newly created application, and failing at connect time with an actionable message is better than a bare 403 at publish time. If a token response does not report granted scopes, the same message surfaces at the first publish attempt instead.

## Data model

Migration `202609210006_linkedin_app_credentials.sql`:

```sql
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

alter table public.linkedin_connections add column client_id text;
alter table public.linkedin_connections add column scopes text;
alter table public.oauth_states add column client_id text;

delete from public.linkedin_connections;
```

`client_id` is not a secret. It is transmitted in the authorization URL and may be returned by the API and displayed. The client secret is never returned in any form, encrypted or otherwise.

`linkedin_connections.client_id` records which application issued the stored token, so a connection's provenance is never ambiguous. It is nullable because rows predating this change carry none — though the migration deletes all of them, a nullable column keeps the schema honest for any row restored from an older backup.

`linkedin_connections.scopes` records the scopes LinkedIn reported granting, for the publish gate described above.

`oauth_states.client_id` records which application started a flow, so the callback cannot exchange a code against a different application than the one the user authorized.

### Why a separate table

Application credentials and account connections have different lifetimes. Credentials are configuration that should survive a disconnect; a connection is transient state. Holding both in `linkedin_connections` would force `person_urn` and `access_token_encrypted` to become nullable, destroying the current guarantee that a connection row means a usable connection. A single generalized `user_credentials` table keyed by purpose was considered and rejected: it would require migrating live data out of `user_ai_settings` and re-earning that subsystem's verification in order to generalize across two providers.

### The cutover deletes connections

The migration deletes every `linkedin_connections` row rather than marking it `revoked`. Token encryption moves to owner-bound additional authenticated data in this same change, so an existing ciphertext becomes permanently undecryptable; a retained row would be a connection that appears real and can never publish. No table references `linkedin_connections` — `publication_attempts` hangs off `approvals` — so deletion costs only the reconnect every user is already required to perform. Publication history is untouched.

## Encryption and secret handling

`src/server/linkedin/crypto.ts` is deleted. Its callers move to `src/server/credentials/crypto.ts`, whose `CredentialContext.purpose` widens to `'anthropic-api-key' | 'linkedin-access-token' | 'linkedin-client-secret'`. That gives LinkedIn access tokens the owner binding they lack today, along with the envelope validation, `CredentialDecryptionError`, and configuration-validated key already built for Anthropic credentials.

Two encryption keys are retained and mapped by purpose in one place:

| Purpose | Key |
| --- | --- |
| `anthropic-api-key` | `CREDENTIAL_ENCRYPTION_KEY` |
| `linkedin-access-token` | `LINKEDIN_TOKEN_KEY` |
| `linkedin-client-secret` | `LINKEDIN_TOKEN_KEY` |

One implementation, two blast radii: rotating one provider's key does not destroy the other provider's secrets. Both keys are read through `readServerConfig`, so a missing or malformed value fails with an error naming the variable.

Additional authenticated data remains `${ownerId}:${purpose}`, so a row moved between owners or between purposes fails its authentication tag.

Cadence never:

- returns a client secret, or its ciphertext, in an API response;
- stores a client secret outside `linkedin_app_credentials.client_secret_encrypted`;
- includes a client secret or an access token in logs, telemetry, error messages, stored failures, or exported user data;
- accepts a user-supplied redirect URI.

## Server APIs

`GET /api/settings/linkedin` returns the safe credential status, the server-derived redirect URI, and nothing else:

```ts
type SafeLinkedInCredentials = {
  status: "not_configured" | "unchecked" | "valid" | "invalid";
  clientId?: string;
  secretSuffix?: string;
  validatedAt?: string;
  redirectUri: string;
};
```

`not_configured` is a response value only, returned when the owner has no row. The stored `status` column is one of `unchecked`, `valid`, or `invalid`.

`PUT /api/settings/linkedin` accepts `{ clientId, clientSecret? }`. Writes take a per-owner advisory lock and a revision compare-and-set, as `saveAiSettings` does. Three cases:

- **No stored credentials and no secret supplied:** refused. There is nothing to pair the Client ID with.
- **Same Client ID, no secret supplied:** accepted and a no-op on the secret. This is how a user re-saves without retyping it.
- **Different Client ID:** a secret is required. Pairing one application's Client ID with another application's secret is guaranteed to fail at exchange, so it is refused at save time rather than surfacing as a confusing `invalid_client` later.

Any accepted write increments `revision`. A write that changes the Client ID or the secret resets `status` to `unchecked`, because only a completed exchange can establish that a pair works.

`DELETE /api/settings/linkedin` removes the credentials and the connection in one transaction.

`GET /api/linkedin/status` keeps its current path and shape, with `app_required` added to the status union. The draft editor reads this endpoint and is not otherwise changed.

Write rules:

- Changing `client_id` deletes the connection in the same transaction. A token issued by one application is meaningless under another.
- Rotating only the secret keeps the connection. LinkedIn access tokens survive a secret rotation and publishing sends only the bearer token, so a forced reconnect would add friction with no safety gain.
- Removing credentials deletes the connection.

No rate limit is applied to saves, which call no external service.

Removal is not blocked by in-flight publishing. Unlike a creation run, a publish is a single synchronous request that carries its own bearer token; by the time an attempt is `pending`, the credentials are no longer needed to finish it.

## OAuth flow

`beginLinkedInConnect(ownerId)`:

1. Load the owner's credentials. Refuse with `409 LINKEDIN_APP_REQUIRED` when absent.
2. Insert an `oauth_states` row recording the state hash, the owner, and the `client_id` in use.
3. Build the authorization URL with the owner's `client_id`, the server-derived redirect URI, and the existing `openid profile w_member_social` scope.

`finishLinkedInConnect(ownerId, state, code)`:

1. Validate, claim, and expire the state row exactly as today.
2. Load the owner's credentials. Refuse with `409 LINKEDIN_APP_CHANGED` when the current `client_id` differs from the one recorded on the state row.
3. Exchange the code using the owner's `client_id` and decrypted secret. An `invalid_client` rejection marks the credentials `invalid` at their stored revision and returns `409 LINKEDIN_APP_INVALID`.
4. Fetch the member identity, then write the connection with `client_id` and the granted `scopes`.
5. Mark the credentials `valid` with `validated_at`.

Publishing is unchanged apart from the scope gate: `getLinkedInConnection` decrypts with owner-bound context, and `publishApprovedVersion` continues to send only the bearer token and `LINKEDIN_VERSION`.

## Errors and recovery

| Code | Status | Meaning | Recovery |
| --- | --- | --- | --- |
| `LINKEDIN_APP_REQUIRED` | 409 | No credentials stored | Add the app in Settings |
| `LINKEDIN_APP_INVALID` | 409 | LinkedIn rejected the credentials | Replace the secret; check both products are approved |
| `LINKEDIN_APP_CHANGED` | 409 | Credentials changed mid-flow | Connect again |
| `LINKEDIN_SCOPE_MISSING` | 409 | Token lacks `w_member_social` | Request **Share on LinkedIn**, then reconnect |
| `LINKEDIN_401` (existing) | — | Token rejected at publish | Connection marked expired; reconnect |

Every message is safe to show a user and names the next action. No message carries provider text, a secret, or a token.

## Migration and deployment

Configuration: `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, and `LINKEDIN_REDIRECT_URI` are removed from `.env.example` and from the `linkedin` configuration group, which becomes `APP_URL` and `LINKEDIN_VERSION`. `LINKEDIN_TOKEN_KEY` is retained and now encrypts client secrets as well as access tokens. A deployment that still sets the removed variables is unaffected; they are simply unread.

Order of operations:

1. Drain publishing: confirm no `publication_attempts` row is `pending`.
2. Back up the database and both encryption keys.
3. Apply the migration, which deletes existing connections.
4. Deploy web and worker from the same revision.
5. Each user adds their LinkedIn application in Settings and reconnects.

Rollback restores code and schema from backup. It cannot restore deleted connections; every user reconnects either way.

`docs/operations.md`'s LinkedIn preflight is rewritten from central-application instructions to per-user application requirements, the single redirect URI to register, and the failure table above. Step 7 of `docs/live-release-check.md` is rewritten to exercise a per-user application.

## Testing

Unit:

- Purpose-to-key mapping; owner-bound additional data for all three purposes, including wrong-owner rejection for LinkedIn access tokens, which nothing tests today.
- The authorization URL carries the owner's `client_id` and the server-derived redirect URI, and never a user-supplied one.
- The error mapping table, including `invalid_client` to `LINKEDIN_APP_INVALID`.

Database-backed integration:

- Owner isolation on `linkedin_app_credentials`, and browser roles refused in both the pgTAP suite and the plain-PostgreSQL harness.
- Save stores `unchecked`; a successful exchange records `valid`, the `client_id`, and the granted scopes.
- `invalid_client` sets `invalid`, and a stale revision cannot invalidate replaced credentials.
- Changing `client_id` deletes the connection; rotating only the secret keeps it; removal deletes both.
- A credential change between begin and callback is refused via `oauth_states.client_id`.
- A connection lacking `w_member_social` refuses to publish with `LINKEDIN_SCOPE_MISSING`.
- The owner export contains no client secret, ciphertext, or secret suffix.

UI:

- All four panel states render, the redirect URI copy field shows the server value, and the secret input is never populated from a server response.
- The draft editor distinguishes `app_required` from `disconnected`.

Regression:

- `src/server/linkedin/oauth.test.ts` and `publisher.test.ts` are rewritten; they stub environment credentials today. The duplicate-publish and uncertain-outcome assertions must pass unchanged.
- The migration's connection deletion is verified in the plain-PostgreSQL harness.

## Acceptance criteria

- No LinkedIn authorization or token exchange uses a server-wide application.
- A user cannot begin a LinkedIn connection until their own credentials are stored.
- A client secret is not readable through the browser API, the Supabase client, an export, a log, a stored failure, or another account.
- A stored token's issuing application is recorded, and a credential change mid-flow cannot complete a connection.
- An application not yet approved for **Share on LinkedIn** produces a message naming that product rather than an opaque failure.
- Publishing, approval, and duplicate-safety behavior are unchanged for a connected user.
- Existing drafts, approvals, and publication history remain available after the migration.
