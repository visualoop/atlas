/**
 * Calendar + Meetings + Demo Ops (Phase 10).
 *
 * calendarEvents: personal + workspace-scoped events.
 * meetingLinks: public booking-page configs.
 * meetingBookings: submissions on those public pages.
 * demoRecordings: async demo videos with AI-extracted content.
 * trialLicenses: product trial state (Omnix-focused).
 *
 * Read:
 *   listEvents(range) — day/week/month agenda
 *   getEvent
 *   listMeetingLinks
 *   getMeetingLinkBySlug (public)
 *   computeAvailability (public — slots for a given day)
 *   listBookings
 *   listTrialLicenses
 * Write:
 *   createEvent, updateEvent, cancelEvent, markCompleted
 *   createMeetingLink, updateMeetingLink, deactivateMeetingLink
 *   createBooking (public — validates slot free + creates calendarEvent)
 *   cancelBooking
 *   createTrialLicense, activateTrialLicense, cancelTrialLicense
 */

import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import { recordAudit } from "./lib/authHelpers";
import { recordTimelineEvent } from "./lib/timeline";
import type { Doc, Id } from "./_generated/dataModel";

/* ============================================================ */
/* Calendar events                                                */
/* ============================================================ */

export const listEvents = query({
  args: {
    startMs: v.number(),
    endMs: v.number(),
    ownerOnly: v.optional(v.boolean()),                       // only my events
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const limit = Math.min(args.limit ?? 500, 1000);
    let rows: Doc<"calendarEvents">[];
    if (args.ownerOnly) {
      rows = await ctx.db
        .query("calendarEvents")
        .withIndex("by_workspace_owner_start", (q) =>
          q.eq("workspaceId", wsCtx.workspace._id).eq("ownerId", wsCtx.user._id),
        )
        .take(limit);
    } else {
      rows = await ctx.db
        .query("calendarEvents")
        .withIndex("by_workspace_start", (q) => q.eq("workspaceId", wsCtx.workspace._id))
        .take(limit);
    }
    return rows
      .filter((r) => r.archivedAt === undefined)
      .filter((r) => r.endAt >= args.startMs && r.startAt <= args.endMs)
      .sort((a, b) => a.startAt - b.startAt);
  },
});

export const getEvent = query({
  args: { id: v.id("calendarEvents") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const e = await ctx.db.get(id);
    if (!e || e.workspaceId !== wsCtx.workspace._id) return null;
    return e;
  },
});

export const createEvent = mutation({
  args: {
    kind: v.union(
      v.literal("meeting"),
      v.literal("reminder"),
      v.literal("blocked"),
      v.literal("deadline"),
    ),
    title: v.string(),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    conferenceUrl: v.optional(v.string()),
    startAt: v.number(),
    endAt: v.number(),
    allDay: v.optional(v.boolean()),
    attendeeEmails: v.optional(v.array(v.string())),
    contactId: v.optional(v.id("contacts")),
    dealId: v.optional(v.id("deals")),
    companyId: v.optional(v.id("companies")),
    reminderMinutesBefore: v.optional(v.array(v.number())),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    if (args.endAt <= args.startAt) {
      throw new ConvexError({ code: "INVALID_RANGE", message: "End must be after start." });
    }
    const id = await ctx.db.insert("calendarEvents", {
      workspaceId: wsCtx.workspace._id,
      ownerId: wsCtx.user._id,
      kind: args.kind,
      title: args.title.trim(),
      description: args.description,
      location: args.location,
      conferenceUrl: args.conferenceUrl,
      startAt: args.startAt,
      endAt: args.endAt,
      allDay: args.allDay ?? false,
      attendeeEmails: args.attendeeEmails,
      contactId: args.contactId,
      dealId: args.dealId,
      companyId: args.companyId,
      reminderMinutesBefore: args.reminderMinutesBefore,
      status: "scheduled",
      createdAt: Date.now(),
    });
    if (args.contactId || args.dealId || args.companyId) {
      await recordTimelineEvent(ctx, {
        workspaceId: wsCtx.workspace._id,
        eventType: "meeting_scheduled",
        actorId: wsCtx.user._id,
        subjectType: args.dealId ? "deal" : args.contactId ? "contact" : "company",
        subjectId: (args.dealId ?? args.contactId ?? args.companyId) as unknown as string,
        relatedRefs: { eventId: id },
        payload: { title: args.title, startAt: args.startAt },
      });
    }
    return id;
  },
});

