import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readServerConfig, type ConfigGroup } from "../config";

export type CredentialPurpose = "anthropic-api-key" | "linkedin-access-token" | "linkedin-client-secret";
export type CredentialContext = { ownerId: string; purpose: CredentialPurpose };

/** A stored envelope this server cannot read: wrong shape, tampered, or written under a different key. */
export class CredentialDecryptionError extends Error {
  constructor() {
    super("Stored credential could not be decrypted");
    this.name = "CredentialDecryptionError";
  }
}

/**
 * Two keys, not one.
 *
 * A single key would be simpler, but rotating it would then destroy every
 * provider's secrets at once. Splitting by provider keeps each blast radius
 * to the provider whose key changed. The additional authenticated data still
 * separates purposes inside a shared key.
 *
 * This map is total over `CredentialPurpose` on purpose: adding a purpose
 * without choosing its key is a type error, not a silent reuse of another
 * provider's key.
 */
const KEY_BY_PURPOSE: Record<CredentialPurpose, { group: ConfigGroup; variable: string }> = {
  "anthropic-api-key": { group: "credentials", variable: "CREDENTIAL_ENCRYPTION_KEY" },
  "linkedin-access-token": { group: "linkedinTokens", variable: "LINKEDIN_TOKEN_KEY" },
  "linkedin-client-secret": { group: "linkedinTokens", variable: "LINKEDIN_TOKEN_KEY" },
};

function encryptionKey(purpose: CredentialPurpose): Buffer {
  const { group, variable } = KEY_BY_PURPOSE[purpose];
  const raw = readServerConfig(group)[variable];
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32) throw new Error(`${variable} must decode to 32 bytes`);
  return decoded;
}

function additionalData(context: CredentialContext): Buffer {
  return Buffer.from(`${context.ownerId}:${context.purpose}`, "utf8");
}

export function encryptCredential(plaintext: string, context: CredentialContext): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(context.purpose), iv);
  cipher.setAAD(additionalData(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptCredential(stored: string, context: CredentialContext): string {
  const key = encryptionKey(context.purpose);
  try {
    const [version, iv, tag, ciphertext, ...extra] = stored.split(":");
    if (version !== "v1" || !iv || !tag || !ciphertext || extra.length) throw new Error("Invalid encrypted credential format");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(additionalData(context));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new CredentialDecryptionError();
  }
}
