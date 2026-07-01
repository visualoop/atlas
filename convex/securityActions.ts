"use node";

/**
 * Security actions — TOTP enrollment (Node runtime for crypto + QR).
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { createHmac, randomBytes } from "node:crypto";

/**
 * Begin TOTP enrollment.
 *
 * Generates a random 20-byte secret, base32-encodes it, returns the
 * secret + QR code data URL. The user scans, then calls
 * `security.confirmTotpEnrollment` with the OTP.
 */
export const beginTotpEnrollment = action({
  args: {},
  handler: async (ctx, _args): Promise<{
    secret: string;
    otpauth: string;
    qrDataUrl: string;
  }> => {
    // Fetch user email for issuer label
    const auth = await ctx.auth.getUserIdentity();
    const label = auth?.email ?? "user";

    const secretBytes = randomBytes(20);
    const secret = base32Encode(secretBytes);
    const issuer = "Atlas";
    const otpauth = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&period=30&digits=6&algorithm=SHA1`;

    // Generate QR code as data URL via Google Charts as fallback if
    // qrcode-generator isn't installed. We use a lightweight approach
    // that ships without extra deps: return an SVG data URL rendered
    // with a hand-rolled QR encoder is impractical, so we fetch from
    // a free QR service.
    const qrDataUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauth)}`;

    return { secret, otpauth, qrDataUrl };
  },
});

/**
 * Called by /settings/security when the user submits their 6-digit code.
 * Verifies the TOTP against the secret and, if valid, hands off to the
 * mutation to persist.
 */
export const verifyAndEnroll = action({
  args: { secret: v.string(), code: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    if (!totpMatches(args.secret, args.code)) {
      return { ok: false };
    }
    await ctx.runMutation(api.security.confirmTotpEnrollment, {
      secret: args.secret,
      code: args.code,
    });
    return { ok: true };
  },
});

/* --------------------------------------------------------------- */
/* TOTP + base32                                                     */
/* --------------------------------------------------------------- */

function base32Encode(buffer: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const byte of buffer) {
    bits += byte.toString(2).padStart(8, "0");
  }
  let out = "";
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, "0");
    out += alphabet[parseInt(chunk, 2)];
  }
  return out;
}

function base32Decode(str: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = str.replace(/=+$/, "").toUpperCase();
  let bits = "";
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function totpMatches(secret: string, code: string, windowSize = 1): boolean {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 30_000);
  for (let w = -windowSize; w <= windowSize; w++) {
    const generated = hotp(key, counter + w);
    if (timingSafeEq(generated, code)) return true;
  }
  return false;
}

function hotp(key: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    buf[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, "0");
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