export const updateEvent = mutation({
  args: {
    id: v.id("calendarEvents"),
    patch: v.object({
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      location: v.optional(v.string()),
      conferenceUrl: v.optional(v.string()),
      startAt: v.optional(v.number()),
      endAt: v.optional(v.number()),
      attendeeEmails: v.optional(v.array(v.string())),
      contactId: v.optional(v.id("contacts")),
      dealId: v.optional(v.id("deals")),
    }),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const e = await ctx.db.get(args.id);
    if (!e || e.workspaceId !== wsCtx.workspace._id) return;
    await ctx.db.patch(args.id, args.patch);
  },
});

export const cancelEvent = mutation({
  args: { id: v.id("calendarEvents"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const e = await ctx.db.get(args.id);
    if (!e || e.workspaceId !== wsCtx.workspace._id) return;
    await ctx.db.patch(args.id, { status: "cancelled" });
  },
});

export const markCompleted = mutation({
  args: { id: v.id("calendarEvents") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const e = await ctx.db.get(id);
    if (!e || e.workspaceId !== wsCtx.workspace._id) return;
    await ctx.db.patch(id, { status: "completed" });
    if (e.contactId || e.dealId) {
      await recordTimelineEvent(ctx, {
        workspaceId: wsCtx.workspace._id,
        eventType: "meeting_held",
        actorId: wsCtx.user._id,
        subjectType: e.dealId ? "deal" : "contact",
        subjectId: (e.dealId ?? e.contactId) as unknown as string,
        relatedRefs: { eventId: id },
        payload: { title: e.title },
      });
    }
  },
});

/* ============================================================ */
/* Meeting links                                                  */
/* ============================================================ */

export const listMeetingLinks = query({
  args: {},
  handler: async (ctx) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const rows = await ctx.db
      .query("meetingLinks")
      .withIndex("by_workspace_active", (q) =>
        q.eq("workspaceId", wsCtx.workspace._id).eq("active", true),
      )
      .collect();
    return rows.filter((r) => r.archivedAt === undefined);
  },
});

export const createMeetingLink = mutation({
  args: {
    slug: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    durationMinutes: v.number(),
    availability: v.array(v.any()),                          // [{weekday, startMin, endMin}]
    bufferMinutesBefore: v.optional(v.number()),
    bufferMinutesAfter: v.optional(v.number()),
    minLeadHours: v.optional(v.number()),
    maxLeadDays: v.optional(v.number()),
    timezone: v.optional(v.string()),
    location: v.optional(v.string()),
    conferenceUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const slug = args.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (slug.length < 2) {
      throw new ConvexError({ code: "INVALID_SLUG", message: "Slug too short." });
    }
    const existing = await ctx.db
      .query("meetingLinks")
      .withIndex("by_workspace_slug", (q) =>
        q.eq("workspaceId", wsCtx.workspace._id).eq("slug", slug),
      )
      .first();
    if (existing) {
      throw new ConvexError({ code: "SLUG_TAKEN", message: "That slug is in use." });
    }
    return await ctx.db.insert("meetingLinks", {
      workspaceId: wsCtx.workspace._id,
      ownerId: wsCtx.user._id,
      slug,
      title: args.title.trim(),
      description: args.description,
      durationMinutes: args.durationMinutes,
      availability: args.availability,
      bufferMinutesBefore: args.bufferMinutesBefore ?? 0,
      bufferMinutesAfter: args.bufferMinutesAfter ?? 5,
      minLeadHours: args.minLeadHours ?? 2,
      maxLeadDays: args.maxLeadDays ?? 30,
      timezone: args.timezone ?? "Africa/Nairobi",
      location: args.location,
      conferenceUrl: args.conferenceUrl,
      active: true,
    });
  },
});

