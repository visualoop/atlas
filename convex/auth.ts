import { Password } from "@convex-dev/auth/providers/Password";
import { Email } from "@convex-dev/auth/providers/Email";
import { convexAuth } from "@convex-dev/auth/server";
import type { ActionCtx } from "./_generated/server";

/**
 * Atlas auth — email + password, with optional magic-link sign-in
 * via a 6-digit OTP. Both flows go through `@convex-dev/auth`.
 *
 * Transactional email (invitation, password reset OTP, magic-link OTP)
 * flows through the org's encrypted Resend key (Tier-1 secret).
 * In Phase 0 we log the email content; Phase 2 wires Resend.
 */

const OTP_TTL_MINUTES = 15;

/**
 * 6-digit magic-link OTP. The user enters it on /verify or signs in
 * via a one-tap link in their inbox.
 */
const MagicLinkOtp = Email({
  id: "magic-link-otp",
  maxAge: OTP_TTL_MINUTES * 60,
  async generateVerificationToken() {
    const n = Math.floor(Math.random() * 1_000_000);
    return String(n).padStart(6, "0");
  },
  async sendVerificationRequest(
    { identifier: email, token, url }: { identifier: string; token: string; url: string },
    _ctx?: ActionCtx,
  ) {
    // TODO Phase 2: render React Email template + send via Tier-1 Resend.
    console.info(
      `[auth] magic-link OTP for ${email} = ${token}   (link: ${url})  expires in ${OTP_TTL_MINUTES} min`,
    );
  },
});

/**
 * Password reset OTP. Same shape; separate provider so the reset link
 * and the magic-link don't share token namespaces.
 */
const PasswordResetOtp = Email({
  id: "password-reset-otp",
  maxAge: OTP_TTL_MINUTES * 60,
  async generateVerificationToken() {
    const n = Math.floor(Math.random() * 1_000_000);
    return String(n).padStart(6, "0");
  },
  async sendVerificationRequest(
    { identifier: email, token }: { identifier: string; token: string },
    _ctx?: ActionCtx,
  ) {
    console.info(
      `[auth] password-reset OTP for ${email} = ${token}   expires in ${OTP_TTL_MINUTES} min`,
    );
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
