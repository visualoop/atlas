/**
 * Workspace context — resolves the user's "active workspace" for
 * mutations and queries that need workspaceId without taking it as
 * an explicit arg.
 *
 * Active workspace is `userProfiles.lastActiveWorkspaceId`. Helper
 * also validates the user has access (owner of the org, or has a
 * workspaceMembers row).
 */

import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { requireUser, requireWorkspaceRole } from "./authHelpers";

export interface WorkspaceContext {
  user: Doc<"users">;
  workspace: Doc<"workspaces">;
  role: "owner" | "admin" | "member" | "viewer";
}

/**
 * Resolve the active workspace for the calling user.
 * If `workspaceId` is passed explicitly, use that — otherwise read
 * the user's `lastActiveWorkspaceId`.
 *
 * `minimumRole` defaults to "member" (write-capable). Use "viewer"
 * for read-only queries.
 */
export async function requireWorkspaceContext(
  ctx: QueryCtx | MutationCtx,
  args: {
    workspaceId?: Id<"workspaces">;
    minimumRole?: "owner" | "admin" | "member" | "viewer";
  } = {},
): Promise<WorkspaceContext> {
  const user = await requireUser(ctx);
  let workspaceId = args.workspaceId;

  if (!workspaceId) {
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (!profile?.lastActiveWorkspaceId) {
      throw new ConvexError({
        code: "NO_ACTIVE_WORKSPACE",
        message: "No active workspace. Create or select one first.",
      });
    }
    workspaceId = profile.lastActiveWorkspaceId;
  }

  const workspace = await ctx.db.get(workspaceId);
  if (!workspace) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Workspace not found.",
    });
  }

  const membership = await requireWorkspaceRole(ctx, workspaceId, args.minimumRole ?? "member");
  return { user, workspace, role: membership.role as WorkspaceContext["role"] };
}

/**
 * Lighter variant: returns null instead of throwing when no active
 * workspace. Used by queries that should render gracefully during the
 * first-run wizard.
 */
export async function getWorkspaceContext(
  ctx: QueryCtx | MutationCtx,
): Promise<WorkspaceContext | null> {
  try {
    return await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
  } catch {
    return null;
  }
}
