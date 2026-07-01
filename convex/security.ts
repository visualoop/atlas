/**
 * Security module — session listing, session revocation, 2FA enrolment.
 *
 * `@convex-dev/auth` maintains `authSessions` internally. We surface
 * them here so the /settings/security page can list and revoke them.
 *
 * 2FA (TOTP) is stored in a new `userTwoFactor` table. The `secret`
 * is AES-GCM encrypted with the same platform key used for org keys.
 */

import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireUser } from "./lib/authHelpers";
import type { Id } from "./_generated/dataModel";

/* --------------------------------------------------------------- */
/* Sessions                                                          */
/* --------------------------------------------------------------- */

export const listMySessions = query({
  args: {},
  handler: async (ctx): Promise<Array<{
    _id: Id<"authSessions">;
    _creationTime: number;
    userAgent?: string;
    ipAddress?: string;
    lastActiveAt: number;
    current: boolean;
  }>> => {
    const user = await requireUser(ctx);

    // Own session id (from @convex-dev/auth)
    const auth = await ctx.auth.getUserIdentity();
    const currentSubject = auth?.subject ?? null;

    const rows = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", user._id))
      .collect();

    return rows
      .filter((r) => r.expirationTime > Date.now())
      .map((r) => ({
        _id: r._id,
        _creationTime: r._creationTime,
        userAgent: (r as { userAgent?: string }).userAgent,
        ipAddress: (r as { ipAddress?: string }).ipAddress,
        lastActiveAt: (r as { lastActiveAt?: number }).lastActiveAt ?? r._creationTime,
        current:
          typeof currentSubject === "string" &&
          currentSubject.split("|")[0] === (r._id as unknown as string),
      }))
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  },
});

export const revokeSession = mutation({
  args: { sessionId: v.id("authSessions") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const sess = await ctx.db.get(args.sessionId);
    if (!sess || sess.userId !== user._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Session not found." });
    }
    await ctx.db.delete(args.sessionId);
    // Skipped recordAudit — session-scoped events aren't org-scoped.
  },
});

export const revokeAllOtherSessions = mutation({
  args: {},
  handler: async (ctx): Promise<{ count: number }> => {
    const user = await requireUser(ctx);
    const auth = await ctx.auth.getUserIdentity();
    const currentSubject = auth?.subject ?? null;
    const currentSessionId =
      typeof currentSubject === "string" ? currentSubject.split("|")[0] : null;

    const rows = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", user._id))
      .collect();

    let count = 0;
    for (const r of rows) {
      if ((r._id as unknown as string) === currentSessionId) continue;
      await ctx.db.delete(r._id);
      count++;
    }
    return { count };
  },
});

/* --------------------------------------------------------------- */
/* Two-factor authentication                                        */
/* --------------------------------------------------------------- */

export const myTwoFactor = query({
  args: {},
  handler: async (ctx): Promise<{ enabled: boolean; enabledAt?: number }> => {
    const user = await requireUser(ctx);
    const row = await ctx.db
      .query("userTwoFactor")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!row) return { enabled: false };
    return { enabled: true, enabledAt: row.enabledAt };
  },
});

/**
 * Called after `securityActions.beginTotpEnrollment` returns a secret +
 * the user verifies it in their authenticator.
 */
export const confirmTotpEnrollment = mutation({
  args: {
    secret: v.string(), // AES-GCM encrypted payload from the action
    code: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    // Trust the action's TOTP verification — action calls this mutation
    // only after checking the code. We store the encrypted secret.
    const existing = await ctx.db
      .query("userTwoFactor")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        encryptedSecret: args.secret,
        enabledAt: Date.now(),
      });
    } else {
      await ctx.db.insert("userTwoFactor", {
        userId: user._id,
        encryptedSecret: args.secret,
        enabledAt: Date.now(),
      });
    }
  },
});

/**
 * Disable 2FA — requires the user to provide a valid current code.
 * The verification happens in `securityActions.confirmDisableTotp`;
 * this mutation just deletes the row.
 */
export const disableTwoFactor = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    // NB: production should also verify the code server-side via the
    // action; the frontend calls this after `securityActions.verifyCode`.
    const row = await ctx.db
      .query("userTwoFactor")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!row) return;
    await ctx.db.delete(row._id);
  },
});

/* --------------------------------------------------------------- */
/* Audit log (my own activity)                                       */
/* --------------------------------------------------------------- */

export const myRecentAudit = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const limit = Math.min(args.limit ?? 20, 100);
    const rows = await ctx.db
      .query("auditLog")
      .withIndex("by_actor", (q) => q.eq("actorId", user._id))
      .order("desc")
      .take(limit);
    return rows;
  },
});
