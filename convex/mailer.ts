"use node";

/**
 * Internal actions that wrap systemMailer functions so they can be
 * called from V8-runtime callbacks (like convex-auth's
 * sendVerificationRequest) via `ctx.runAction`.
 *
 * These are internal-only — no client can call them directly.
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import {
  sendAuthOtp,
  sendMeetingConfirmation,
  sendLandingWelcome,
  sendInvitation,
} from "./lib/systemMailer";

export const sendAuthOtpEmail = internalAction({
  args: {
    to: v.string(),
    token: v.string(),
    kind: v.union(v.literal("signin"), v.literal("password_reset")),
    ttlMinutes: v.number(),
  },
  handler: async (_ctx, args) => {
    return await sendAuthOtp(args);
  },
});

export const sendMeetingConfirmationEmail = internalAction({
  args: {
    to: v.string(),
    hostName: v.string(),
    attendeeName: v.optional(v.string()),
    meetingTitle: v.string(),
    startAtMs: v.number(),
    durationMinutes: v.number(),
    timezone: v.string(),
    conferenceUrl: v.optional(v.string()),
    location: v.optional(v.string()),
    note: v.optional(v.string()),
    replyTo: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    return await sendMeetingConfirmation(args);
  },
});

export const sendLandingWelcomeEmail = internalAction({
  args: {
    to: v.string(),
    workspaceName: v.string(),
    pageTitle: v.string(),
    pageKind: v.union(
      v.literal("product_launch"),
      v.literal("waitlist"),
      v.literal("event"),
      v.literal("lead_magnet"),
      v.literal("custom"),
    ),
    firstName: v.optional(v.string()),
    leadMagnetUrl: v.optional(v.string()),
    leadMagnetLabel: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    return await sendLandingWelcome(args);
  },
});

export const sendInvitationEmail = internalAction({
  args: {
    to: v.string(),
    inviterName: v.string(),
    organizationName: v.string(),
    role: v.string(),
    acceptUrl: v.string(),
  },
  handler: async (_ctx, args) => {
    return await sendInvitation(args);
  },
});
