import { afterEach, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { decryptCredential, encryptCredential } from "./crypto";

afterEach(() => vi.unstubAllEnvs());

it("encrypts with fresh ciphertext bound to owner and purpose", () => {
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  const context = { ownerId: randomUUID(), purpose: "anthropic-api-key" as const };
  const first = encryptCredential("sk-ant-secret", context);
  const second = encryptCredential("sk-ant-secret", context);
  expect(first).not.toBe(second);
  expect(first).not.toContain("sk-ant-secret");
  expect(decryptCredential(first, context)).toBe("sk-ant-secret");
  expect(() => decryptCredential(first, { ...context, ownerId: randomUUID() })).toThrow();
});

it("rejects tampered ciphertext", () => {
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  const context = { ownerId: randomUUID(), purpose: "anthropic-api-key" as const };
  const encrypted = encryptCredential("sk-ant-secret", context);
  const parts = encrypted.split(":");
  const ciphertext = Buffer.from(parts[3], "base64url");
  ciphertext[0] ^= 1;
  parts[3] = ciphertext.toString("base64url");
  expect(() => decryptCredential(parts.join(":"), context)).toThrow();
});
