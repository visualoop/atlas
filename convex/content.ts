/**
 * Content & Marketing Hub (Phase 8b).
 *
 * Bundles three related surfaces:
 *   - Broadcasts (newsletter one-offs to audiences)
 *   - Landing pages (public, form-capturing)
 *   - SEO idea backlog
 *
 * All CRUD lives here. Real newsletter dispatch via Resend Broadcasts
 * happens in a follow-up action (deferred). Public landing page
 * rendering + signup capture live in `landingPages.getBySlug` (no auth).
 */

import { v, ConvexError } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import { recordAudit } from "./lib/authHelpers";
import { recordTimelineEvent } from "./lib/timeline";
import { recordAttribution } from "./lib/attribution";
import type { Doc, Id } from "./_generated/dataModel";

/* ============================================================ */
/* Audiences                                                     */
/* ============================================================ */

export const listAudiences = query({
  args: {},
  handler: async (ctx) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const rows = await ctx.db
      .query("audiences")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", wsCtx.workspace._id))
      .collect();
    return rows.filter((r) => r.archivedAt === undefined);
  },
});

export const createAudience = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    if (args.name.trim().length < 3) {
      throw new ConvexError({ code: "INVALID", message: "Audience name too short." });
    }
    const id = await ctx.db.insert("audiences", {
      workspaceId: wsCtx.workspace._id,
      name: args.name.trim(),
      description: args.description,
      memberCount: 0,
    });
    return id;
  },
});

export const addAudienceMember = mutation({
  args: {
    audienceId: v.id("audiences"),
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    contactId: v.optional(v.id("contacts")),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const audience = await ctx.db.get(args.audienceId);
    if (!audience || audience.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Audience not found." });
    }
    const email = args.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ConvexError({ code: "INVALID_EMAIL", message: "Invalid email." });
    }
    // Dedupe
    const existing = await ctx.db
      .query("audienceMembers")
      .withIndex("by_audience_email", (q) =>
        q.eq("audienceId", args.audienceId).eq("email", email),
      )
      .first();
    if (existing) return existing._id;

    const id = await ctx.db.insert("audienceMembers", {
      workspaceId: wsCtx.workspace._id,
      audienceId: args.audienceId,
      email,
      firstName: args.firstName,
      lastName: args.lastName,
      contactId: args.contactId,
      subscribedAt: Date.now(),
      tags: args.tags ?? [],
    });
    await ctx.db.patch(args.audienceId, { memberCount: audience.memberCount + 1 });
    return id;
  },
});

/* ============================================================ */
/* Broadcasts                                                    */
/* ============================================================ */

export const listBroadcasts = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("scheduled"),
        v.literal("sending"),
        v.literal("sent"),
        v.literal("failed"),
        v.literal("cancelled"),
      ),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const limit = Math.min(args.limit ?? 100, 500);
    let rows: Doc<"broadcasts">[];
    if (args.status) {
      rows = await ctx.db
        .query("broadcasts")
        .withIndex("by_workspace_status", (q) =>
          q.eq("workspaceId", wsCtx.workspace._id).eq("status", args.status!),
        )
        .order("desc")
        .take(limit);
    } else {
      rows = await ctx.db
        .query("broadcasts")
        .withIndex("by_workspace_time", (q) => q.eq("workspaceId", wsCtx.workspace._id))
        .order("desc")
        .take(limit);
    }
    return rows.filter((r) => r.archivedAt === undefined);
  },
});

export const createBroadcast = mutation({
  args: {
    name: v.string(),
    audienceId: v.id("audiences"),
    subject: v.string(),
    preheader: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const audience = await ctx.db.get(args.audienceId);
    if (!audience || audience.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Audience not found." });
    }
    const id = await ctx.db.insert("broadcasts", {
      workspaceId: wsCtx.workspace._id,
      name: args.name,
      audienceId: args.audienceId,
      subject: args.subject,
      preheader: args.preheader,
      body: { type: "doc", content: [] },
      status: "draft",
      recipientCount: audience.memberCount,
      sentCount: 0,
      openCount: 0,
      clickCount: 0,
      unsubscribeCount: 0,
      ownerId: wsCtx.user._id,
    });
    return id;
  },
});

