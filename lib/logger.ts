import "server-only";
import pino from "pino";
import { env } from "@/lib/env";

/**
 * Atlas logger — structured JSON to stdout in prod, pretty-printed in dev.
 *
 * Never log: passwords, full session cookies, Tier 1/2 secret values, raw OAuth tokens.
 * The redact list below catches the obvious ones; new sensitive fields must be added here.
 */

export const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  redact: {
    paths: [
      "password",
      "*.password",
      "*.passwordHash",
      "secret",
      "*.secret",
      "secretKey",
      "*.secretKey",
      "apiKey",
      "*.apiKey",
      "encryptedValue",
      "*.encryptedValue",
      "sessionToken",
      "cookie",
      "*.cookie",
      "headers.cookie",
      "headers.authorization",
      "authorization",
    ],
    censor: "[REDACTED]",
  },
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss.l", ignore: "pid,hostname" } }
      : undefined,
});

export function childLogger(bindings: pino.Bindings) {
  return logger.child(bindings);
}
