/**
 * Long-term workspace memory.
 *
 * Facts the assistant writes to itself so future AI calls stop
 * relearning the same context each time.
 *
 * Two write paths:
 *  1. Manual — user or Copilot tool writes a fact via `remember`
 *  2. Auto — post-reply extractor pulls short atomic facts from
 *     inbound + outbound emails (see convex/aiWorkflows.ts)
 *
 * One read path:
 *  - `retrieve(workspaceId, subjectType, subjectId?, limit?)` returns
 *    the top-N most recently verified facts. Any AI feature calls
 *    this before building a prompt.
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireUser } from "./lib/authHelpers";
import type { Id } from "./_generated/dataModel";

export type MemorySubjectType = "contact" | "company" | "deal" | "workspace";

export interface MemoryFact {
  _id: Id<"workspaceKnowledge">;
  _creationTime: number;
  fact: string;
  subjectType: MemorySubjectType;
  subjectId?: string;
  confidence: number;
  source: string;
  lastVerifiedAt: number;
}

/* ============================================================ */
/* Internal — used by AI feature retrofits                       */
/* ============================================================ */

export const retrieveInternal = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    subjectType: v.union(
      v.literal("contact"),
      v.literal("company"),
      v.literal("deal"),
      v.literal("workspace"),
    ),
    subjectId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<MemoryFact[]> => {
    const limit = args.limit ?? 5;
    const rows = await ctx.db
      .query("workspaceKnowledge")
      .withIndex("by_workspace_subject", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("subjectType", args.subjectType)
          .eq("subjectId", args.subjectId),
      )
      .order("desc")
      .take(limit * 3);
    return rows
      .filter((r) => !r.archivedAt)
      .sort((a, b) => b.lastVerifiedAt - a.lastVerifiedAt)
      .slice(0, limit)
      .map((r) => ({
        _id: r._id,
        _creationTime: r._creationTime,
        fact: r.fact,
        subjectType: r.subjectType as MemorySubjectType,
        subjectId: r.subjectId,
        confidence: r.confidence,
        source: r.source,
        lastVerifiedAt: r.lastVerifiedAt,
      }));
  },
});

export const rememberInternal = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    subjectType: v.union(
      v.literal("contact"),
      v.literal("company"),
      v.literal("deal"),
      v.literal("workspace"),
    ),
    subjectId: v.optional(v.string()),
    fact: v.string(),
    source: v.union(
      v.literal("message_extraction"),
      v.literal("meeting_note"),
      v.literal("manual"),
      v.literal("prospector_enrichment"),
    ),
    sourceMessageId: v.optional(v.id("messages")),
    confidence: v.number(),
  },
  handler: async (ctx, args) => {
    // Dedupe — if an identical fact for the same subject already
    // exists, just bump lastVerifiedAt.
    const existing = await ctx.db
      .query("workspaceKnowledge")
      .withIndex("by_workspace_subject", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("subjectType", args.subjectType)
          .eq("subjectId", args.subjectId),
      )
      .collect();
    const match = existing.find(
      (r) =>
        !r.archivedAt &&
        r.fact.trim().toLowerCase() === args.fact.trim().toLowerCase(),
    );
    if (match) {
      await ctx.db.patch(match._id, { lastVerifiedAt: Date.now() });
      return match._id;
    }
    return await ctx.db.insert("workspaceKnowledge", {
      workspaceId: args.workspaceId,
      subjectType: args.subjectType,
      subjectId: args.subjectId,
      fact: args.fact.slice(0, 500),
      source: args.source,
      sourceMessageId: args.sourceMessageId,
      confidence: Math.max(0, Math.min(100, args.confidence)),
      lastVerifiedAt: Date.now(),
    });
  },
});

/* ============================================================ */
/* Public — user-facing memory management                         */
/* ============================================================ */

export const remember = mutation({
  args: {
    subjectType: v.union(
      v.literal("contact"),
      v.literal("company"),
      v.literal("deal"),
      v.literal("workspace"),
    ),
    subjectId: v.optional(v.string()),
    fact: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!profile?.lastActiveWorkspaceId) {
      throw new Error("No active workspace");
    }
    return await ctx.db.insert("workspaceKnowledge", {
      workspaceId: profile.lastActiveWorkspaceId,
      subjectType: args.subjectType,
      subjectId: args.subjectId,
      fact: args.fact.slice(0, 500),
      source: "manual",
      confidence: 100,
      lastVerifiedAt: Date.now(),
    });
  },
});

export const list = query({
  args: {
    subjectType: v.optional(
      v.union(
        v.literal("contact"),
        v.literal("company"),
        v.literal("deal"),
        v.literal("workspace"),
      ),
    ),
    subjectId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<MemoryFact[]> => {
    const user = await requireUser(ctx);
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!profile?.lastActiveWorkspaceId) return [];

    const limit = args.limit ?? 30;
    let rows;
    if (args.subjectType) {
      rows = await ctx.db
        .query("workspaceKnowledge")
        .withIndex("by_workspace_subject", (q) =>
          q
            .eq("workspaceId", profile.lastActiveWorkspaceId!)
            .eq("subjectType", args.subjectType!)
            .eq("subjectId", args.subjectId),
        )
        .order("desc")
        .take(limit);
    } else {
      rows = await ctx.db
        .query("workspaceKnowledge")
        .withIndex("by_workspace_time", (q) =>
          q.eq("workspaceId", profile.lastActiveWorkspaceId!),
        )
        .order("desc")
        .take(limit);
    }
    return rows
      .filter((r) => !r.archivedAt)
      .map((r) => ({
        _id: r._id,
        _creationTime: r._creationTime,
        fact: r.fact,
        subjectType: r.subjectType as MemorySubjectType,
        subjectId: r.subjectId,
        confidence: r.confidence,
        source: r.source,
        lastVerifiedAt: r.lastVerifiedAt,
      }));
  },
});

export const forget = mutation({
  args: { id: v.id("workspaceKnowledge") },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);
    const row = await ctx.db.get(id);
    if (!row) return;
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!profile || profile.lastActiveWorkspaceId !== row.workspaceId) {
      throw new Error("Not authorized");
    }
    await ctx.db.patch(id, { archivedAt: Date.now() });
  },
});

/**
 * Format memories as a compact block to prepend to AI system prompts.
 * Used by every retrofit that wants long-term memory.
 */
export function formatMemoriesBlock(memories: MemoryFact[]): string {
  if (memories.length === 0) return "";
  const lines: string[] = ["# What you already know"];
  for (const m of memories) {
    lines.push(`- ${m.fact}`);
  }
  return lines.join("\n");
}
