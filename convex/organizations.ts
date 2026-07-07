/**
 * Org + workspace queries/mutations.
 *
 * Provides:
 *   - currentBootstrap: the data the app shell needs on every page load
 *     (user, current org + workspace, available orgs/workspaces)
 *   - createOrganization: first-run setup (org + first workspace)
 *   - createWorkspace: add a workspace inside an org
 *   - setActiveWorkspace: switch the active workspace for this user
 *   - listMyOrganizations / listMyWorkspaces
 */

import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  getAuthedUser,
  recordAudit,
  requireOrgRole,
  requireUser,
} from "./lib/authHelpers";
import type { Doc, Id } from "./_generated/dataModel";

/* ------------------------------------------------------------------ */
/* currentBootstrap — single query for the app shell                    */
/* ------------------------------------------------------------------ */

export const currentBootstrap = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthedUser(ctx);
    if (!user) return null;

    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();

    // All orgs the user belongs to
    const memberships = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const organizations = await Promise.all(
      memberships.map(async (m) => {
        const org = await ctx.db.get(m.organizationId);
        return org ? { ...org, role: m.role } : null;
      }),
    );

    // Determine active org
    let activeOrgId = profile?.lastActiveOrgId ?? memberships[0]?.organizationId;
    const activeOrg = activeOrgId ? await ctx.db.get(activeOrgId) : null;

    // Workspaces in the active org
    let workspaces: Array<Doc<"workspaces"> & { role: string | null }> = [];
    let activeWorkspace: (Doc<"workspaces"> & { role: string | null }) | null = null;

    if (activeOrgId) {
      const allWsInOrg = await ctx.db
        .query("workspaces")
        .withIndex("by_org", (q) => q.eq("organizationId", activeOrgId!))
        .collect();

      // Filter to workspaces the user has access to (or all if org owner/admin)
      const orgMembership = memberships.find((m) => m.organizationId === activeOrgId);
      const isOrgAdminOrOwner =
        orgMembership?.role === "owner" || orgMembership?.role === "admin";

      const wsMemberships = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      const wsRoleByWs = new Map(wsMemberships.map((m) => [m.workspaceId, m.role]));

      workspaces = allWsInOrg
        .filter((ws) => isOrgAdminOrOwner || wsRoleByWs.has(ws._id))
        .map((ws) => ({ ...ws, role: wsRoleByWs.get(ws._id) ?? (isOrgAdminOrOwner ? "owner" : null) }));

      const activeWsId = profile?.lastActiveWorkspaceId ?? workspaces[0]?._id;
      activeWorkspace = workspaces.find((w) => w._id === activeWsId) ?? workspaces[0] ?? null;
    }

    return {
      user: {
        _id: user._id,
        email: user.email ?? null,
        name: user.name ?? null,
        image: user.image ?? null,
      },
      profile: profile ?? null,
      organizations: organizations.filter((o): o is NonNullable<typeof o> => o !== null),
      activeOrg,
      workspaces,
      activeWorkspace,
    };
  },
});

/* ------------------------------------------------------------------ */
/* createOrganization — first-run + invitation-accept path             */
/* ------------------------------------------------------------------ */

export const createOrganization = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
    firstWorkspaceName: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const slug = args.slug.trim().toLowerCase();
    if (!/^[a-z0-9-]{2,40}$/.test(slug)) {
      throw new ConvexError({
        code: "INVALID_SLUG",
        message: "Slug must be 2–40 lowercase letters, digits, or hyphens.",
      });
    }

    // Slug uniqueness
    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (existing) {
      throw new ConvexError({
        code: "SLUG_TAKEN",
        message: "An organization with this slug already exists.",
      });
    }

    const organizationId = await ctx.db.insert("organizations", {
      name: args.name.trim(),
      slug,
    });

    await ctx.db.insert("members", {
      organizationId,
      userId: user._id,
      role: "owner",
      joinedAt: Date.now(),
    });

    const workspaceId = await ctx.db.insert("workspaces", {
      organizationId,
      slug: "main",
      name: args.firstWorkspaceName.trim(),
      currency: "KES",
      timezone: "Africa/Nairobi",
    });

    await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId: user._id,
      role: "owner",
      joinedAt: Date.now(),
    });

    // Ensure userProfile exists & track active org/workspace
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (profile) {
      await ctx.db.patch(profile._id, {
        lastActiveOrgId: organizationId,
        lastActiveWorkspaceId: workspaceId,
      });
    } else {
      await ctx.db.insert("userProfiles", {
        userId: user._id,
        timezone: "Africa/Nairobi",
        locale: "en",
        lastActiveOrgId: organizationId,
        lastActiveWorkspaceId: workspaceId,
        onboardedAt: Date.now(),
      });
    }

    await recordAudit(ctx, {
      organizationId,
      actorId: user._id,
      action: "created",
      resourceType: "organization",
      resourceId: organizationId,
      after: { name: args.name, slug },
    });

    return { organizationId, workspaceId };
  },
});