export const updateBroadcast = mutation({
  args: {
    id: v.id("broadcasts"),
    patch: v.object({
      name: v.optional(v.string()),
      subject: v.optional(v.string()),
      preheader: v.optional(v.string()),
      body: v.optional(v.any()),
      bodyHtml: v.optional(v.string()),
      bodyText: v.optional(v.string()),
      fromIdentityId: v.optional(v.id("senderIdentities")),
      scheduledFor: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const b = await ctx.db.get(args.id);
    if (!b || b.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Broadcast not found." });
    }
    if (b.status !== "draft" && b.status !== "scheduled") {
      throw new ConvexError({
        code: "IMMUTABLE",
        message: "Can't edit a broadcast that's already been sent.",
      });
    }
    await ctx.db.patch(args.id, args.patch);
  },
});

/* ============================================================ */
/* Landing pages                                                 */
/* ============================================================ */

export const listLandingPages = query({
  args: {},
  handler: async (ctx) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const rows = await ctx.db
      .query("landingPages")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", wsCtx.workspace._id))
      .collect();
    return rows.filter((r) => r.archivedAt === undefined);
  },
});

export const getLandingPage = query({
  args: { id: v.id("landingPages") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const p = await ctx.db.get(id);
    if (!p || p.workspaceId !== wsCtx.workspace._id) return null;
    return p;
  },
});

export const createLandingPage = mutation({
  args: {
    slug: v.string(),
    kind: v.union(
      v.literal("product_launch"),
      v.literal("waitlist"),
      v.literal("event"),
      v.literal("lead_magnet"),
      v.literal("custom"),
    ),
    title: v.string(),
    subtitle: v.optional(v.string()),
    formFields: v.optional(v.array(v.string())),
    audienceId: v.optional(v.id("audiences")),
    defaultTags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const slug = args.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (slug.length < 2) {
      throw new ConvexError({ code: "INVALID_SLUG", message: "Slug too short." });
    }
    const existing = await ctx.db
      .query("landingPages")
      .withIndex("by_workspace_slug", (q) =>
        q.eq("workspaceId", wsCtx.workspace._id).eq("slug", slug),
      )
      .first();
    if (existing) {
      throw new ConvexError({ code: "SLUG_TAKEN", message: "That slug is already in use." });
    }
    const id = await ctx.db.insert("landingPages", {
      workspaceId: wsCtx.workspace._id,
      slug,
      kind: args.kind,
      title: args.title,
      subtitle: args.subtitle,
      body: { type: "doc", content: [] },
      bodyText: "",
      formFields: args.formFields ?? ["email", "firstName"],
      audienceId: args.audienceId,
      defaultTags: args.defaultTags,
      viewCount: 0,
      signupCount: 0,
      status: "draft",
      ownerId: wsCtx.user._id,
    });
    return id;
  },
});

export const updateLandingPage = mutation({
  args: {
    id: v.id("landingPages"),
    patch: v.object({
      title: v.optional(v.string()),
      subtitle: v.optional(v.string()),
      body: v.optional(v.any()),
      bodyText: v.optional(v.string()),
      metaDescription: v.optional(v.string()),
      formFields: v.optional(v.array(v.string())),
      audienceId: v.optional(v.id("audiences")),
      defaultTags: v.optional(v.array(v.string())),
      heroFileId: v.optional(v.id("files")),
      ogImageFileId: v.optional(v.id("files")),
      leadMagnetFileId: v.optional(v.id("files")),
    }),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const p = await ctx.db.get(args.id);
    if (!p || p.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Landing page not found." });
    }
    await ctx.db.patch(args.id, args.patch);
  },
});

export const publishLandingPage = mutation({
  args: { id: v.id("landingPages") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const p = await ctx.db.get(id);
    if (!p || p.workspaceId !== wsCtx.workspace._id) return;
    await ctx.db.patch(id, {
      status: "published",
      publishedAt: p.publishedAt ?? Date.now(),
    });
  },
});

export const archiveLandingPage = mutation({
  args: { id: v.id("landingPages") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const p = await ctx.db.get(id);
    if (!p || p.workspaceId !== wsCtx.workspace._id) return;
    await ctx.db.patch(id, { status: "archived", archivedAt: Date.now() });
  },
});

/* ============================================================ */
/* Public — landing page render + signup capture                  */
/* ============================================================ */

export const getLandingPageBySlug = query({
  args: {
    workspaceSlug: v.string(),
    pageSlug: v.string(),
  },
  handler: async (ctx, args) => {
    // Look up workspace by slug (org-level slugs, per current schema)
    const ws = await ctx.db
      .query("workspaces")
      .filter((q) => q.eq(q.field("slug"), args.workspaceSlug))
      .first();
    if (!ws) return null;
    const page = await ctx.db
      .query("landingPages")
      .withIndex("by_workspace_slug", (q) =>
        q.eq("workspaceId", ws._id).eq("slug", args.pageSlug),
      )
      .first();
    if (!page || page.status !== "published" || page.archivedAt) return null;
    return {
      page,
      workspaceName: ws.name,
    };
  },
});

/**
 * Public signup mutation — no auth. Called by the landing page form.
 * Creates a contact + audience member + signup row + (optionally)
 * triggers lead-magnet delivery.
 */
export const submitLandingSignup = mutation({
  args: {
    workspaceSlug: v.string(),
    pageSlug: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    company: v.optional(v.string()),
    meta: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const ws = await ctx.db
      .query("workspaces")
      .filter((q) => q.eq(q.field("slug"), args.workspaceSlug))
      .first();
    if (!ws) throw new ConvexError({ code: "NOT_FOUND", message: "Workspace not found." });

    const page = await ctx.db
      .query("landingPages")
      .withIndex("by_workspace_slug", (q) =>
        q.eq("workspaceId", ws._id).eq("slug", args.pageSlug),
      )
      .first();
    if (!page || page.status !== "published") {
      throw new ConvexError({ code: "NOT_FOUND", message: "Landing page not available." });
    }

    const email = args.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ConvexError({ code: "INVALID_EMAIL", message: "Invalid email address." });
    }

    // Find or create contact
    let contact = await ctx.db
      .query("contacts")
      .withIndex("by_workspace_email", (q) =>
        q.eq("workspaceId", ws._id).eq("email", email),
      )
      .first();
    if (!contact) {
      const contactId = await ctx.db.insert("contacts", {
        workspaceId: ws._id,
        firstName: args.firstName ?? email.split("@")[0],
        lastName: args.lastName,
        email,
        source: `landing:${page.slug}`,
        lifecycleStage: "cold",
        tags: page.defaultTags ?? [],
      });
      contact = await ctx.db.get(contactId);
    }

    // Add to audience if configured
    let audienceMemberId: Id<"audienceMembers"> | undefined;
    if (page.audienceId) {
      const audience = await ctx.db.get(page.audienceId);
      if (audience) {
        const already = await ctx.db
          .query("audienceMembers")
          .withIndex("by_audience_email", (q) =>
            q.eq("audienceId", page.audienceId!).eq("email", email),
          )
          .first();
        if (already) {
          audienceMemberId = already._id;
        } else {
          audienceMemberId = await ctx.db.insert("audienceMembers", {
            workspaceId: ws._id,
            audienceId: page.audienceId!,
            email,
            firstName: args.firstName,
            lastName: args.lastName,
            contactId: contact?._id,
            subscribedAt: Date.now(),
            tags: page.defaultTags ?? [],
          });
          await ctx.db.patch(page.audienceId!, {
            memberCount: audience.memberCount + 1,
          });
        }
      }
    }

    // Log signup
    const signupId = await ctx.db.insert("landingSignups", {
      workspaceId: ws._id,
      pageId: page._id,
      email,
      firstName: args.firstName,
      lastName: args.lastName,
      company: args.company,
      meta: args.meta,
      contactId: contact?._id,
      audienceMemberId,
      leadMagnetDelivered: false,
      receivedAt: Date.now(),
    });

    // Bump signup counter
    await ctx.db.patch(page._id, { signupCount: page.signupCount + 1 });

    // Attribution touch — always logged (with sessionId if no contact yet)
    await recordAttribution(ctx, {
      workspaceId: ws._id,
      contactId: contact?._id,
      touchType: "landing_signup",
      source: `landing:${page.slug}`,
      medium: "landing",
      landingPageId: page._id,
    });

    // Emit timeline event on the contact
    if (contact) {
      await recordTimelineEvent(ctx, {
        workspaceId: ws._id,
        eventType: "landing_signup",
        subjectType: "contact",
        subjectId: contact._id,
        relatedRefs: { pageId: page._id, signupId },
        payload: {
          pageTitle: page.title,
          pageSlug: page.slug,
          source: `landing:${page.slug}`,
        },
      });
    }

    // Resolve lead magnet URL if present. Convex's storage.getUrl returns
    // a time-limited public URL; good enough for a lead magnet drop.
    let leadMagnetUrl: string | undefined;
    let leadMagnetLabel: string | undefined;
    if (page.leadMagnetFileId) {
      const f = await ctx.db.get(page.leadMagnetFileId);
      if (f) {
        const url = await ctx.storage.getUrl(f.storageId);
        if (url) {
          leadMagnetUrl = url;
          leadMagnetLabel = f.filename;
        }
      }
    }

    // Fire-and-forget welcome email
    await ctx.scheduler.runAfter(0, internal.mailer.sendLandingWelcomeEmail, {
      to: email,
      workspaceName: ws.name,
      pageTitle: page.title,
      pageKind: page.kind,
      firstName: args.firstName,
      leadMagnetUrl,
      leadMagnetLabel,
    });

    return {
      status: "ok" as const,
      hasLeadMagnet: page.leadMagnetFileId !== undefined,
    };
  },
});

