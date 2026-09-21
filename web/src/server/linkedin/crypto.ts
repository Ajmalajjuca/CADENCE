import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const raw = process.env.LINKEDIN_TOKEN_KEY;
  if (!raw) throw new Error("Missing LINKEDIN_TOKEN_KEY");
  const decoded = Buffer.from(raw,"base64");
  if (decoded.length !== 32) throw new Error("LINKEDIN_TOKEN_KEY must decode to 32 bytes");
  return decoded;
}

export function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm",key(),iv);
  const ciphertext = Buffer.concat([cipher.update(token,"utf8"),cipher.final()]);
  return ["v1",iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),ciphertext.toString("base64url")].join(":");
}

export function decryptToken(stored: string): string {
  const [version,iv,tag,ciphertext] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Invalid encrypted token format");
  const decipher = createDecipheriv("aes-256-gcm",key(),Buffer.from(iv,"base64url"));
  decipher.setAuthTag(Buffer.from(tag,"base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext,"base64url")),decipher.final()]).toString("utf8");
}