/* ------------------------------------------------------------------ */
/* createWorkspace — add a workspace inside an org                     */
/* ------------------------------------------------------------------ */

export const createWorkspace = mutation({
  args: {
    organizationId: v.id("organizations"),
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    currency: v.optional(v.string()),
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOrgRole(ctx, args.organizationId, "admin");
    const user = await requireUser(ctx);

    const slug = args.slug.trim().toLowerCase();
    const dup = await ctx.db
      .query("workspaces")
      .withIndex("by_org_slug", (q) =>
        q.eq("organizationId", args.organizationId).eq("slug", slug),
      )
      .unique();
    if (dup) {
      throw new ConvexError({
        code: "SLUG_TAKEN",
        message: "A workspace with this slug already exists in this org.",
      });
    }

    const workspaceId = await ctx.db.insert("workspaces", {
      organizationId: args.organizationId,
      slug,
      name: args.name.trim(),
      description: args.description,
      currency: args.currency ?? "KES",
      timezone: args.timezone ?? "Africa/Nairobi",
    });

    await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId: user._id,
      role: "owner",
      joinedAt: Date.now(),
    });

    await recordAudit(ctx, {
      organizationId: args.organizationId,
      workspaceId,
      actorId: user._id,
      action: "created",
      resourceType: "workspace",
      resourceId: workspaceId,
      after: { slug, name: args.name },
    });

    return workspaceId;
  },
});

/* ------------------------------------------------------------------ */
/* setActiveWorkspace — switch active workspace for the current user   */
/* ------------------------------------------------------------------ */

export const updateWorkspace = mutation({
  args: {
    id: v.id("workspaces"),
    patch: v.object({
      name: v.optional(v.string()),
      description: v.optional(v.string()),
      website: v.optional(v.string()),
      oneLiner: v.optional(v.string()),
      elevatorPitch: v.optional(v.string()),
      offerings: v.optional(v.string()),
      targetMarket: v.optional(v.string()),
      brandVoice: v.optional(v.string()),
      coreValues: v.optional(v.string()),
      pricingSummary: v.optional(v.string()),
      assistantName: v.optional(v.string()),
      assistantPersonaTraits: v.optional(v.string()),
      emailHeaderHtml: v.optional(v.string()),
      emailFooterHtml: v.optional(v.string()),
      emailAccentColor: v.optional(v.string()),
      emailLogoUrl: v.optional(v.string()),
      emailPhysicalAddress: v.optional(v.string()),
      emailSocialLinks: v.optional(
        v.object({
          twitter: v.optional(v.string()),
          linkedin: v.optional(v.string()),
          instagram: v.optional(v.string()),
          facebook: v.optional(v.string()),
        }),
      ),
      prospectorDailyCap: v.optional(v.number()),
      googleMapsDailySearchCap: v.optional(v.number()),
      timezone: v.optional(v.string()),
      currency: v.optional(v.string()),
      brandColor: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const ws = await ctx.db.get(args.id);
    if (!ws) throw new ConvexError({ code: "NOT_FOUND", message: "Workspace not found." });
    // Verify user is org admin or higher
    await requireOrgRole(ctx, ws.organizationId, "member");
    await ctx.db.patch(args.id, args.patch);
    await recordAudit(ctx, {
      organizationId: ws.organizationId,
      workspaceId: args.id,
      actorId: user._id,
      action: "updated",
      resourceType: "workspace",
      resourceId: args.id,
      after: args.patch,
    });
  },
});

export const setActiveWorkspace = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const ws = await ctx.db.get(args.workspaceId);
    if (!ws) throw new ConvexError({ code: "NOT_FOUND", message: "Workspace not found." });

    // Membership in the workspace OR org-level owner/admin
    const wsMembership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", user._id),
      )
      .unique();
    if (!wsMembership) {
      const orgMembership = await ctx.db
        .query("members")
        .withIndex("by_org_user", (q) =>
          q.eq("organizationId", ws.organizationId).eq("userId", user._id),
        )
        .unique();
      if (!orgMembership || (orgMembership.role !== "owner" && orgMembership.role !== "admin")) {
        throw new ConvexError({
          code: "NOT_IN_WORKSPACE",
          message: "You don't have access to this workspace.",
        });
      }
    }

    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (profile) {
      await ctx.db.patch(profile._id, {
        lastActiveOrgId: ws.organizationId,
        lastActiveWorkspaceId: args.workspaceId,
      });
    } else {
      await ctx.db.insert("userProfiles", {
        userId: user._id,
        timezone: "Africa/Nairobi",
        locale: "en",
        lastActiveOrgId: ws.organizationId,
        lastActiveWorkspaceId: args.workspaceId,
      });
    }
  },
});

