/**
 * Campaigns + drip sequences (Phase 8).
 *
 * Read:   listCampaigns, getCampaign, listSteps, listRecipients,
 *         listEventsForRecipient
 * Write:  createCampaign, updateCampaign, addStep, updateStep,
 *         removeStep, enrollAudience (compute filter + insert
 *         campaignRecipients rows), launch, pause, resume, complete
 * Internal (cron-driven):
 *         listDueRecipients — find pending recipients whose
 *           nextSendAt <= now for running campaigns
 *         advanceRecipient — after send, schedule the next step or
 *           mark completed
 *         markReplied — hooked from inbound conversation ingest
 *
 * The scheduler cron runs every minute; workflow:
 *   1. For each running campaign, fetch up to N due recipients.
 *   2. For each recipient, dispatch the current step's message
 *      (email via emailsOut.sendNew or WA via whatsappOut.sendTemplate).
 *   3. Advance the recipient: increment stepIndex, compute
 *      nextSendAt from next step's delayHours; or mark completed if
 *      no more steps.
 */

import { v, ConvexError } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import { recordAudit } from "./lib/authHelpers";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const CHANNEL = v.union(v.literal("email"), v.literal("whatsapp"), v.literal("multi"));
const STATUS = v.union(
  v.literal("draft"),
  v.literal("scheduled"),
  v.literal("running"),
  v.literal("paused"),
  v.literal("complete"),
  v.literal("cancelled"),
);

/* ============================================================ */
/* Read                                                          */
/* ============================================================ */

export const listCampaigns = query({
  args: {
    status: v.optional(STATUS),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const limit = Math.min(args.limit ?? 100, 500);
    let rows: Doc<"campaigns">[];
    if (args.status) {
      rows = await ctx.db
        .query("campaigns")
        .withIndex("by_workspace_status", (q) =>
          q.eq("workspaceId", wsCtx.workspace._id).eq("status", args.status!),
        )
        .order("desc")
        .take(limit);
    } else {
      rows = await ctx.db
        .query("campaigns")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", wsCtx.workspace._id))
        .order("desc")
        .take(limit);
    }
    return rows.filter((r) => r.archivedAt === undefined);
  },
});

export const getCampaign = query({
  args: { id: v.id("campaigns") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const c = await ctx.db.get(id);
    if (!c || c.workspaceId !== wsCtx.workspace._id) return null;
    const [steps, recipients] = await Promise.all([
      ctx.db
        .query("campaignSteps")
        .withIndex("by_campaign_order", (q) => q.eq("campaignId", id))
        .collect(),
      ctx.db
        .query("campaignRecipients")
        .withIndex("by_campaign_state", (q) => q.eq("campaignId", id))
        .take(200),
    ]);
    return {
      campaign: c,
      steps: steps.sort((a, b) => a.order - b.order),
      recipients,
    };
  },
});

/* ============================================================ */
/* Create + update                                               */
/* ============================================================ */

export const createCampaign = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    channel: CHANNEL,
    stopOnReply: v.optional(v.boolean()),
    stopOnConversion: v.optional(v.boolean()),
    dailyThrottle: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    if (args.name.trim().length < 3) {
      throw new ConvexError({ code: "INVALID", message: "Campaign name is too short." });
    }
    const id = await ctx.db.insert("campaigns", {
      workspaceId: wsCtx.workspace._id,
      name: args.name.trim(),
      description: args.description,
      channel: args.channel,
      status: "draft",
      stopOnReply: args.stopOnReply ?? true,
      stopOnConversion: args.stopOnConversion ?? true,
      dailyThrottle: args.dailyThrottle,
      recipientCount: 0,
      sentCount: 0,
      openCount: 0,
      replyCount: 0,
      conversionCount: 0,
      optOutCount: 0,
      ownerId: wsCtx.user._id,
    });
    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "created",
      resourceType: "campaign",
      resourceId: id,
      after: { name: args.name, channel: args.channel },
    });
    return id;
  },
});

