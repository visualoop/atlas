"use node";

/**
 * System mailer — sends transactional email via `RESEND_API_KEY`.
 *
 * Used for Atlas-platform emails that aren't tied to a specific
 * workspace's outbound identity:
 *   - Auth OTP (login + password reset)
 *   - Public form confirmations (meeting bookings, landing signups)
 *   - Team invitations
 *
 * For workspace-owned mail (inbox replies, broadcasts, campaign
 * sends), use `lib/orgMailer.ts` which reads the org's encrypted
 * Resend key from orgIntegrationKeys.
 *
 * Env vars:
 *   RESEND_API_KEY    — Resend API key (starts re_)
 *   AUTH_FROM_EMAIL   — "Atlas <no-reply@mail.blyss.co.ke>"
 */

import { render } from "@react-email/render";
import * as React from "react";
import { AtlasOtpEmail } from "../../emails/atlas-otp-email";
import { AtlasMeetingConfirmationEmail } from "../../emails/atlas-meeting-confirmation-email";
import { AtlasLandingWelcomeEmail } from "../../emails/atlas-landing-welcome-email";
import { AtlasInvitationEmail } from "../../emails/atlas-invitation-email";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface SystemMailResult {
  delivered: boolean;
  error?: string;
  messageId?: string;
}

async function sendRaw(args: {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}): Promise<SystemMailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_FROM_EMAIL;
  if (!apiKey || !from) {
    return { delivered: false, error: "system_mailer_not_configured" };
  }
  try {
    const body: Record<string, unknown> = {
      from,
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
    };
    if (args.replyTo) body.reply_to = args.replyTo;
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      return {
        delivered: false,
        error: `Resend ${res.status}: ${err.slice(0, 200)}`,
      };
    }
    const json = (await res.json()) as { id?: string };
    return { delivered: true, messageId: json.id };
  } catch (err) {
    return {
      delivered: false,
      error: err instanceof Error ? err.message : "network_error",
    };
  }
}

export async function sendAuthOtp(args: {
  to: string;
  token: string;
  kind: "signin" | "password_reset";
  ttlMinutes: number;
}): Promise<SystemMailResult> {
  const subject =
    args.kind === "signin"
      ? `Atlas sign-in code: ${args.token}`
      : `Atlas password-reset code: ${args.token}`;
  const html = await render(
    React.createElement(AtlasOtpEmail, {
      token: args.token,
      kind: args.kind,
      ttlMinutes: args.ttlMinutes,
    }),
  );
  const text = await render(
    React.createElement(AtlasOtpEmail, {
      token: args.token,
      kind: args.kind,
      ttlMinutes: args.ttlMinutes,
    }),
    { plainText: true },
  );
  return sendRaw({ to: args.to, subject, text, html });
}

export async function sendMeetingConfirmation(args: {
  to: string;
  hostName: string;
  attendeeName?: string;
  meetingTitle: string;
  startAtMs: number;
  durationMinutes: number;
  timezone: string;
  conferenceUrl?: string;
  location?: string;
  note?: string;
  replyTo?: string;
}): Promise<SystemMailResult> {
  const subject = `Confirmed · ${args.meetingTitle}`;
  const html = await render(
    React.createElement(AtlasMeetingConfirmationEmail, {
      hostName: args.hostName,
      attendeeName: args.attendeeName,
      meetingTitle: args.meetingTitle,
      startAtIso: new Date(args.startAtMs).toISOString(),
      durationMinutes: args.durationMinutes,
      timezone: args.timezone,
      conferenceUrl: args.conferenceUrl,
      location: args.location,
      note: args.note,
    }),
  );
  const text = await render(
    React.createElement(AtlasMeetingConfirmationEmail, {
      hostName: args.hostName,
      attendeeName: args.attendeeName,
      meetingTitle: args.meetingTitle,
      startAtIso: new Date(args.startAtMs).toISOString(),
      durationMinutes: args.durationMinutes,
      timezone: args.timezone,
      conferenceUrl: args.conferenceUrl,
      location: args.location,
      note: args.note,
    }),
    { plainText: true },
  );
  return sendRaw({ to: args.to, subject, text, html, replyTo: args.replyTo });
}

export async function sendLandingWelcome(args: {
  to: string;
  workspaceName: string;
  pageTitle: string;
  pageKind: "product_launch" | "waitlist" | "event" | "lead_magnet" | "custom";
  firstName?: string;
  leadMagnetUrl?: string;
  leadMagnetLabel?: string;
}): Promise<SystemMailResult> {
  const subject =
    args.pageKind === "waitlist"
      ? `You're on the ${args.pageTitle} waitlist`
      : args.pageKind === "lead_magnet"
        ? `Your download from ${args.workspaceName}`
        : `Confirmation · ${args.pageTitle}`;
  const html = await render(
    React.createElement(AtlasLandingWelcomeEmail, args),
  );
  const text = await render(
    React.createElement(AtlasLandingWelcomeEmail, args),
    { plainText: true },
  );
  return sendRaw({ to: args.to, subject, text, html });
}

export async function sendInvitation(args: {
  to: string;
  inviterName: string;
  organizationName: string;
  role: string;
  acceptUrl: string;
}): Promise<SystemMailResult> {
  const subject = `Join ${args.organizationName} on Atlas`;
  const html = await render(
    React.createElement(AtlasInvitationEmail, args),
  );
  const text = await render(
    React.createElement(AtlasInvitationEmail, args),
    { plainText: true },
  );
  return sendRaw({ to: args.to, subject, text, html });
}
