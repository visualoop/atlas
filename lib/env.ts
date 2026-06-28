import "server-only";
import { z } from "zod";

/**
 * Atlas — Tier 0 system env validation.
 *
 * These are operator-controlled secrets that live in env vars and never
 * appear in the admin UI. App refuses to boot if any required value is
 * missing or malformed.
 *
 * Tier 1 (org integration keys: Resend, Paystack, Gemini, etc.) and
 * Tier 2 (user personal keys: Google Calendar OAuth) live in the DB,
 * encrypted with ATLAS_MASTER_KEY.
 */

const required = (msg: string) => z.string().min(1, msg);
const optionalString = z.string().optional();

const envSchema = z.object({
  // App
  NEXT_PUBLIC_APP_URL: required("NEXT_PUBLIC_APP_URL required").url(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Auth (Tier 0)
  BETTER_AUTH_SECRET: required("BETTER_AUTH_SECRET required — openssl rand -base64 32").min(
    32,
    "BETTER_AUTH_SECRET must be at least 32 chars",
  ),
  BETTER_AUTH_URL: required("BETTER_AUTH_URL required").url(),

  // Master encryption key for Tier 1/2 secrets
  ATLAS_MASTER_KEY: required(
    "ATLAS_MASTER_KEY required — openssl rand -base64 32",
  ).regex(/^[A-Za-z0-9+/=]+$/, "ATLAS_MASTER_KEY must be base64"),

  // Database
  DATABASE_URL: required("DATABASE_URL required"),
  DATABASE_URL_UNPOOLED: required("DATABASE_URL_UNPOOLED required"),

  // Object storage (Tier 0) — fillable later
  R2_ACCOUNT_ID: optionalString,
  R2_ACCESS_KEY_ID: optionalString,
  R2_SECRET_ACCESS_KEY: optionalString,
  R2_BUCKET: z.string().default("atlas-files"),
  R2_ENDPOINT: optionalString,
  R2_PUBLIC_BASE: optionalString,

  // Resend system (Tier 0, for Atlas's own outbound — invitations, password resets)
  RESEND_SYSTEM_KEY: optionalString,
  RESEND_SYSTEM_FROM: z.string().default("Atlas <atlas-noreply@blyss.co.ke>"),

  // Google OAuth (Tier 0) — fillable later
  GOOGLE_OAUTH_CLIENT_ID: optionalString,
  GOOGLE_OAUTH_CLIENT_SECRET: optionalString,

  // Observability — fillable later
  SENTRY_DSN: optionalString,
  SENTRY_AUTH_TOKEN: optionalString,
  NEXT_PUBLIC_POSTHOG_KEY: optionalString,
  NEXT_PUBLIC_POSTHOG_HOST: z.string().default("https://eu.i.posthog.com"),

  // Backups
  R2_BACKUP_BUCKET: z.string().default("atlas-backups"),
  R2_BACKUP_KEY: optionalString,
});

function parseEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  • ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment variables:\n${issues}\n\nCheck .env.local and .env.example`);
  }
  return parsed.data;
}

export const env = parseEnv();

/**
 * Feature flags derived from env presence — surfaces "is this integration usable yet?"
 * in the admin UI without exposing values.
 */
export const features = {
  storage: Boolean(env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY),
  systemEmail: Boolean(env.RESEND_SYSTEM_KEY),
  googleOAuth: Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET),
  sentry: Boolean(env.SENTRY_DSN),
  posthog: Boolean(env.NEXT_PUBLIC_POSTHOG_KEY),
} as const;
