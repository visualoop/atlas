import { Password } from "@convex-dev/auth/providers/Password";
import { Email } from "@convex-dev/auth/providers/Email";
import { convexAuth } from "@convex-dev/auth/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Atlas auth — email + password + magic-link OTP.
 *
 * OTP emails are dispatched via the systemMailer node action which
 * renders React Email templates and sends through Resend.
 *
 * Required Convex env vars (see .github/workflows/deploy-atlas.yml):
 *   RESEND_API_KEY      — re_… key from resend.com
 *   AUTH_FROM_EMAIL     — "Atlas <no-reply@mail.blyss.co.ke>" (must be
 *                         a verified sender on Resend)
 *   SITE_URL            — origin, used to build magic-link URLs
 *
 * If Resend isn't configured yet, the OTP is logged to Convex logs
 * so first-run deploys work before DNS + Resend are wired.
 */

const OTP_TTL_MINUTES = 15;

async function sendOtpViaMailer(
  ctx: ActionCtx | undefined,
  args: {
    to: string;
    token: string;
    kind: "signin" | "password_reset";
    url?: string;
  },
): Promise<void> {
  if (!ctx) {
    console.info(
      `[auth] OTP for ${args.to} = ${args.token} (${args.kind}) — no ctx, logging only`,
    );
    return;
  }
  try {
    const result = await ctx.runAction(internal.mailer.sendAuthOtpEmail, {
      to: args.to,
      token: args.token,
      kind: args.kind,
      ttlMinutes: OTP_TTL_MINUTES,
    });
    if (!result.delivered) {
      console.info(
        `[auth] OTP for ${args.to} = ${args.token} — send failed: ${result.error ?? "unknown"} (link: ${args.url ?? "(none)"})`,
      );
    } else {
      console.info(`[auth] OTP sent to ${args.to}`);
    }
  } catch (err) {
    console.info(
      `[auth] OTP for ${args.to} = ${args.token} — dispatch error: ${err instanceof Error ? err.message : "unknown"} (link: ${args.url ?? "(none)"})`,
    );
  }
}

const MagicLinkOtp = Email({
  id: "magic-link-otp",
  maxAge: OTP_TTL_MINUTES * 60,
  async generateVerificationToken() {
    const n = Math.floor(Math.random() * 1_000_000);
    return String(n).padStart(6, "0");
  },
  async sendVerificationRequest(
    { identifier: email, token, url }: { identifier: string; token: string; url: string },
    ctx?: ActionCtx,
  ) {
    await sendOtpViaMailer(ctx, {
      to: email,
      token,
      kind: "signin",
      url,
    });
  },
});

const PasswordResetOtp = Email({
  id: "password-reset-otp",
  maxAge: OTP_TTL_MINUTES * 60,
  async generateVerificationToken() {
    const n = Math.floor(Math.random() * 1_000_000);
    return String(n).padStart(6, "0");
  },
  async sendVerificationRequest(
    { identifier: email, token }: { identifier: string; token: string },
    ctx?: ActionCtx,
  ) {
    await sendOtpViaMailer(ctx, {
      to: email,
      token,
      kind: "password_reset",
    });
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      reset: PasswordResetOtp,
      profile(params) {
        const email = String(params.email ?? "").trim().toLowerCase();
        const name = String(params.name ?? "").trim();
        return { email, name };
      },
      validatePasswordRequirements(password: string) {
        if (password.length < 12) {
          throw new Error("PASSWORD_TOO_SHORT: must be at least 12 characters.");
        }
      },
    }),
    MagicLinkOtp,
  ],
});
