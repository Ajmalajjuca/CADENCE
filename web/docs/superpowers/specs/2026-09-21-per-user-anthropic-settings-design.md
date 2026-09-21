# Per-user Anthropic settings design

Date: 2026-09-21
Status: Approved for implementation

## Purpose

Cadence will require each invited user to supply their own Anthropic API key and choose separate Claude models for research and writing. Cadence will continue to use one server-managed LinkedIn developer application; each user connects their own LinkedIn member account through the existing OAuth flow.

Success means a user can configure and validate Claude from the UI, create content with only their credentials, and replace or remove those credentials without exposing secrets to the browser, logs, exports, or other users.

## Scope

This change includes:

- A `/settings` page for Claude configuration and LinkedIn connection status.
- Encrypted, owner-scoped Anthropic credentials in the central PostgreSQL database.
- Separate curated research and writing model selectors.
- Server-side credential validation.
- Generation gates for missing or invalid settings.
- Per-owner AI client construction in the background worker.
- Clear credential, model, rate-limit, billing, and transient failure states.
- Migration of the current `/connections` navigation entry to Settings.

The first release does not support user-supplied LinkedIn Client IDs, Client Secrets, or access tokens; additional AI providers; arbitrary Claude model IDs; or fallback to a platform Anthropic key.

## User experience

### Navigation and page structure

The main navigation contains **Settings**. `/connections` redirects to `/settings` so old links remain valid. Settings contains two panels.

### Claude AI panel

Before setup, the panel shows:

- A password input for the Anthropic API key, with an optional show/hide control.
- A curated Research model selector.
- A curated Writing model selector.
- A **Validate and save** action.
- A short explanation that the key is encrypted and used only for the signed-in user's jobs.

The API key input is never prefilled. The server validates the key, selected-model access, and model eligibility before storing the credentials. A failed validation leaves any previously valid configuration unchanged.

After setup, the panel shows:

- `Configured`, `Needs attention`, or `Not configured` status.
- Only the final four characters of the key.
- The selected research and writing model labels.
- The last successful validation time.
- **Change models**, **Replace key**, and **Remove key** actions.

Changing models revalidates access using the stored key. Replacing a key is atomic: the old key remains active unless the new key validates successfully. Removing settings requires confirmation and is blocked while the owner has any queued, running, or waiting-for-user creation run.

### LinkedIn panel

The LinkedIn panel preserves the existing connection flow:

- Connection state and token expiration.
- **Connect LinkedIn** or **Reconnect LinkedIn**.
- A reminder that publishing requires exact-version approval followed by a separate **Publish now** action.

The central Cadence LinkedIn Client ID and Client Secret remain environment secrets. The user's access token continues to be obtained through OAuth and encrypted server-side. No LinkedIn credential or token input is exposed in Settings.

### Create gate

The Create page checks safe AI-settings status. Without a valid configuration it shows **Claude setup required**, explains the next action, and links to Settings instead of submitting a creation run.

The server independently enforces the same rule. Direct creation and revision requests without valid AI settings return HTTP 409 with `AI_SETTINGS_REQUIRED` or `AI_SETTINGS_INVALID`.

## Model catalog

Cadence maintains a small server-side catalog of supported model IDs. Each entry contains:

- Anthropic model ID and display label.
- Whether it may be used for research, writing, or both.
- A short speed, cost, or quality description for the UI.
- Whether the model supports the structured-output behavior Cadence requires.
- Whether the model supports the web-search tool required by the research workflow.

The browser receives only catalog metadata. Submitted model IDs must be checked against the server catalog. The catalog is updated deliberately as Anthropic adds or retires models; users cannot submit arbitrary IDs.

## Data model

Add a private `public.user_ai_settings` table:

| Column | Purpose |
| --- | --- |
| `owner_id uuid primary key` | Owner and foreign key to `auth.users`, cascading on deletion |
| `provider text` | Fixed to `anthropic` in this release |
| `api_key_encrypted text` | Versioned authenticated ciphertext |
| `key_suffix text` | Final four characters for recognition |
| `research_model text` | Validated catalog model ID |
| `writing_model text` | Validated catalog model ID |
| `status text` | `valid`, `invalid`, or `unchecked` |
| `revision integer` | Monotonic value used to avoid stale worker updates |
| `validated_at timestamptz` | Last successful validation |
| `created_at timestamptz` | Creation time |
| `updated_at timestamptz` | Last change time |

Enable RLS, then revoke all table privileges from `anon` and `authenticated`. Settings are read and written only by trusted server code after `requireUser()` establishes ownership. The worker accesses the table through its trusted database connection.

Creation runs snapshot `research_model`, `writing_model`, and `ai_settings_revision` when queued. This keeps a guided run on the same models even if the user changes defaults between stages. The worker uses the user's current decrypted key with the run's model snapshot. A replaced key can therefore continue an existing run, while model changes apply only to newly queued runs.

## Encryption and secret handling

Add a dedicated `CREDENTIAL_ENCRYPTION_KEY`, generated as 32 random bytes encoded in base64. It must be present on both web and worker services and remain stable across deployments.

