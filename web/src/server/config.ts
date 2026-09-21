import { z } from "zod";

const groups = {
  auth: ["SUPABASE_URL", "SUPABASE_ANON_KEY"],
  authAdmin: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
  app: ["APP_URL"],
  database: ["DATABASE_URL"],
  credentials: ["CREDENTIAL_ENCRYPTION_KEY"],
  linkedin: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "LINKEDIN_REDIRECT_URI", "LINKEDIN_TOKEN_KEY", "APP_URL", "LINKEDIN_VERSION"],
  worker: ["DATABASE_URL", "CREDENTIAL_ENCRYPTION_KEY"],
} as const;

export type ConfigGroup = keyof typeof groups;
export type ServerConfig = Record<string, string>;

export function readServerConfig(group: ConfigGroup): ServerConfig {
  const keys: readonly string[] = groups[group];
  const shape: Record<string, z.ZodString> = {};
  for (const key of keys) shape[key] = z.string().trim().min(1);
  const result = z.object(shape).safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Missing or invalid server configuration: ${missing}`);
  }
  return result.data;
}
