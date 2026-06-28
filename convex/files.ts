/**
 * Files — uploads land in Convex `_storage`, with metadata in `files`.
 *
 * Upload flow:
 *   1. Client calls `generateUploadUrl` mutation → gets a short-lived
 *      POST URL.
 *   2. Client POSTs the file to that URL (multipart/form-data).
 *   3. Convex returns a `storageId`.
 *   4. Client calls `register` mutation with metadata + storageId.
 */

import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import { recordAudit } from "./lib/authHelpers";
import { recordTimelineEvent } from "./lib/timeline";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireWorkspaceContext(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const register = mutation({
  args: {
    storageId: v.id("_storage"),
    filename: v.string(),
    contentType: v.string(),
    sizeBytes: v.number(),
    relatedToType: v.optional(v.string()),
    relatedToId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx);
    if (args.sizeBytes <= 0 || args.sizeBytes > 50 * 1024 * 1024) {
      throw new ConvexError({
        code: "INVALID_SIZE",
        message: "File must be 1B – 50MB.",
      });
    }

    const fileId = await ctx.db.insert("files", {
      workspaceId: wsCtx.workspace._id,
      filename: args.filename.trim(),
      contentType: args.contentType,
      sizeBytes: args.sizeBytes,
      storageId: args.storageId,
      relatedToType: args.relatedToType,
      relatedToId: args.relatedToId,
      uploadedBy: wsCtx.user._id,
    });

    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "created",
      resourceType: "file",
      resourceId: fileId,
      after: { filename: args.filename, sizeBytes: args.sizeBytes },
    });

    if (args.relatedToType && args.relatedToId) {
      await recordTimelineEvent(ctx, {
        workspaceId: wsCtx.workspace._id,
        eventType: "file_uploaded",
        actorId: wsCtx.user._id,
        subjectType: args.relatedToType,
        subjectId: args.relatedToId,
        payload: { fileId, filename: args.filename },
      });
    }

    return fileId;
  },
});

export const listByRelated = query({
  args: {
    relatedToType: v.string(),
    relatedToId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const files = await ctx.db
      .query("files")
      .withIndex("by_related", (q) =>
        q.eq("relatedToType", args.relatedToType).eq("relatedToId", args.relatedToId),
      )
      .order("desc")
      .take(100);
    return files.filter((f) => f.archivedAt === undefined);
  },
});

export const getUrl = query({
  args: { id: v.id("files") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const file = await ctx.db.get(id);
    if (!file || file.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "File not found." });
    }
    return await ctx.storage.getUrl(file.storageId);
  },
});

export const archive = mutation({
  args: { id: v.id("files") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx);
    const file = await ctx.db.get(id);
    if (!file || file.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "File not found." });
    }
    await ctx.db.patch(id, { archivedAt: Date.now() });
    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "archived",
      resourceType: "file",
      resourceId: id,
    });
  },
});
