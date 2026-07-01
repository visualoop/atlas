"use node";

/**
 * Campaign runner (Phase 8) — Node runtime action.
 *
 * Invoked by cron every minute. For each due (campaign, recipient,
 * step) job:
 *   1. Load contact email/whatsapp from the workspace.
 *   2. Dispatch via the appropriate channel.
 *   3. Advance the recipient (log event + schedule next step).
 *
 * We cap the number of jobs per tick to avoid Convex action timeouts.
 */

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const MAX_PER_TICK = 30;

export const processDueRecipients = internalAction({
  args: {},
  handler: async (ctx): Promise<{ processed: number; sent: number; failed: number }> => {
    const jobs = await ctx.runQuery(internal.campaigns.listDueForProcessing, {
      limit: MAX_PER_TICK,
    });

    let sent = 0;
    let failed = 0;

    for (const job of jobs) {
      const contact = await ctx.runQuery(internal.campaigns.loadContact, {
        contactId: job.recipient.contactId,
      });
      if (!contact) {
        await ctx.runMutation(internal.campaigns.advanceRecipient, {
          recipientId: job.recipient._id,
          error: "contact_missing",
        });
        failed++;
        continue;
      }

      try {
        let messageId: Id<"messages"> | undefined;
        let conversationId: Id<"conversations"> | undefined;

        if (job.step.channel === "email") {
          if (!contact.email) {
            throw new Error("no_email");
          }
          const res = await ctx.runAction(internal.campaignRunnerHelpers.sendEmailStep, {
            to: [contact.email],
            subject: job.step.subject ?? "",
            bodyHtml: job.step.bodyHtml ?? "",
            bodyText: job.step.bodyText ?? "",
            senderIdentityId: job.step.senderIdentityId,
          });
          messageId = res.messageId;
          conversationId = res.conversationId;
        } else if (job.step.channel === "whatsapp") {
          if (!contact.whatsapp) {
            throw new Error("no_whatsapp");
          }
          if (!job.step.templateName) {
            throw new Error("template_missing");
          }
          const res = await ctx.runAction(internal.campaignRunnerHelpers.sendWaTemplateStep, {
            toPhone: contact.whatsapp,
            templateName: job.step.templateName,
            templateLanguage: job.step.templateLanguage,
            variables: job.step.templateVariables,
            contactId: contact._id,
          });
          messageId = res.messageId;
          conversationId = res.conversationId;
        }

        await ctx.runMutation(internal.campaigns.advanceRecipient, {
          recipientId: job.recipient._id,
          sentMessageId: messageId,
          conversationId,
        });
        sent++;
      } catch (err) {
        await ctx.runMutation(internal.campaigns.advanceRecipient, {
          recipientId: job.recipient._id,
          error: err instanceof Error ? err.message : "unknown",
        });
        failed++;
      }
    }

    return { processed: jobs.length, sent, failed };
  },
});