export const updateMeetingLink = mutation({
  args: {
    id: v.id("meetingLinks"),
    patch: v.object({
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      durationMinutes: v.optional(v.number()),
      availability: v.optional(v.array(v.any())),
      bufferMinutesBefore: v.optional(v.number()),
      bufferMinutesAfter: v.optional(v.number()),
      minLeadHours: v.optional(v.number()),
      maxLeadDays: v.optional(v.number()),
      timezone: v.optional(v.string()),
      location: v.optional(v.string()),
      conferenceUrl: v.optional(v.string()),
      active: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const link = await ctx.db.get(args.id);
    if (!link || link.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Meeting link not found." });
    }
    await ctx.db.patch(args.id, args.patch);
  },
});

export const deactivateMeetingLink = mutation({
  args: { id: v.id("meetingLinks") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const l = await ctx.db.get(id);
    if (!l || l.workspaceId !== wsCtx.workspace._id) return;
    await ctx.db.patch(id, { active: false, archivedAt: Date.now() });
  },
});

/* ============================================================ */
/* Public — lookup meeting link + compute slots + create booking */
/* ============================================================ */

export const getMeetingLinkBySlug = query({
  args: { workspaceSlug: v.string(), linkSlug: v.string() },
  handler: async (ctx, args) => {
    const ws = await ctx.db
      .query("workspaces")
      .filter((q) => q.eq(q.field("slug"), args.workspaceSlug))
      .first();
    if (!ws) return null;
    const link = await ctx.db
      .query("meetingLinks")
      .withIndex("by_workspace_slug", (q) => q.eq("workspaceId", ws._id).eq("slug", args.linkSlug))
      .first();
    if (!link || !link.active || link.archivedAt) return null;
    return {
      link,
      workspaceName: ws.name,
      workspaceSlug: ws.slug,
    };
  },
});

/**
 * Compute available slots for a given calendar day.
 * Runs in the workspace's timezone using the availability rules,
 * excludes existing bookings + calendar events that overlap.
 */
export const computeAvailability = query({
  args: {
    workspaceSlug: v.string(),
    linkSlug: v.string(),
    // dayMs: any millisecond timestamp within the day (in booker's TZ)
    dayMs: v.number(),
  },
  handler: async (ctx, args): Promise<{ slots: number[]; timezone: string } | null> => {
    const ws = await ctx.db
      .query("workspaces")
      .filter((q) => q.eq(q.field("slug"), args.workspaceSlug))
      .first();
    if (!ws) return null;
    const link = await ctx.db
      .query("meetingLinks")
      .withIndex("by_workspace_slug", (q) => q.eq("workspaceId", ws._id).eq("slug", args.linkSlug))
      .first();
    if (!link || !link.active) return null;

    const dayStart = new Date(args.dayMs);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayStartMs = dayStart.getTime();
    const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
    const weekday = dayStart.getUTCDay();                   // 0-6

    // Find matching availability rules for this weekday
    const rules = (link.availability as Array<{ weekday: number; startMin: number; endMin: number }>)
      .filter((r) => r.weekday === weekday);
    if (rules.length === 0) return { slots: [], timezone: link.timezone };

    // Load existing events + bookings that overlap this day
    const events = await ctx.db
      .query("calendarEvents")
      .withIndex("by_workspace_owner_start", (q) =>
        q.eq("workspaceId", ws._id).eq("ownerId", link.ownerId),
      )
      .collect();
    const dayEvents = events.filter(
      (e) => e.archivedAt === undefined && e.status !== "cancelled" && e.endAt > dayStartMs && e.startAt < dayEndMs,
    );
    const bookings = await ctx.db
      .query("meetingBookings")
      .withIndex("by_link_start", (q) => q.eq("linkId", link._id))
      .collect();
    const dayBookings = bookings.filter(
      (b) => b.status === "confirmed" && b.endAt > dayStartMs && b.startAt < dayEndMs,
    );

    // Generate candidate slots
    const dur = link.durationMinutes;
    const step = dur;                                        // no overlap; slots step by duration
    const now = Date.now();
    const minStartAt = now + link.minLeadHours * 60 * 60 * 1000;
    const slots: number[] = [];
    for (const rule of rules) {
      for (let m = rule.startMin; m + dur <= rule.endMin; m += step) {
        const slotStart = dayStartMs + m * 60 * 1000;
        const slotEnd = slotStart + dur * 60 * 1000;
        if (slotStart < minStartAt) continue;
        // Overlap check
        const clashEvent = dayEvents.some(
          (e) =>
            slotStart < e.endAt + link.bufferMinutesAfter * 60 * 1000 &&
            slotEnd + link.bufferMinutesBefore * 60 * 1000 > e.startAt,
        );
        const clashBooking = dayBookings.some(
          (b) =>
            slotStart < b.endAt + link.bufferMinutesAfter * 60 * 1000 &&
            slotEnd + link.bufferMinutesBefore * 60 * 1000 > b.startAt,
        );
        if (clashEvent || clashBooking) continue;
        slots.push(slotStart);
      }
    }
    return { slots, timezone: link.timezone };
  },
});

/**
 * Public — creates a booking. Also inserts a matching calendarEvent
 * so it shows up on the host's calendar.
 */
export const createBooking = mutation({
  args: {
    workspaceSlug: v.string(),
    linkSlug: v.string(),
    startAt: v.number(),
    timezone: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    company: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ bookingId: Id<"meetingBookings">; endAt: number }> => {
    const ws = await ctx.db
      .query("workspaces")
      .filter((q) => q.eq(q.field("slug"), args.workspaceSlug))
      .first();
    if (!ws) throw new ConvexError({ code: "NOT_FOUND", message: "Not found." });
    const link = await ctx.db
      .query("meetingLinks")
      .withIndex("by_workspace_slug", (q) => q.eq("workspaceId", ws._id).eq("slug", args.linkSlug))
      .first();
    if (!link || !link.active) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Booking link not available." });
    }
    const email = args.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ConvexError({ code: "INVALID_EMAIL", message: "Invalid email." });
    }
    const endAt = args.startAt + link.durationMinutes * 60 * 1000;
    if (args.startAt < Date.now() + link.minLeadHours * 60 * 60 * 1000) {
      throw new ConvexError({ code: "TOO_SOON", message: "Slot must be further in the future." });
    }

    // Double-book check
    const overlapping = await ctx.db
      .query("meetingBookings")
      .withIndex("by_link_start", (q) => q.eq("linkId", link._id))
      .collect();
    const clash = overlapping.some(
      (b) =>
        b.status === "confirmed" &&
        args.startAt < b.endAt + link.bufferMinutesAfter * 60 * 1000 &&
        endAt + link.bufferMinutesBefore * 60 * 1000 > b.startAt,
    );
    if (clash) {
      throw new ConvexError({ code: "SLOT_TAKEN", message: "Slot no longer available." });
    }

    // Find/create contact
    let contact = await ctx.db
      .query("contacts")
      .withIndex("by_workspace_email", (q) => q.eq("workspaceId", ws._id).eq("email", email))
      .first();
    if (!contact) {
      const contactId = await ctx.db.insert("contacts", {
        workspaceId: ws._id,
        firstName: args.name ?? email.split("@")[0],
        email,
        phone: args.phone,
        source: `meeting:${link.slug}`,
        lifecycleStage: "warm",
        tags: ["booked-meeting"],
      });
      contact = await ctx.db.get(contactId);
    }

    const bookingId = await ctx.db.insert("meetingBookings", {
      workspaceId: ws._id,
      linkId: link._id,
      bookerEmail: email,
      bookerName: args.name,
      bookerPhone: args.phone,
      bookerCompany: args.company,
      note: args.note,
      startAt: args.startAt,
      endAt,
      timezone: args.timezone,
      contactId: contact?._id,
      status: "confirmed",
      receivedAt: Date.now(),
    });

    // Mirror to calendarEvents
    const eventId = await ctx.db.insert("calendarEvents", {
      workspaceId: ws._id,
      ownerId: link.ownerId,
      kind: "meeting",
      title: `${link.title} — ${args.name ?? email}`,
      description: args.note,
      location: link.location,
      conferenceUrl: link.conferenceUrl,
      startAt: args.startAt,
      endAt,
      allDay: false,
      attendeeEmails: [email],
      contactId: contact?._id,
      bookingId,
      status: "scheduled",
      createdAt: Date.now(),
    });
    await ctx.db.patch(bookingId, { eventId });

    if (contact) {
      await recordTimelineEvent(ctx, {
        workspaceId: ws._id,
        eventType: "meeting_scheduled",
        subjectType: "contact",
        subjectId: contact._id,
        relatedRefs: { eventId, bookingId, linkId: link._id },
        payload: { title: link.title, startAt: args.startAt, source: "booking_page" },
      });
    }

    // Fire-and-forget confirmation email
    await ctx.scheduler.runAfter(0, internal.mailer.sendMeetingConfirmationEmail, {
      to: email,
      hostName: ws.name,
      attendeeName: args.name,
      meetingTitle: link.title,
      startAtMs: args.startAt,
      durationMinutes: link.durationMinutes,
      timezone: args.timezone,
      conferenceUrl: link.conferenceUrl,
      location: link.location,
      note: args.note,
    });

    return { bookingId, endAt };
  },
});

