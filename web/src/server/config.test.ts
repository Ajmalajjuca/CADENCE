import { afterEach, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { errorResponse } from "./auth/http-error";
import { readServerConfig } from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
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

it("returns a safe service-unavailable response for invalid server configuration", async () => {
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
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: "Service temporarily unavailable",
    code: "SERVER_CONFIGURATION_ERROR",
  });
});

it("does not leak details from unexpected server errors", async () => {
  const response = errorResponse(new Error(
    "connect failed for postgresql://postgres:database-password@db.project-ref.supabase.co:5432/postgres",
  ));

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "Unexpected server error" });
});

it("requires only the token key for LinkedIn encryption and no central application", () => {
  vi.stubEnv("LINKEDIN_TOKEN_KEY", randomBytes(32).toString("base64"));
  expect(readServerConfig("linkedinTokens").LINKEDIN_TOKEN_KEY).toHaveLength(44);
  expect(Object.keys(readServerConfig("linkedinTokens"))).toEqual(["LINKEDIN_TOKEN_KEY"]);
});

it("requires an HTTPS worker URL outside local development", () => {
  vi.stubEnv("WORKER_URL", "http://cadence.example.com/private-path?token=secret");
  expect(() => readServerConfig("workerWake")).toThrow(/WORKER_URL/);
  try { readServerConfig("workerWake"); }
  catch (error) { expect(String(error)).not.toContain("token=secret"); }
});

it.each(["http://localhost:10000", "http://127.0.0.1:10000"])("accepts local worker URL %s", (url) => {
  vi.stubEnv("WORKER_URL", url);
  expect(readServerConfig("workerWake").WORKER_URL).toBe(url);
});

it("rejects credentials embedded in the worker URL", () => {
  vi.stubEnv("WORKER_URL", "https://user:secret@cadence-worker.onrender.com");
  expect(() => readServerConfig("workerWake")).toThrow(/WORKER_URL/);
});
