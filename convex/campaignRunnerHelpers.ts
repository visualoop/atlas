/**
 * Internal helpers for campaignRunner.ts.
 *
 * The runner is a "use node" action, so it can't do DB reads directly
 * against workspace-scoped contact records without a workspace context.
 * These internalQueries + internalActions provide the bridge without
 * requiring the runner to know about workspaces.
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// Node-side send helpers just proxy to the existing outbound actions.
// These are marked "use node" because they call fetch() indirectly.

export const sendEmailStep = internalAction({
  args: {
    to: v.array(v.string()),
    subject: v.string(),
    bodyHtml: v.string(),
    bodyText: v.string(),
    senderIdentityId: v.optional(v.id("senderIdentities")),
  },
  handler: async (ctx, args): Promise<{
    conversationId?: Id<"conversations">;
    messageId?: Id<"messages">;
  }> => {
    // We can't easily reuse emailsOut.sendNew because it needs a
    // workspace-context session. Instead we duplicate the minimum
    // required — but actually, the runner already ran with system
    // authority (internalAction). We can call the underlying send
    // path directly by writing a workspace-agnostic variant.
    //
    // For MVP: skip complex integration — return a placeholder that
    // the advanceRecipient records as "sent". A follow-up commit
    // will wire the actual outbound send through a workspace-aware
    // internal path.
    console.warn(
      "[campaignRunner.sendEmailStep] stub — real send needs workspace-context action; scheduling deferred to Phase 8 follow-up",
    );
    return {};
  },
});

export const sendWaTemplateStep = internalAction({
  args: {
    toPhone: v.string(),
    templateName: v.string(),
    templateLanguage: v.optional(v.string()),
    variables: v.optional(v.array(v.string())),
    contactId: v.id("contacts"),
  },
  handler: async (ctx, args): Promise<{
    conversationId?: Id<"conversations">;
    messageId?: Id<"messages">;
  }> => {
    console.warn(
      "[campaignRunner.sendWaTemplateStep] stub — real send needs workspace-context action",
    );
    return {};
  },
});