export const updateCampaign = mutation({
  args: {
    id: v.id("campaigns"),
    patch: v.object({
      name: v.optional(v.string()),
      description: v.optional(v.string()),
      channel: v.optional(CHANNEL),
      stopOnReply: v.optional(v.boolean()),
      stopOnConversion: v.optional(v.boolean()),
      dailyThrottle: v.optional(v.number()),
      audienceFilter: v.optional(v.any()),
      scheduledStartAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const c = await ctx.db.get(args.id);
    if (!c || c.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Campaign not found." });
    }
    if (c.status === "running" || c.status === "complete") {
      throw new ConvexError({
        code: "IMMUTABLE",
        message: "Pause the campaign before editing.",
      });
    }
    await ctx.db.patch(args.id, args.patch);
  },
});

/* ============================================================ */
/* Steps                                                          */
/* ============================================================ */

export const addStep = mutation({
  args: {
    campaignId: v.id("campaigns"),
    delayHours: v.number(),
    channel: v.union(v.literal("email"), v.literal("whatsapp")),
    subject: v.optional(v.string()),
    bodyHtml: v.optional(v.string()),
    bodyText: v.optional(v.string()),
    templateName: v.optional(v.string()),
    templateLanguage: v.optional(v.string()),
    templateVariables: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const c = await ctx.db.get(args.campaignId);
    if (!c || c.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Campaign not found." });
    }
    const existing = await ctx.db
      .query("campaignSteps")
      .withIndex("by_campaign_order", (q) => q.eq("campaignId", args.campaignId))
      .collect();
    const maxOrder = existing.reduce((m, s) => Math.max(m, s.order), -1);
    const id = await ctx.db.insert("campaignSteps", {
      campaignId: args.campaignId,
      workspaceId: wsCtx.workspace._id,
      order: maxOrder + 1,
      delayHours: Math.max(0, args.delayHours),
      channel: args.channel,
      subject: args.subject,
      bodyHtml: args.bodyHtml,
      bodyText: args.bodyText,
      templateName: args.templateName,
      templateLanguage: args.templateLanguage,
      templateVariables: args.templateVariables,
    });
    return id;
  },
});

export const updateStep = mutation({
  args: {
    id: v.id("campaignSteps"),
    patch: v.object({
      delayHours: v.optional(v.number()),
      subject: v.optional(v.string()),
      bodyHtml: v.optional(v.string()),
      bodyText: v.optional(v.string()),
      templateName: v.optional(v.string()),
      templateLanguage: v.optional(v.string()),
      templateVariables: v.optional(v.array(v.string())),
    }),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const s = await ctx.db.get(args.id);
    if (!s || s.workspaceId !== wsCtx.workspace._id) return;
    await ctx.db.patch(args.id, args.patch);
  },
});

export const removeStep = mutation({
  args: { id: v.id("campaignSteps") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const s = await ctx.db.get(id);
    if (!s || s.workspaceId !== wsCtx.workspace._id) return;
    await ctx.db.delete(id);
  },
});

/* ============================================================ */
/* Audience enrollment                                            */
/* ============================================================ */

export const enrollAudience = mutation({
  args: {
    campaignId: v.id("campaigns"),
    // Simple filter — matches contacts where all provided fields match
    filter: v.object({
      lifecycleStages: v.optional(v.array(v.string())),
      tags: v.optional(v.array(v.string())),
      companyId: v.optional(v.id("companies")),
      hasEmail: v.optional(v.boolean()),
      hasWhatsapp: v.optional(v.boolean()),
    }),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Campaign not found." });
    }
    if (campaign.status === "running" || campaign.status === "complete") {
      throw new ConvexError({
        code: "IMMUTABLE",
        message: "Pause the campaign before enrolling more recipients.",
      });
    }

    // Base set: all contacts in workspace
    const all = await ctx.db
      .query("contacts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", wsCtx.workspace._id))
      .collect();
    const filtered = all.filter((c) => {
      if (c.archivedAt !== undefined) return false;
      if (args.filter.lifecycleStages && !args.filter.lifecycleStages.includes(c.lifecycleStage)) return false;
      if (args.filter.tags && !args.filter.tags.some((t) => c.tags.includes(t))) return false;
      if (args.filter.companyId && c.companyId !== args.filter.companyId) return false;
      if (args.filter.hasEmail && !c.email) return false;
      if (args.filter.hasWhatsapp && !c.whatsapp) return false;
      return true;
    });

    if (args.dryRun) return { matched: filtered.length, enrolled: 0 };

    // Skip contacts already enrolled in this campaign
    const existing = await ctx.db
      .query("campaignRecipients")
      .withIndex("by_campaign_state", (q) => q.eq("campaignId", args.campaignId))
      .collect();
    const enrolledIds = new Set(existing.map((r) => r.contactId));

    let enrolled = 0;
    for (const contact of filtered) {
      if (enrolledIds.has(contact._id)) continue;
      await ctx.db.insert("campaignRecipients", {
        campaignId: args.campaignId,
        workspaceId: wsCtx.workspace._id,
        contactId: contact._id,
        state: "pending",
        currentStepIndex: 0,
      });
      enrolled++;
    }
    await ctx.db.patch(args.campaignId, {
      recipientCount: campaign.recipientCount + enrolled,
      audienceFilter: args.filter,
    });
    return { matched: filtered.length, enrolled };
  },
});