export const cancelBooking = mutation({
  args: { id: v.id("meetingBookings"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const b = await ctx.db.get(args.id);
    if (!b || b.workspaceId !== wsCtx.workspace._id) return;
    await ctx.db.patch(args.id, {
      status: "cancelled_by_host",
      cancellationReason: args.reason,
    });
    if (b.eventId) {
      await ctx.db.patch(b.eventId, { status: "cancelled" });
    }
  },
});

/* ============================================================ */
/* Trial licenses                                                */
/* ============================================================ */

export const listTrialLicenses = query({
  args: {
    productSlug: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("active"),
        v.literal("expired"),
        v.literal("converted"),
        v.literal("cancelled"),
      ),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const limit = Math.min(args.limit ?? 100, 500);
    let rows: Doc<"trialLicenses">[];
    if (args.status) {
      rows = await ctx.db
        .query("trialLicenses")
        .withIndex("by_workspace_status", (q) =>
          q.eq("workspaceId", wsCtx.workspace._id).eq("status", args.status!),
        )
        .order("desc")
        .take(limit);
    } else {
      rows = await ctx.db
        .query("trialLicenses")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", wsCtx.workspace._id))
        .order("desc")
        .take(limit);
    }
    if (args.productSlug) rows = rows.filter((r) => r.productSlug === args.productSlug);
    return rows;
  },
});

