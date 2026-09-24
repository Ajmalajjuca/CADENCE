import { afterEach, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { errorResponse } from "./auth/http-error";
import { readServerConfig } from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

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

it("accepts the Supabase direct connection outside Vercel", () => {
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("DATABASE_URL", "postgresql://postgres:secret@db.project-ref.supabase.co:5432/postgres");

  expect(readServerConfig("database").DATABASE_URL).toContain("db.project-ref.supabase.co");
});

it("accepts the Supabase transaction pooler on Vercel", () => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("DATABASE_URL", "postgresql://postgres.project-ref:secret@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require");

  expect(readServerConfig("database").DATABASE_URL).toContain("pooler.supabase.com:6543");
});

it("does not treat a disabled Vercel marker as a deployment", () => {
  vi.stubEnv("VERCEL", "false");
  vi.stubEnv("DATABASE_URL", "postgresql://postgres:secret@db.project-ref.supabase.co:5432/postgres");

  expect(readServerConfig("database").DATABASE_URL).toContain("db.project-ref.supabase.co");
});

it("logs a safe Vercel database diagnostic while keeping the client response generic", async () => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("DATABASE_URL", "postgresql://postgres:secret@db.project-ref.supabase.co:5432/postgres");
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  let error: unknown;
  try {
    readServerConfig("database");
  } catch (caught) {
    error = caught;
  }

  const response = errorResponse(error);

  expect(log).toHaveBeenCalledWith(expect.stringMatching(/DATABASE_URL.*transaction pooler.*6543/i));
  expect(await response.json()).toEqual({ error: "Unexpected server error" });
});

it("requires only the token key for LinkedIn encryption and no central application", () => {
  vi.stubEnv("LINKEDIN_TOKEN_KEY", randomBytes(32).toString("base64"));
  expect(readServerConfig("linkedinTokens").LINKEDIN_TOKEN_KEY).toHaveLength(44);
  expect(Object.keys(readServerConfig("linkedinTokens"))).toEqual(["LINKEDIN_TOKEN_KEY"]);
});
