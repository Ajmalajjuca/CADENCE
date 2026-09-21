import { afterEach, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { CredentialDecryptionError, decryptCredential, encryptCredential } from "./crypto";

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

it("reports a missing or malformed credential key through the shared server configuration", () => {
  const context = { ownerId: randomUUID(), purpose: "anthropic-api-key" as const };
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "");
  expect(() => encryptCredential("sk-ant-secret", context)).toThrow(/Missing or invalid server configuration: CREDENTIAL_ENCRYPTION_KEY/);
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", randomBytes(16).toString("base64"));
  expect(() => encryptCredential("sk-ant-secret", context)).toThrow(/32 bytes/);
});

it("distinguishes an unreadable credential from a misconfigured server", () => {
  const context = { ownerId: randomUUID(), purpose: "anthropic-api-key" as const };
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  expect(() => decryptCredential("not-an-envelope", context)).toThrow(CredentialDecryptionError);
  expect(() => decryptCredential(encryptCredential("sk-ant-secret", context), { ...context, ownerId: randomUUID() })).toThrow(CredentialDecryptionError);
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "");
  expect(() => decryptCredential("not-an-envelope", context)).not.toThrow(CredentialDecryptionError);
});

it("keys each purpose to its own encryption key and binds the owner", () => {
  const anthropicKey = randomBytes(32).toString("base64");
  const linkedinKey = randomBytes(32).toString("base64");
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", anthropicKey);
  vi.stubEnv("LINKEDIN_TOKEN_KEY", linkedinKey);
  const ownerA = randomUUID(), ownerB = randomUUID();
  const token = { ownerId: ownerA, purpose: "linkedin-access-token" as const };

  const encrypted = encryptCredential("li-access-token", token);
  expect(encrypted).not.toContain("li-access-token");
  expect(decryptCredential(encrypted, token)).toBe("li-access-token");

  // Owner binding: nothing today protects LinkedIn tokens this way.
  expect(() => decryptCredential(encrypted, { ...token, ownerId: ownerB })).toThrow(CredentialDecryptionError);
  // Purpose binding: the same key, a different purpose, must not open it.
  expect(() => decryptCredential(encrypted, { ownerId: ownerA, purpose: "linkedin-client-secret" })).toThrow(CredentialDecryptionError);
});

it("reports a missing LinkedIn token key by name", () => {
  vi.stubEnv("LINKEDIN_TOKEN_KEY", "");
  expect(() => encryptCredential("li-access-token", { ownerId: randomUUID(), purpose: "linkedin-access-token" }))
    .toThrow(/Missing or invalid server configuration: LINKEDIN_TOKEN_KEY/);
});

it("reads each purpose's key from its own configuration group", () => {
  const owner = randomUUID();
  // Only the Anthropic key is configured: LinkedIn purposes must complain
  // about their own variable, by name.
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("LINKEDIN_TOKEN_KEY", "");
  expect(encryptCredential("sk-ant-secret", { ownerId: owner, purpose: "anthropic-api-key" })).toMatch(/^v1:/);
  expect(() => encryptCredential("li-token", { ownerId: owner, purpose: "linkedin-access-token" })).toThrow(/LINKEDIN_TOKEN_KEY/);
  expect(() => encryptCredential("li-secret", { ownerId: owner, purpose: "linkedin-client-secret" })).toThrow(/LINKEDIN_TOKEN_KEY/);

  // And the reverse: only LinkedIn configured.
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "");
  vi.stubEnv("LINKEDIN_TOKEN_KEY", randomBytes(32).toString("base64"));
  expect(encryptCredential("li-token", { ownerId: owner, purpose: "linkedin-access-token" })).toMatch(/^v1:/);
  expect(() => encryptCredential("sk-ant-secret", { ownerId: owner, purpose: "anthropic-api-key" })).toThrow(/CREDENTIAL_ENCRYPTION_KEY/);
});