export const setActiveOrganization = mutation({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const m = await ctx.db
      .query("members")
      .withIndex("by_org_user", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", user._id),
      )
      .unique();
    if (!m) {
      throw new ConvexError({ code: "NOT_IN_ORG", message: "Not a member of this org." });
    }

    // Pick the first workspace in the org the user can see
    const wsList = await ctx.db
      .query("workspaces")
      .withIndex("by_org", (q) => q.eq("organizationId", args.organizationId))
      .collect();

    let firstWsId: Id<"workspaces"> | undefined;
    if (m.role === "owner" || m.role === "admin") {
      firstWsId = wsList[0]?._id;
    } else {
      for (const ws of wsList) {
        const wm = await ctx.db
          .query("workspaceMembers")
          .withIndex("by_workspace_user", (q) =>
            q.eq("workspaceId", ws._id).eq("userId", user._id),
          )
          .unique();
        if (wm) {
          firstWsId = ws._id;
          break;
        }
      }
    }

    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (profile) {
      await ctx.db.patch(profile._id, {
        lastActiveOrgId: args.organizationId,
        lastActiveWorkspaceId: firstWsId,
      });
    } else {
      await ctx.db.insert("userProfiles", {
        userId: user._id,
        timezone: "Africa/Nairobi",
        locale: "en",
        lastActiveOrgId: args.organizationId,
        lastActiveWorkspaceId: firstWsId,
      });
    }
  },
});


/* ============================================================ */
/* Team invitations (task #25)                                    */
/* ============================================================ */

import { internal } from "./_generated/api";

/**
 * Invite a teammate to the current org. Owner-only.
 *   - Creates or refreshes an `invitations` row keyed by (org, email).
 *   - Generates a URL-safe token, 14-day expiry.
 *   - Schedules an invitation email via mailer.sendInvitationEmail.
 */
export const createInvitation = mutation({
  args: {
    organizationId: v.id("organizations"),
    email: v.string(),
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),
    workspaceAssignments: v.optional(
      v.array(
        v.object({
          workspaceId: v.id("workspaces"),
          role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await requireOrgRole(ctx, args.organizationId, "admin");

    const emailLc = args.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailLc)) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "Email looks invalid." });
    }

    // Do not invite existing member
    const existingMember = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("organizationId", args.organizationId))
      .collect();
    for (const m of existingMember) {
      const u = await ctx.db.get(m.userId);
      if (u?.email?.toLowerCase() === emailLc) {
        throw new ConvexError({
          code: "ALREADY_MEMBER",
          message: "This email is already a member of the organisation.",
        });
      }
    }

    // Upsert invitation row
    const existing = await ctx.db
      .query("invitations")
      .withIndex("by_org_email", (q) =>
        q.eq("organizationId", args.organizationId).eq("email", emailLc),
      )
      .first();

    const token = generateInviteToken();
    const now = Date.now();
    const expiresAt = now + 14 * 24 * 60 * 60 * 1000;

    let invitationId: Id<"invitations">;
    if (existing && existing.status === "pending") {
      await ctx.db.patch(existing._id, {
        role: args.role,
        workspaceAssignments: args.workspaceAssignments,
        token,
        expiresAt,
        inviterId: user._id,
      });
      invitationId = existing._id;
    } else {
      invitationId = await ctx.db.insert("invitations", {
        organizationId: args.organizationId,
        email: emailLc,
        role: args.role,
        workspaceAssignments: args.workspaceAssignments,
        inviterId: user._id,
        token,
        status: "pending",
        expiresAt,
      });
    }

    const org = await ctx.db.get(args.organizationId);
    const inviter = user;
    const acceptUrl = `${process.env.SITE_URL ?? "https://atlas.blyss.co.ke"}/invite/${token}`;

    // Fire-and-forget email
    await ctx.scheduler.runAfter(0, internal.mailer.sendInvitationEmail, {
      to: emailLc,
      inviterName: inviter.name ?? inviter.email ?? "Someone at Atlas",
      organizationName: org?.name ?? "the team",
      role: args.role,
      acceptUrl,
    });

    await recordAudit(ctx, {
      organizationId: args.organizationId,
      actorId: user._id,
      action: "invited_member",
      resourceType: "invitation",
      resourceId: invitationId,
      after: { email: emailLc, role: args.role },
    });

    return { invitationId, acceptUrl };
  },
});