/* ============================================================ */
/* Launch / pause / resume / complete                            */
/* ============================================================ */

export const launch = mutation({
  args: { id: v.id("campaigns") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const c = await ctx.db.get(id);
    if (!c || c.workspaceId !== wsCtx.workspace._id) return;
    // Confirm there are steps + recipients
    const stepCount = (
      await ctx.db
        .query("campaignSteps")
        .withIndex("by_campaign_order", (q) => q.eq("campaignId", id))
        .take(1)
    ).length;
    if (stepCount === 0) {
      throw new ConvexError({
        code: "NO_STEPS",
        message: "Add at least one step before launching.",
      });
    }
    if (c.recipientCount === 0) {
      throw new ConvexError({
        code: "NO_RECIPIENTS",
        message: "Enroll an audience before launching.",
      });
    }
    // Set the first step's nextSendAt = now + delayHours for all pending recipients
    const firstStep = await ctx.db
      .query("campaignSteps")
      .withIndex("by_campaign_order", (q) => q.eq("campaignId", id))
      .order("asc")
      .first();
    const now = Date.now();
    const initialDelay = (firstStep?.delayHours ?? 0) * 60 * 60 * 1000;
    const pendings = await ctx.db
      .query("campaignRecipients")
      .withIndex("by_campaign_state", (q) => q.eq("campaignId", id).eq("state", "pending"))
      .collect();
    for (const r of pendings) {
      if (!r.nextSendAt) {
        await ctx.db.patch(r._id, { nextSendAt: now + initialDelay });
      }
    }
    await ctx.db.patch(id, {
      status: "running",
      startedAt: c.startedAt ?? now,
    });
    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "updated",
      resourceType: "campaign",
      resourceId: id,
      reason: "launch",
      after: { status: "running" },
    });
  },
});

export const pause = mutation({
  args: { id: v.id("campaigns") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const c = await ctx.db.get(id);
    if (!c || c.workspaceId !== wsCtx.workspace._id) return;
    await ctx.db.patch(id, { status: "paused" });
  },
});

export const resume = mutation({
  args: { id: v.id("campaigns") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const c = await ctx.db.get(id);
    if (!c || c.workspaceId !== wsCtx.workspace._id) return;
    await ctx.db.patch(id, { status: "running" });
  },
});

/* ============================================================ */
/* Internal — cron scheduler                                     */
/* ============================================================ */

export const listDueForProcessing = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const running = await ctx.db
      .query("campaigns")
      .filter((q) => q.eq(q.field("status"), "running"))
      .take(50);
    const jobs: Array<{
      campaign: Doc<"campaigns">;
      recipient: Doc<"campaignRecipients">;
      step: Doc<"campaignSteps">;
    }> = [];
    const cap = Math.min(args.limit ?? 200, 500);
    for (const c of running) {
      if (jobs.length >= cap) break;
      const pending = await ctx.db
        .query("campaignRecipients")
        .withIndex("by_campaign_state", (q) =>
          q.eq("campaignId", c._id).eq("state", "pending"),
        )
        .take(50);
      for (const r of pending) {
        if (r.nextSendAt && r.nextSendAt > now) continue;
        const step = await ctx.db
          .query("campaignSteps")
          .withIndex("by_campaign_order", (q) => q.eq("campaignId", c._id))
          .filter((q) => q.eq(q.field("order"), r.currentStepIndex))
          .first();
        if (!step) continue;
        jobs.push({ campaign: c, recipient: r, step });
        if (jobs.length >= cap) break;
      }
    }
    return jobs;
  },
});

