import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization, twoFactor, magicLink } from "better-auth/plugins";
import { db } from "@/lib/db/client";
import { env, features } from "@/lib/env";
import * as schema from "@/db/schema";
import { logger } from "@/lib/logger";

/**
 * Better Auth server instance for Atlas.
 *
 * Plugins:
 * - organization: orgs, members, invitations
 * - twoFactor: TOTP
 * - magicLink: passwordless via email
 *
 * (apiKey plugin removed — not in this Better Auth release.
 *  Programmatic access tokens come in a later phase.)
 *
 * Email + password is enabled. Google OAuth wires in when env keys are set.
 * Magic links and invitation emails go via the Tier 0 system Resend key.
 */

export const auth = betterAuth({
  appName: "Atlas",
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,

  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      organization: schema.organization,
      member: schema.member,
      invitation: schema.invitation,
      apikey: schema.apikey,
      twoFactor: schema.twoFactor,
    },
  }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    requireEmailVerification: false, // keep dev fast; enable in production via override
  },

  socialProviders: features.googleOAuth
    ? {
        google: {
          clientId: env.GOOGLE_OAUTH_CLIENT_ID!,
          clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET!,
        },
      }
    : {},

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh sliding session each day
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },

  advanced: {
    cookiePrefix: "atlas",
  },

  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      organizationLimit: 50,
      membershipLimit: 100,
      creatorRole: "owner",
      sendInvitationEmail: async ({ email, invitation, organization, inviter }) => {
        // Wired in fully when RESEND_SYSTEM_KEY is set. For now, log to console for dev.
        if (!features.systemEmail) {
          logger.warn(
            { email, orgName: organization.name },
            "Invitation email skipped — RESEND_SYSTEM_KEY not configured",
          );
          return;
        }
        // TODO Phase 0 follow-up: render React Email template, send via Resend.
        logger.info(
          { email, orgName: organization.name, inviterName: inviter.user.name },
          "Invitation email queued",
        );
      },
    }),
    twoFactor({
      issuer: "Atlas",
    }),
    magicLink({
      sendMagicLink: async ({ email, token, url }) => {
        if (!features.systemEmail) {
          logger.warn({ email, url }, "Magic link email skipped — RESEND_SYSTEM_KEY not configured");
          return;
        }
        // TODO Phase 0 follow-up: send via Resend.
        logger.info({ email, url }, "Magic link email queued");
      },
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
export type AuthUser = typeof auth.$Infer.Session.user;