/** Public view tracker — bumps viewCount on load. */
export const recordLandingView = mutation({
  args: {
    workspaceSlug: v.string(),
    pageSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const ws = await ctx.db
      .query("workspaces")
      .filter((q) => q.eq(q.field("slug"), args.workspaceSlug))
      .first();
    if (!ws) return;
    const page = await ctx.db
      .query("landingPages")
      .withIndex("by_workspace_slug", (q) =>
        q.eq("workspaceId", ws._id).eq("slug", args.pageSlug),
      )
      .first();
    if (!page || page.status !== "published") return;
    await ctx.db.patch(page._id, { viewCount: page.viewCount + 1 });
  },
});

/* ============================================================ */
/* SEO ideas                                                     */
/* ============================================================ */

export const listSeoIdeas = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("new"),
        v.literal("shortlisted"),
        v.literal("drafting"),
        v.literal("published"),
        v.literal("dismissed"),
      ),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const limit = Math.min(args.limit ?? 100, 500);
    let rows: Doc<"seoIdeas">[];
    if (args.status) {
      rows = await ctx.db
        .query("seoIdeas")
        .withIndex("by_workspace_status", (q) =>
          q.eq("workspaceId", wsCtx.workspace._id).eq("status", args.status!),
        )
        .order("desc")
        .take(limit);
    } else {
      rows = await ctx.db
        .query("seoIdeas")
        .withIndex("by_workspace_time", (q) => q.eq("workspaceId", wsCtx.workspace._id))
        .order("desc")
        .take(limit);
    }
    return rows.filter((r) => r.archivedAt === undefined);
  },
});

