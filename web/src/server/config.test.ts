import { afterEach, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { readServerConfig } from "./config";

afterEach(() => vi.unstubAllEnvs());

it("requires the credential key for worker mode without requiring a global Anthropic key", () => {
  vi.stubEnv("DATABASE_URL", "postgres://test");
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "");
  expect(() => readServerConfig("worker")).toThrow(/CREDENTIAL_ENCRYPTION_KEY/);
});

it("accepts worker configuration without a global Anthropic key", () => {
  vi.stubEnv("DATABASE_URL", "postgres://test");
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  expect(readServerConfig("worker").DATABASE_URL).toBe("postgres://test");
});

it("rejects the IPv6-only Supabase direct connection on Vercel", () => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("DATABASE_URL", "postgresql://postgres:secret@db.project-ref.supabase.co:5432/postgres");

  expect(() => readServerConfig("database")).toThrow(
    /DATABASE_URL.*Supabase transaction pooler.*port 6543/i,
  );
});

it("requires only the token key for LinkedIn encryption and no central application", () => {
  vi.stubEnv("LINKEDIN_TOKEN_KEY", randomBytes(32).toString("base64"));
  expect(readServerConfig("linkedinTokens").LINKEDIN_TOKEN_KEY).toHaveLength(44);
  expect(Object.keys(readServerConfig("linkedinTokens"))).toEqual(["LINKEDIN_TOKEN_KEY"]);
});