Anthropic keys use AES-256-GCM with a random 12-byte IV and a versioned envelope such as `v1:<iv>:<tag>:<ciphertext>`. Encryption binds the ciphertext to the owner ID and credential purpose as authenticated additional data, preventing a database row or ciphertext from being moved to another owner or secret type.

The application never:

- Returns plaintext keys or ciphertext in an API response.
- Stores plaintext keys in database columns, creation-run payloads, cookies, browser storage, activity details, or exported user data.
- Includes keys in logs, telemetry, validation errors, or Anthropic error messages.
- Reuses `LINKEDIN_TOKEN_KEY` for Anthropic credentials.

Key decryption occurs only inside the server validation service or worker immediately before use. Plaintext is not retained beyond the request or run stage.

## Server APIs

Add authenticated routes under `/api/settings/ai`:

- `GET` returns safe status, key suffix, selected model metadata, status, and validation timestamps.
- `PUT` validates and atomically saves a new key and model pair, or changes models using the existing stored key.
- `DELETE` removes the configuration after confirming there are no active creation runs.

Add `GET /api/settings/ai/models` for the safe curated catalog. The response uses a short public cache because it contains no user data.

Request schemas distinguish between initial setup, key replacement, and model-only updates. Responses use stable error codes and user-safe messages. Credential validation is limited to five attempts per user in a rolling minute.

## Worker changes

The worker currently creates one global `CadenceAi` instance from environment variables. It will instead:

1. Claim a run.
2. Load the run owner's settings.
3. Require `valid` status.
4. Decrypt the API key.
5. Verify the run's model snapshots are still supported by the server catalog.
6. Construct an `AnthropicTransport` and `CadenceAi` for that run.
7. Process the current stage using that owner-specific client.

The worker process no longer requires `ANTHROPIC_API_KEY`, `ANTHROPIC_RESEARCH_MODEL`, or `ANTHROPIC_WRITING_MODEL`. It requires `DATABASE_URL` and `CREDENTIAL_ENCRYPTION_KEY` for generation. The web service also requires `CREDENTIAL_ENCRYPTION_KEY` for validation and settings updates.

If Anthropic returns an authentication rejection, the worker marks the settings invalid only when the stored `revision` still equals the revision it loaded. This prevents an old in-flight request from invalidating a newly replaced key.

## Errors and recovery

Cadence maps failures to stable internal codes:

| Code | User action |
| --- | --- |
| `AI_SETTINGS_REQUIRED` | Add an Anthropic key in Settings |
| `AI_SETTINGS_INVALID` | Replace or revalidate the saved key |
| `AI_MODEL_NOT_ALLOWED` | Select a supported model |
| `AI_MODEL_UNAVAILABLE` | Select a model enabled for this Anthropic account |
| `AI_RATE_LIMITED` | Wait and retry later |
| `AI_CREDIT_REQUIRED` | Add Anthropic credit or resolve billing |
| `AI_PROVIDER_UNAVAILABLE` | Retry after a temporary provider failure |

User-visible errors do not include raw provider bodies. Server diagnostics can record HTTP status, provider request ID, run ID, and stage, but never authorization headers, request objects containing keys, or decrypted credentials.

## Migration and deployment

The database migration creates the settings table, restrictions, creation-run snapshot columns, checks, and indexes. It does not copy the existing application-wide Anthropic key into any user record.

After deployment, all existing users must configure Claude before starting a new creation or revision. Existing drafts, completed runs, approvals, LinkedIn connections, and publication history remain unchanged. Before migration, the operator drains existing active runs. If a legacy queued, running, or waiting-for-user run remains after deployment without model snapshots, the new worker fails it with `AI_SETTINGS_REQUIRED` and does not call Anthropic.

Deployment order:

1. Generate and install the same `CREDENTIAL_ENCRYPTION_KEY` on web and worker services.
2. Apply the database migration.
3. Deploy the web service.
4. Deploy the matching worker revision.
5. Confirm one test user's save, generation, key replacement, and deletion behavior.
6. Remove the obsolete global Anthropic variables after rollback is no longer needed.

## Testing

Unit and integration coverage will verify:

- Authenticated encryption, wrong-owner rejection, and tamper detection.
- No secret or ciphertext in settings responses, errors, logs, or exports.
- Owner isolation and revoked browser-table access.
- Catalog enforcement for research and writing roles.
- Successful and failed Anthropic validation without overwriting a valid configuration.
- Model-only updates and atomic key replacement.
- Create and revision rejection for missing or invalid settings.
- Model snapshots at enqueue time.
- Worker client construction with the claimed run owner's credentials.
- Revision-safe invalidation after an Anthropic authentication failure.
- Removal blocked for active runs.
- Existing central LinkedIn OAuth and publish safeguards remain intact.

The release gate includes tests, ESLint, a production build, database migration verification, a live Anthropic validation using a dedicated test key, and an end-to-end generation by two test users with different keys.

## Acceptance criteria

- Every generation and revision uses the authenticated owner's Anthropic key.
- A user cannot generate until their key and both model selections validate.
- Research and writing may use different curated models.
- Users can safely inspect status, change models, replace their key, and remove settings.
- No secret is readable through the browser API, Supabase client, export, log, or another account.
- LinkedIn continues to use Cadence's central application and each user's OAuth connection.
- Existing content and publication records remain available after migration.