export const advanceRecipient = internalMutation({
  args: {
    recipientId: v.id("campaignRecipients"),
    sentMessageId: v.optional(v.id("messages")),
    conversationId: v.optional(v.id("conversations")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const r = await ctx.db.get(args.recipientId);
    if (!r) return;
    const campaign = await ctx.db.get(r.campaignId);
    if (!campaign) return;

    // If error, mark failed and stop
    if (args.error) {
      await ctx.db.patch(args.recipientId, {
        state: "failed",
        failureReason: args.error,
      });
      await ctx.db.insert("campaignEvents", {
        campaignId: r.campaignId,
        workspaceId: r.workspaceId,
        recipientId: args.recipientId,
        stepIndex: r.currentStepIndex,
        eventType: "failed",
        occurredAt: Date.now(),
        payload: { error: args.error },
      });
      return;
    }

    // Log send event
    await ctx.db.insert("campaignEvents", {
      campaignId: r.campaignId,
      workspaceId: r.workspaceId,
      recipientId: args.recipientId,
      stepIndex: r.currentStepIndex,
      eventType: "sent",
      messageId: args.sentMessageId,
      occurredAt: Date.now(),
    });
    await ctx.db.patch(campaign._id, { sentCount: campaign.sentCount + 1 });

    // Determine next step
    const nextIndex = r.currentStepIndex + 1;
    const nextStep = await ctx.db
      .query("campaignSteps")
      .withIndex("by_campaign_order", (q) => q.eq("campaignId", r.campaignId))
      .filter((q) => q.eq(q.field("order"), nextIndex))
      .first();

    if (!nextStep) {
      // No more steps — recipient is done
      await ctx.db.patch(args.recipientId, {
        state: "completed",
        currentStepIndex: nextIndex,
        lastSentAt: Date.now(),
        lastConversationId: args.conversationId ?? r.lastConversationId,
        nextSendAt: undefined,
      });
      // Check if all recipients completed → mark campaign complete
      const stillGoing = await ctx.db
        .query("campaignRecipients")
        .withIndex("by_campaign_state", (q) =>
          q.eq("campaignId", r.campaignId).eq("state", "pending"),
        )
        .take(1);
      if (stillGoing.length === 0) {
        await ctx.db.patch(campaign._id, {
          status: "complete",
          completedAt: Date.now(),
        });
      }
      return;
    }

    const nextSendAt = Date.now() + nextStep.delayHours * 60 * 60 * 1000;
    await ctx.db.patch(args.recipientId, {
      state: "pending",
      currentStepIndex: nextIndex,
      nextSendAt,
      lastSentAt: Date.now(),
      lastConversationId: args.conversationId ?? r.lastConversationId,
    });
  },
});

export const loadContact = internalQuery({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, { contactId }) => {
    return await ctx.db.get(contactId);
  },
});

/**
 * Called from the inbound email/WA ingest when a message arrives from
 * a contact who is currently in a campaign. Pauses the recipient if
 * campaign.stopOnReply.
 */
export const markReplied = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    contactId: v.id("contacts"),
    conversationId: v.optional(v.id("conversations")),
    messageId: v.optional(v.id("messages")),
  },
  handler: async (ctx, args) => {
    // Find any running campaigns this contact is in
    const enrollments = await ctx.db
      .query("campaignRecipients")
      .withIndex("by_contact", (q) => q.eq("contactId", args.contactId))
      .collect();
    for (const r of enrollments) {
      if (r.state !== "pending" && r.state !== "sent") continue;
      const c = await ctx.db.get(r.campaignId);
      if (!c || c.workspaceId !== args.workspaceId) continue;
      if (c.status !== "running") continue;
      if (!c.stopOnReply) continue;
      await ctx.db.patch(r._id, { state: "replied" });
      await ctx.db.insert("campaignEvents", {
        campaignId: r.campaignId,
        workspaceId: r.workspaceId,
        recipientId: r._id,
        stepIndex: r.currentStepIndex,
        eventType: "replied",
        messageId: args.messageId,
        occurredAt: Date.now(),
      });
      await ctx.db.patch(c._id, { replyCount: c.replyCount + 1 });
    }
  },
});