/**
 * Accept an invitation (called from /invite/:token page). Creates a
 * `members` row + optional `workspaceMembers` per assignment, marks
 * invitation `accepted`.
 *
 * Called by an already-signed-in user whose email matches the invite.
 */
export const acceptInvitation = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const inv = await ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!inv) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Invitation not found." });
    }
    if (inv.status !== "pending") {
      throw new ConvexError({ code: "INVALID_STATE", message: `Invitation is ${inv.status}.` });
    }
    if (inv.expiresAt < Date.now()) {
      await ctx.db.patch(inv._id, { status: "expired" });
      throw new ConvexError({ code: "EXPIRED", message: "Invitation has expired." });
    }
    // Email match check
    if (!user.email || user.email.toLowerCase() !== inv.email) {
      throw new ConvexError({
        code: "EMAIL_MISMATCH",
        message: `Sign in as ${inv.email} to accept this invitation.`,
      });
    }

    // Create membership
    const alreadyMember = await ctx.db
      .query("members")
      .withIndex("by_org_user", (q) =>
        q.eq("organizationId", inv.organizationId).eq("userId", user._id),
      )
      .first();
    if (!alreadyMember) {
      await ctx.db.insert("members", {
        organizationId: inv.organizationId,
        userId: user._id,
        role: inv.role,
        invitedBy: inv.inviterId,
        joinedAt: Date.now(),
      });
    }

    // Workspace memberships
    if (inv.workspaceAssignments) {
      for (const a of inv.workspaceAssignments) {
        const existing = await ctx.db
          .query("workspaceMembers")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", a.workspaceId))
          .filter((q) => q.eq(q.field("userId"), user._id))
          .first();
        if (!existing) {
          await ctx.db.insert("workspaceMembers", {
            workspaceId: a.workspaceId,
            userId: user._id,
            role: a.role,
            invitedBy: inv.inviterId,
            joinedAt: Date.now(),
          });
        }
      }
    }

    await ctx.db.patch(inv._id, { status: "accepted" });

    await recordAudit(ctx, {
      organizationId: inv.organizationId,
      actorId: user._id,
      action: "accepted_invitation",
      resourceType: "invitation",
      resourceId: inv._id,
      after: { email: inv.email },
    });

    return { organizationId: inv.organizationId };
  },
});

export const listInvitations = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireOrgRole(ctx, args.organizationId, "admin");
    const rows = await ctx.db
      .query("invitations")
      .withIndex("by_org_email", (q) => q.eq("organizationId", args.organizationId))
      .collect();
    return rows;
  },
});

export const revokeInvitation = mutation({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const inv = await ctx.db.get(args.invitationId);
    if (!inv) throw new ConvexError({ code: "NOT_FOUND", message: "Not found." });
    await requireOrgRole(ctx, inv.organizationId, "admin");
    await ctx.db.patch(args.invitationId, { status: "revoked" });
    await recordAudit(ctx, {
      organizationId: inv.organizationId,
      actorId: user._id,
      action: "revoked_invitation",
      resourceType: "invitation",
      resourceId: args.invitationId,
    });
  },
});

/* ------------------------------------------------------------------ */
/* URL-safe token — no external RNG dep                                */
/* ------------------------------------------------------------------ */

function generateInviteToken(): string {
  const alpha = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += alpha[Math.floor(Math.random() * alpha.length)];
  return out;
}
