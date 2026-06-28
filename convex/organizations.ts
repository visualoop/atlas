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
