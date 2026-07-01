"use node";

/**
 * Node-runtime actions for the referrals system.
 *
 * Called via ctx.scheduler.runAfter from referrals.ts so the actual
 * email dispatch (which needs the Node runtime for React Email render)
 * doesn't block the signup mutation.
 */

import { v } from "convex/values";
import { render } from "@react-email/render";
import * as React from "react";
import { internalAction } from "./_generated/server";
import { AtlasReferralCreditedEmail } from "../emails/atlas-referral-credited-email";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export const notifyReferrer = internalAction({
  args: {
    referrerEmail: v.string(),
    referrerName: v.string(),
    referredEmail: v.string(),
    creditedAmountCents: v.string(),        // BigInt as string
    currency: v.string(),
  },
  handler: async (_ctx, args): Promise<{ delivered: boolean; error?: string }> => {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.AUTH_FROM_EMAIL;
    if (!apiKey || !from) {
      console.info(
        `[referrals] Would email ${args.referrerEmail}: credited ${args.currency} ${Number(args.creditedAmountCents) / 100} for ${args.referredEmail}. RESEND not configured.`,
      );
      return { delivered: false, error: "resend_not_configured" };
    }

    const formatted = formatCurrency(args.creditedAmountCents, args.currency);
    const html = await render(
      React.createElement(AtlasReferralCreditedEmail, {
        referrerName: args.referrerName,
        referredEmail: args.referredEmail,
        creditedAmountFormatted: formatted,
      }),
    );
    const text = await render(
      React.createElement(AtlasReferralCreditedEmail, {
        referrerName: args.referrerName,
        referredEmail: args.referredEmail,
        creditedAmountFormatted: formatted,
      }),
      { plainText: true },
    );

    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: args.referrerEmail,
        subject: `You've been credited ${formatted}`,
        text,
        html,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { delivered: false, error: `Resend ${res.status}: ${err.slice(0, 200)}` };
    }
    return { delivered: true };
  },
});

function formatCurrency(cents: string, currency: string): string {
  const value = Number(cents) / 100;
  try {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(0)}`;
  }
}
