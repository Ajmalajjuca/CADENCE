import { getPool, withTransaction } from "../../server/db/client";
import type { UserAiSettingsRow } from "../../server/db/types";
import { CredentialDecryptionError, decryptCredential, encryptCredential } from "../../server/credentials/crypto";
import { HttpError } from "../../server/auth/http-error";
import { requireAllowedModel } from "../../server/ai/model-catalog";
import { AiServiceError } from "../../server/ai/provider-errors";
import { validateAnthropicCredentials } from "../../server/ai/validate-credentials";
import type pg from "pg";

export type SafeAiSettings = {
  status: "not_configured" | "valid" | "invalid" | "unchecked";
  keySuffix?: string;
  researchModel?: string;
  writingModel?: string;
  validatedAt?: string;
};

export type AiSettingsSnapshot = { researchModel: string; writingModel: string; revision: number };
export type AiRuntimeSettings = AiSettingsSnapshot & { apiKey: string };
export type SaveAiSettingsInput = { apiKey?: string; researchModel: string; writingModel: string };
export type CredentialValidator = (apiKey: string, researchModel: string, writingModel: string) => Promise<void>;

function safe(row?: UserAiSettingsRow): SafeAiSettings {
  if (!row) return { status: "not_configured" };
  return {
    status: row.status,
    keySuffix: row.key_suffix,
    researchModel: row.research_model,
    writingModel: row.writing_model,
    validatedAt: row.validated_at?.toISOString(),
  };
}

type Queryable = Pick<pg.Pool | pg.PoolClient, "query">;

async function getRow(ownerId: string, database: Queryable = getPool()): Promise<UserAiSettingsRow | undefined> {
  const result = await database.query<UserAiSettingsRow>("select * from public.user_ai_settings where owner_id=$1", [ownerId]);
  return result.rows[0];
}

export async function withOwnerAiSettingsLock<T>(ownerId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return withTransaction(async client => {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [ownerId]);
    return fn(client);
  });
}

/**
 * Read the owner's stored key, or tell them to replace it.
 *
 * An envelope this server cannot open is a settings problem, not a transient
 * generation failure: the key was rotated, lost, or written by another
 * deployment, and no number of retries will decrypt it. Surfacing it as
 * `AI_SETTINGS_INVALID` points the owner at Settings instead of a retry button.
 * A misconfigured server is a different fault and propagates untouched.
 */
function decryptOwnerKey(row: UserAiSettingsRow, ownerId: string): string {
  try {
    return decryptCredential(row.api_key_encrypted, { ownerId, purpose: "anthropic-api-key" });
  } catch (error) {
    if (error instanceof CredentialDecryptionError) {
      throw new AiServiceError("AI_SETTINGS_INVALID", "Your stored Anthropic API key could not be read. Replace it in Settings.");
    }
    throw error;
  }
}

function missingOrInvalid(row?: UserAiSettingsRow): AiServiceError {
  if (!row) return new AiServiceError("AI_SETTINGS_REQUIRED", "Configure Claude in Settings before creating content.");
  return new AiServiceError("AI_SETTINGS_INVALID", "Revalidate or replace your Anthropic API key in Settings.");
}

export async function getSafeAiSettings(ownerId: string): Promise<SafeAiSettings> {
  return safe(await getRow(ownerId));
}

export async function getValidAiSettingsSnapshot(ownerId: string, database: Queryable = getPool()): Promise<AiSettingsSnapshot> {
  const row = await getRow(ownerId, database);
  if (!row || row.status !== "valid") throw missingOrInvalid(row);
  return { researchModel: row.research_model, writingModel: row.writing_model, revision: row.revision };
}

export async function getAiRuntimeSettings(ownerId: string): Promise<AiRuntimeSettings> {
  const row = await getRow(ownerId);
  if (!row || row.status !== "valid") throw missingOrInvalid(row);
  return {
    apiKey: decryptOwnerKey(row, ownerId),
    researchModel: row.research_model,
    writingModel: row.writing_model,
    revision: row.revision,
  };
}

export async function consumeValidationAttempt(ownerId: string): Promise<void> {
  const result = await getPool().query<{ attempts: number }>(
    `insert into public.ai_validation_limits(owner_id,window_started_at,attempts)
     values($1,now(),1)
     on conflict(owner_id) do update set
       window_started_at=case when ai_validation_limits.window_started_at<=now()-interval '1 minute' then now() else ai_validation_limits.window_started_at end,
       attempts=case when ai_validation_limits.window_started_at<=now()-interval '1 minute' then 1 else ai_validation_limits.attempts+1 end,
       updated_at=now()
     returning attempts`, [ownerId]
  );
  if (result.rows[0].attempts > 5) throw new HttpError(429, "Too many validation attempts. Wait one minute and try again.", "AI_RATE_LIMITED");
}

export async function saveAiSettings(
  ownerId: string,
  input: SaveAiSettingsInput,
  validate: CredentialValidator = validateAnthropicCredentials,
): Promise<SafeAiSettings> {
  requireAllowedModel(input.researchModel, "research");
  requireAllowedModel(input.writingModel, "writing");
  const suppliedKey = input.apiKey?.trim();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = await getRow(ownerId);
    if (!suppliedKey && !existing) throw new AiServiceError("AI_SETTINGS_REQUIRED", "Enter an Anthropic API key.");
    const apiKey = suppliedKey || decryptOwnerKey(existing!, ownerId);
    await validate(apiKey, input.researchModel, input.writingModel);
    const encrypted = suppliedKey ? encryptCredential(apiKey, { ownerId, purpose: "anthropic-api-key" }) : existing!.api_key_encrypted;
    const suffix = suppliedKey ? apiKey.slice(-4) : existing!.key_suffix;
    const result = existing
      ? await getPool().query<UserAiSettingsRow>(
          `update public.user_ai_settings set api_key_encrypted=$3,key_suffix=$4,research_model=$5,writing_model=$6,
             status='valid',revision=revision+1,validated_at=now(),updated_at=now()
           where owner_id=$1 and revision=$2 returning *`,
          [ownerId, existing.revision, encrypted, suffix, input.researchModel, input.writingModel]
        )
      : await getPool().query<UserAiSettingsRow>(
          `insert into public.user_ai_settings
             (owner_id,api_key_encrypted,key_suffix,research_model,writing_model,status,revision,validated_at)
           values($1,$2,$3,$4,$5,'valid',1,now()) on conflict(owner_id) do nothing returning *`,
          [ownerId, encrypted, suffix, input.researchModel, input.writingModel]
        );
    if (result.rows[0]) return safe(result.rows[0]);
  }
  throw new HttpError(409, "Claude settings changed while saving. Try again.", "AI_SETTINGS_CHANGED");
}

export async function markAiSettingsInvalid(ownerId: string, revision: number): Promise<void> {
  await getPool().query(
    "update public.user_ai_settings set status='invalid',updated_at=now() where owner_id=$1 and revision=$2",
    [ownerId, revision]
  );
}

export async function removeAiSettings(ownerId: string): Promise<void> {
  await withOwnerAiSettingsLock(ownerId, async client => {
    const active = await client.query(
      "select 1 from public.creation_runs where owner_id=$1 and status=any($2::text[]) limit 1",
      [ownerId, ["queued", "running", "waiting_for_user"]]
    );
    if (active.rowCount) throw new HttpError(409, "Finish active creation runs before removing Claude settings", "AI_SETTINGS_IN_USE");
    await client.query("delete from public.user_ai_settings where owner_id=$1", [ownerId]);
  });
}
