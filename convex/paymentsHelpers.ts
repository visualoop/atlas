/**
 * Internal helpers for paymentsActions.ts.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { getOrgKey } from "./lib/secretsAccess";

export const getPaystackKey = internalQuery({
  args: {
    organizationId: v.id("organizations"),
    actorId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<string | null> => {
    try {
      const { value } = await getOrgKey(ctx, {
        organizationId: args.organizationId,
        provider: "paystack",
        reason: "paystack_call",
        actorId: args.actorId,
      });
      return value;
    } catch {
      return null;
    }
  },
});

export const persistTransfer = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    organizationId: v.id("organizations"),
    reference: v.string(),
    recipientCode: v.string(),
    recipientLabel: v.string(),
    amountCents: v.int64(),
    currency: v.string(),
    reason: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("success"),
      v.literal("failed"),
      v.literal("reversed"),
      v.literal("otp_required"),
    ),
    externalId: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("paystackTransfers", {
      workspaceId: args.workspaceId,
      organizationId: args.organizationId,
      reference: args.reference,
      recipientCode: args.recipientCode,
      recipientLabel: args.recipientLabel,
      amountCents: args.amountCents,
      currency: args.currency,
      reason: args.reason,
      status: args.status,
      externalId: args.externalId,
      failureReason: args.failureReason,
      createdBy: args.createdBy,
    });
  },
});