export const createTrialLicense = mutation({
  args: {
    productSlug: v.string(),
    contactId: v.optional(v.id("contacts")),
    companyId: v.optional(v.id("companies")),
    dealId: v.optional(v.id("deals")),
    durationDays: v.optional(v.number()),
    features: v.optional(v.any()),
    seatCap: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const days = args.durationDays ?? 14;
    const now = Date.now();
    const licenseKey = generateLicenseKey(args.productSlug);
    return await ctx.db.insert("trialLicenses", {
      workspaceId: wsCtx.workspace._id,
      contactId: args.contactId,
      companyId: args.companyId,
      dealId: args.dealId,
      productSlug: args.productSlug,
      licenseKey,
      trialStartAt: now,
      trialEndAt: now + days * 24 * 60 * 60 * 1000,
      features: args.features,
      seatCap: args.seatCap,
      status: "active",
      ownerId: wsCtx.user._id,
      createdAt: now,
    });
  },
});

export const activateTrialLicense = mutation({
  args: { id: v.id("trialLicenses") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const t = await ctx.db.get(id);
    if (!t || t.workspaceId !== wsCtx.workspace._id) return;
    await ctx.db.patch(id, {
      activatedAt: t.activatedAt ?? Date.now(),
      lastActiveAt: Date.now(),
    });
  },
});

export const cancelTrialLicense = mutation({
  args: { id: v.id("trialLicenses") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const t = await ctx.db.get(id);
    if (!t || t.workspaceId !== wsCtx.workspace._id) return;
    await ctx.db.patch(id, { status: "cancelled" });
  },
});

/* ============================================================ */

function generateLicenseKey(prefix: string): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let out = "";
    for (let i = 0; i < 4; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    groups.push(out);
  }
  return `${prefix.toUpperCase()}-${groups.join("-")}`;
}
