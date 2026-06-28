import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * AES-256-GCM symmetric encryption for Tier 1 (org integrations) and
 * Tier 2 (user personal) secrets.
 *
 * The master key (env.ATLAS_MASTER_KEY) wraps everything. Losing it
 * bricks every stored secret. Back it up offline.
 *
 * Storage format (single bytea column):
 *   [ 1B version | 12B IV | ciphertext... | 16B GCM auth tag ]
 *
 * Version byte allows future migration to other algorithms without
 * rewriting all rows at once.
 */

const VERSION = 0x01;
const IV_LEN = 12;
const TAG_LEN = 16;
const ALGO = "aes-256-gcm" as const;

function getMasterKey(): Buffer {
  const key = Buffer.from(env.ATLAS_MASTER_KEY, "base64");
  if (key.length !== 32) {
    throw new Error(
      `ATLAS_MASTER_KEY decodes to ${key.length} bytes, expected 32. Regenerate with: openssl rand -base64 32`,
    );
  }
  return key;
}

const MASTER_KEY = getMasterKey();

/**
 * Encrypt a plaintext string. Returns a Buffer ready to store in `bytea` column.
 */
export function encryptSecret(plaintext: string): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, MASTER_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), iv, ciphertext, authTag]);
}

/**
 * Decrypt a Buffer (from `bytea` column) back to plaintext. Throws if
 * the auth tag is invalid (tampering or wrong key).
 */
export function decryptSecret(encrypted: Buffer): string {
  if (encrypted.length < 1 + IV_LEN + TAG_LEN) {
    throw new Error("encrypted blob too short");
  }
  const version = encrypted[0];
  if (version !== VERSION) {
    throw new Error(`unsupported encrypted format version: ${version}`);
  }
  const iv = encrypted.subarray(1, 1 + IV_LEN);
  const authTag = encrypted.subarray(encrypted.length - TAG_LEN);
  const ciphertext = encrypted.subarray(1 + IV_LEN, encrypted.length - TAG_LEN);

  const decipher = createDecipheriv(ALGO, MASTER_KEY, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

/**
 * Extract the last N visible chars of a secret for display ("•••••8h2").
 * The full value is never returned to the client after save.
 */
export function lastFour(secret: string): string {
  return secret.slice(-4);
}

/** Constant-time string equality — for webhook signature verification. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
