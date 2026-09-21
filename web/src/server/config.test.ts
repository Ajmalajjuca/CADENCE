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
