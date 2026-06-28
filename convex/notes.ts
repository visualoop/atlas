/**
 * Notes — rich text via TipTap (stored as JSON in `body`).
 * `bodyText` is a plain-text extraction for FTS.
 *
 * Phase 1 surface: list (by related), get, create, update, archive.
 * Pin: pinned notes float to the top of the related record's view.
 */

import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import { recordAudit } from "./lib/authHelpers";
import { recordTimelineEvent } from "./lib/timeline";

/** Roughly extract plain text from a TipTap doc for search. */
function extractText(doc: unknown): string {
  if (!doc || typeof doc !== "object") return "";
  const node = doc as { text?: unknown; content?: unknown[] };
  if (typeof node.text === "string") return node.text;
  const parts: string[] = [];
  if (Array.isArray(node.content)) {
    for (const child of node.content) parts.push(extractText(child));
  }
  return parts.join(" ").trim();
}

export const listByRelated = query({
  args: {
    relatedToType: v.string(),
    relatedToId: v.string(),
    includeArchived: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_related", (q) =>
        q.eq("relatedToType", args.relatedToType).eq("relatedToId", args.relatedToId),
      )
      .order("desc")
      .take(Math.min(args.limit ?? 50, 200));
    return args.includeArchived ? notes : notes.filter((n) => n.archivedAt === undefined);
  },
});

export const create = mutation({
  args: {
    title: v.optional(v.string()),
    body: v.any(),
    relatedToType: v.optional(v.string()),
    relatedToId: v.optional(v.string()),
    pinned: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx);
    const bodyText = extractText(args.body);
    if (!bodyText && !args.title) {
      throw new ConvexError({ code: "EMPTY_NOTE", message: "Note can't be empty." });
    }

    const noteId = await ctx.db.insert("notes", {
      workspaceId: wsCtx.workspace._id,
      title: args.title?.trim() || undefined,
      body: args.body,
      bodyText,
      relatedToType: args.relatedToType,
      relatedToId: args.relatedToId,
      authorId: wsCtx.user._id,
      pinned: args.pinned ?? false,
    });

    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "created",
      resourceType: "note",
      resourceId: noteId,
    });

    if (args.relatedToType && args.relatedToId) {
      await recordTimelineEvent(ctx, {
        workspaceId: wsCtx.workspace._id,
        eventType: "note_added",
        actorId: wsCtx.user._id,
        subjectType: args.relatedToType,
        subjectId: args.relatedToId,
        payload: { noteId, title: args.title, preview: bodyText.slice(0, 200) },
      });
    }

    return noteId;
  },
});

export const update = mutation({
  args: {
    id: v.id("notes"),
    patch: v.object({
      title: v.optional(v.string()),
      body: v.optional(v.any()),
      pinned: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx);
    const note = await ctx.db.get(args.id);
    if (!note || note.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Note not found." });
    }
    const patch: Record<string, unknown> = { ...args.patch };
    if (patch.body !== undefined) {
      patch.bodyText = extractText(patch.body);
    }
    await ctx.db.patch(args.id, patch);
    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "updated",
      resourceType: "note",
      resourceId: args.id,
    });
  },
});

export const archive = mutation({
  args: { id: v.id("notes") },
  handler: async (ctx, { id }) => {
    const wsCtx = await requireWorkspaceContext(ctx);
    const note = await ctx.db.get(id);
    if (!note || note.workspaceId !== wsCtx.workspace._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Note not found." });
    }
    await ctx.db.patch(id, { archivedAt: Date.now() });
    await recordAudit(ctx, {
      organizationId: wsCtx.workspace.organizationId,
      workspaceId: wsCtx.workspace._id,
      actorId: wsCtx.user._id,
      action: "archived",
      resourceType: "note",
      resourceId: id,
    });
  },
});
