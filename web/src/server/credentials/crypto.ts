import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readServerConfig } from "../config";

export type CredentialContext = { ownerId: string; purpose: "anthropic-api-key" };

/** A stored envelope this server cannot read: wrong shape, tampered, or written under a different key. */
export class CredentialDecryptionError extends Error {
  constructor() {
    super("Stored credential could not be decrypted");
    this.name = "CredentialDecryptionError";
  }
}

function encryptionKey(): Buffer {
  const { CREDENTIAL_ENCRYPTION_KEY: raw } = readServerConfig("credentials");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32) throw new Error("CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes");
  return decoded;
}

function additionalData(context: CredentialContext): Buffer {
  return Buffer.from(`${context.ownerId}:${context.purpose}`, "utf8");
}

export function encryptCredential(plaintext: string, context: CredentialContext): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(additionalData(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptCredential(stored: string, context: CredentialContext): string {
  const key = encryptionKey();
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
