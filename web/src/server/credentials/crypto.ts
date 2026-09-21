import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type CredentialContext = { ownerId: string; purpose: "anthropic-api-key" };

function encryptionKey(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) throw new Error("Missing CREDENTIAL_ENCRYPTION_KEY");
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
  const [version, iv, tag, ciphertext] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Invalid encrypted credential format");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAAD(additionalData(context));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
