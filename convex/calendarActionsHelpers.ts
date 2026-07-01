/**
 * Internal helpers for calendarActions.ts (Node runtime).
 *
 * These provide the DB access the cron needs: listing upcoming events
 * whose reminders haven't fired yet, gathering AI-brief context from
 * linked contact/deal/threads, and persisting the AI-generated brief.
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";
import { getOrgKey } from "./lib/secretsAccess";
import type { Doc, Id } from "./_generated/dataModel";

const REMINDER_WINDOW_MS = 65 * 60 * 1000; // 65 minutes = ~1 hour lead

export const listUpcomingUnreminded = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const horizon = now + REMINDER_WINDOW_MS;

    // Scan cross-workspace; capped to 100 upcoming events.
    const events = await ctx.db
      .query("calendarEvents")
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "scheduled"),
          q.eq(q.field("archivedAt"), undefined),
          q.eq(q.field("reminderSentAt"), undefined),
          q.gte(q.field("startAt"), now),
          q.lte(q.field("startAt"), horizon),
        ),
      )
      .take(100);

    const out: Array<{
      _id: Id<"calendarEvents">;
      workspaceId: Id<"workspaces">;
      organizationId: Id<"organizations">;
      ownerEmail: string | null;
      title: string;
      startAt: number;
      conferenceUrl?: string;
      location?: string;
      attendeeEmails?: string[];
      contactId?: Id<"contacts">;
      dealId?: Id<"deals">;
    }> = [];

    for (const e of events) {
      const ws = await ctx.db.get(e.workspaceId);
      if (!ws) continue;
      const owner = await ctx.db.get(e.ownerId);
      out.push({
        _id: e._id,
        workspaceId: e.workspaceId,
        organizationId: ws.organizationId,
        ownerEmail: owner?.email ?? null,
        title: e.title,
        startAt: e.startAt,
        conferenceUrl: e.conferenceUrl,
        location: e.location,
        attendeeEmails: e.attendeeEmails,
        contactId: e.contactId,
        dealId: e.dealId,
      });
    }
    return out;
  },
});

export const markReminderSent = internalMutation({
  args: { eventId: v.id("calendarEvents") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.eventId, { reminderSentAt: Date.now() });
  },
});

export const gatherBriefContext = internalQuery({
  args: {
    eventId: v.id("calendarEvents"),
    contactId: v.optional(v.id("contacts")),
    dealId: v.optional(v.id("deals")),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) return null;
    const ws = await ctx.db.get(event.workspaceId);
    if (!ws) return null;

    let apiKey: string | null = null;
    const members = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("organizationId", ws.organizationId))
      .collect();
    const owner = members.find((m) => m.role === "owner") ?? members[0];
    if (owner) {
      try {
        const k = await getOrgKey(ctx, {
          organizationId: ws.organizationId,
          provider: "groq",
          reason: "meeting_brief",
          actorId: owner.userId,
        });
        apiKey = k.value;
      } catch {}
    }

    let contactSummary: string | undefined;
    if (args.contactId) {
      const c = await ctx.db.get(args.contactId);
      if (c) {
        contactSummary = `${c.firstName} ${c.lastName ?? ""} (${c.email ?? "no email"}) — stage ${c.lifecycleStage}`;
      }
    }

    let dealNotes: string | undefined;
    if (args.dealId) {
      const d = await ctx.db.get(args.dealId);
      if (d) {
        dealNotes = `"${d.name}" — ${d.currency} ${(d.amountCents / 100n).toString()} — stage id ${d.stageId}`;
      }
    }

    // Recent 5 message bodies from any conversation linked to contact
    let recentThreads: string | undefined;
    if (args.contactId) {
      const convs = await ctx.db
        .query("conversations")
        .withIndex("by_workspace_state_time", (q) =>
          q.eq("workspaceId", event.workspaceId).eq("state", "open"),
        )
        .take(20);
      const linkedConv = convs.find((c) => c.contactIds.includes(args.contactId!));
      if (linkedConv) {
        const msgs = await ctx.db
          .query("messages")
          .withIndex("by_conversation_time", (q) => q.eq("conversationId", linkedConv._id))
          .order("desc")
          .take(5);
        recentThreads = msgs
          .reverse()
          .map((m) => `[${m.direction}] ${m.bodyText.slice(0, 200)}`)
          .join("\n");
      }
    }

    return {
      workspaceId: event.workspaceId,
      apiKey,
      contactSummary,
      recentThreads,
      dealNotes,
    };
  },
});

export const saveBrief = internalMutation({
  args: {
    eventId: v.id("calendarEvents"),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.eventId, {
      aiBriefText: args.text,
      aiBriefAt: Date.now(),
    });
  },
});


/* ------------------------------------------------------------------ */
/* iCal feed — bearer-token access via publicApiKeys                    */
/* ------------------------------------------------------------------ */

export const icalFeed = internalQuery({
  args: {
    workspaceSlug: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args): Promise<Array<{
    id: string;
    title: string;
    description?: string;
    location?: string;
    startAt: number;
    endAt: number;
  }> | null> => {
    // Look up workspace by slug (must scan orgs)
    const workspaces = await ctx.db
      .query("workspaces")
      .filter((q) => q.eq(q.field("slug"), args.workspaceSlug))
      .collect();
    // Since slug is unique per org but not globally, pick the first
    const workspace = workspaces[0];
    if (!workspace) return null;

    // Verify token via SHA-256 hash lookup in publicApiKeys
    const tokenHash = await sha256Hex(args.token);
    const key = await ctx.db
      .query("publicApiKeys")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .first();
    if (!key || key.workspaceId !== workspace._id || key.revokedAt !== undefined) return null;
    if (key.expiresAt && key.expiresAt < Date.now()) return null;
    if (!key.scopes.includes("calendar:read") && !key.scopes.includes("*")) return null;

    // Load events
    const events = await ctx.db
      .query("calendarEvents")
      .withIndex("by_workspace_start", (q) => q.eq("workspaceId", workspace._id))
      .filter((q) => q.eq(q.field("archivedAt"), undefined))
      .take(500);

    return events.map((e) => ({
      id: e._id,
      title: e.title,
      description: e.description,
      location: e.location ?? e.conferenceUrl,
      startAt: e.startAt,
      endAt: e.endAt,
    }));
  },
});

async function sha256Hex(s: string): Promise<string> {
  const enc = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
