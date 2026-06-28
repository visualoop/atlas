/**
 * Auth + RBAC helpers — single chokepoint for "who's calling this".
 *
 * Every query/mutation that needs an authenticated user calls
 * `requireUser(ctx)`. Workspace-scoped mutations call
 * `requireWorkspaceRole(ctx, workspaceId, [roles])`. Org-level
 * mutations call `requireOrgRole(ctx, orgId, [roles])`.
 *
 * Throws `ConvexError` instances with stable error codes so the client
 * renders specific UI (banner, redirect, modal).
 */

import { ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";

export const AuthErrorCode = {
  Unauthenticated: "UNAUTHENTICATED",
  NotInOrg: "NOT_IN_ORG",
  InsufficientOrgRole: "INSUFFICIENT_ORG_ROLE",
  NotInWorkspace: "NOT_IN_WORKSPACE",
  InsufficientWorkspaceRole: "INSUFFICIENT_WORKSPACE_ROLE",
} as const;

export type AuthErrorPayload = {
  code: (typeof AuthErrorCode)[keyof typeof AuthErrorCode];
  message: string;
};

function authError(payload: AuthErrorPayload): ConvexError<AuthErrorPayload> {
  return new ConvexError(payload);
}

/* ------------------------------------------------------------------ */
/* getAuthedUser — null if not signed in                               */
/* ------------------------------------------------------------------ */

export async function getAuthedUser(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  return await ctx.db.get(userId);
}

/* ------------------------------------------------------------------ */
/* requireUser — throws if not signed in                                */
/* ------------------------------------------------------------------ */

export async function requireUser(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const user = await getAuthedUser(ctx);
  if (user === null) {
    throw authError({
      code: AuthErrorCode.Unauthenticated,
      message: "You need to sign in.",
    });
  }
  return user;
}

/* ------------------------------------------------------------------ */
/* Org role gates                                                       */
/* ------------------------------------------------------------------ */

type OrgRole = "owner" | "admin" | "member";

const ORG_ROLE_ORDER: Record<OrgRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

/** Returns the membership row or throws if user isn't in the org. */
export async function getMembership(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
): Promise<Doc<"members">> {
  const user = await requireUser(ctx);
  const membership = await ctx.db
    .query("members")
    .withIndex("by_org_user", (q) =>
      q.eq("organizationId", organizationId).eq("userId", user._id),
    )
    .unique();
  if (!membership) {
    throw authError({
      code: AuthErrorCode.NotInOrg,
      message: "You are not a member of this organization.",
    });
  }
  return membership;
}

/** Throws unless the user's org role is >= the minimum required role. */
export async function requireOrgRole(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
  minimum: OrgRole,
): Promise<Doc<"members">> {
  const membership = await getMembership(ctx, organizationId);
  if (ORG_ROLE_ORDER[membership.role as OrgRole] < ORG_ROLE_ORDER[minimum]) {
    throw authError({
      code: AuthErrorCode.InsufficientOrgRole,
      message: `This action requires ${minimum} role or higher.`,
    });
  }
  return membership;
}

/* ------------------------------------------------------------------ */
/* Workspace role gates                                                 */
/* ------------------------------------------------------------------ */

type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

const WORKSPACE_ROLE_ORDER: Record<WorkspaceRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

export async function getWorkspaceMembership(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
): Promise<Doc<"workspaceMembers">> {
  const user = await requireUser(ctx);
  const membership = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace_user", (q) =>
      q.eq("workspaceId", workspaceId).eq("userId", user._id),
    )
    .unique();
  if (!membership) {
    throw authError({
      code: AuthErrorCode.NotInWorkspace,
      message: "You do not have access to this workspace.",
    });
  }
  return membership;
}

export async function requireWorkspaceRole(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
  minimum: WorkspaceRole,
): Promise<Doc<"workspaceMembers">> {
  const membership = await getWorkspaceMembership(ctx, workspaceId);
  if (WORKSPACE_ROLE_ORDER[membership.role as WorkspaceRole] < WORKSPACE_ROLE_ORDER[minimum]) {
    throw authError({
      code: AuthErrorCode.InsufficientWorkspaceRole,
      message: `This action requires ${minimum} role or higher in this workspace.`,
    });
  }
  return membership;
}

/* ------------------------------------------------------------------ */
/* Audit helper — writes auditLog from any mutation                    */
/* ------------------------------------------------------------------ */

export async function recordAudit(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    workspaceId?: Id<"workspaces">;
    actorId?: Id<"users">;
    action: Doc<"auditLog">["action"];
    resourceType: string;
    resourceId: string;
    before?: unknown;
    after?: unknown;
    reason?: string;
    payload?: unknown;
  },
): Promise<void> {
  await ctx.db.insert("auditLog", {
    organizationId: args.organizationId,
    workspaceId: args.workspaceId,
    actorId: args.actorId,
    action: args.action,
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    before: args.before,
    after: args.after,
    reason: args.reason,
    payload: args.payload,
    occurredAt: Date.now(),
  });
}
