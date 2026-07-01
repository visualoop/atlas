/**
 * Encrypted-secrets helpers (Web Crypto AES-GCM, 256-bit).
 *
 * Used by the Tier-1 admin-editable secrets bag in `orgIntegrationKeys`
 * (Paystack, AI provider keys, Resend, Meta WhatsApp, etc.) and the
 * Tier-2 personal secrets bag in `userPersonalKeys` (Google Calendar
 * OAuth tokens, etc.).
 *
 * The encryption key is the ONLY thing that must live in Convex env —
 * everything else lives in the database, editable from /settings UI.
 *
 * Bootstrap (one-time):
 *   1. Generate a 32-byte random key:
 *      node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *   2. Set it on the local backend:
 *      CONVEX_SELF_HOSTED_URL=https://3220.blyss.co.ke \
 *      CONVEX_SELF_HOSTED_ADMIN_KEY=<key> \
 *      npx convex env set CONFIG_ENCRYPTION_KEY <base64>
 *   3. Set it on prod (same command, prod URL/key).
 *
 * Storage format: base64( iv(12B) ‖ ciphertext-with-tag ).
 *
 * Runs in Convex's default V8 runtime — `crypto.subtle` is available
 * there without `"use node"`.
 */

const KEY_ENV = "CONFIG_ENCRYPTION_KEY";

let cachedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const rawEnv = process.env[KEY_ENV];
  if (!rawEnv) {
    throw new Error(
      `${KEY_ENV} is not set. Run \`npx convex env set ${KEY_ENV} <base64>\` ` +
        `with a 32-byte (256-bit) random key. Generate one with: ` +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }

  // The workflow historically generated hex via `openssl rand -hex 32`, but
  // the code was expecting base64. Support both so old deployments keep
  // working: try hex first if it looks like hex (64 chars, /^[0-9a-f]+$/i),
  // otherwise fall back to base64.
  const trimmed = rawEnv.trim();
  let raw: Uint8Array;
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    raw = hexToBytes(trimmed);
  } else {
    raw = base64ToBytes(trimmed);
  }
  if (raw.byteLength !== 32) {
    throw new Error(
      `${KEY_ENV} must decode to 32 bytes (got ${raw.byteLength}). ` +
        `Accepts either 64-char hex or 44-char base64 of 32 random bytes.`,
    );
  }
  cachedKey = await crypto.subtle.importKey(
    "raw",
    raw.buffer as ArrayBuffer,
    { name: "AES-GCM" },
    /* extractable */ false,
    ["encrypt", "decrypt"],
  );
  return cachedKey;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Encrypt a plaintext secret. Returns base64(iv ‖ ciphertext-with-tag).
 * Use the result as-is in `orgIntegrationKeys.encryptedValue` etc.
 */
export async function encrypt(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const ctBytes = new Uint8Array(ct);
  const out = new Uint8Array(iv.byteLength + ctBytes.byteLength);
  out.set(iv, 0);
  out.set(ctBytes, iv.byteLength);
  return bytesToBase64(out);
}

/** Decrypt back to plaintext. Throws on tamper or wrong key. */
export async function decrypt(ciphertextB64: string): Promise<string> {
  const key = await getKey();
  const combined = base64ToBytes(ciphertextB64);
  if (combined.byteLength < 12 + 16) {
    throw new Error("Ciphertext too short (corrupted or wrong format)");
  }
  const iv = combined.slice(0, 12);
  const ct = combined.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

/** Extract the last 4 visible chars for display ("•••••8h2"). */
export function lastFour(secret: string): string {
  return secret.slice(-4);
}

/* ------------------------------------------------------------------ */
/* Base64 helpers (Web-standard, no Node Buffer)                       */
/* ------------------------------------------------------------------ */

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