export const updateSeoIdeaStatus = mutation({
  args: {
    id: v.id("seoIdeas"),
    status: v.union(
      v.literal("new"),
      v.literal("shortlisted"),
      v.literal("drafting"),
      v.literal("published"),
      v.literal("dismissed"),
    ),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const i = await ctx.db.get(args.id);
    if (!i || i.workspaceId !== wsCtx.workspace._id) return;
    await ctx.db.patch(args.id, { status: args.status });
  },
});

export const createSeoIdea = mutation({
  args: {
    title: v.string(),
    angle: v.string(),
    keywords: v.optional(v.array(v.string())),
    productId: v.optional(v.string()),
    priority: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "member" });
    const id = await ctx.db.insert("seoIdeas", {
      workspaceId: wsCtx.workspace._id,
      title: args.title,
      angle: args.angle,
      keywords: args.keywords ?? [],
      productId: args.productId,
      priority: args.priority ?? 50,
      status: "new",
      source: "manual",
      generatedAt: Date.now(),
    });
    return id;
  },
});

/** Internal insert used by AI ideation cron */
export const insertGeneratedIdea = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    title: v.string(),
    angle: v.string(),
    keywords: v.array(v.string()),
    competitorRefs: v.optional(v.array(v.string())),
    productId: v.optional(v.string()),
    priority: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("seoIdeas", {
      workspaceId: args.workspaceId,
      title: args.title,
      angle: args.angle,
      keywords: args.keywords,
      competitorRefs: args.competitorRefs,
      productId: args.productId,
      priority: args.priority,
      status: "new",
      source: "ai_daily",
      generatedAt: Date.now(),
    });
  },
});
