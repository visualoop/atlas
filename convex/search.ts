/**
 * Universal search — hits the searchIndex on each resource table in
 * parallel and merges results. Used by the ⌘K palette.
 *
 * Phase 1: FTS only (companies.name, contacts.firstName, notes.bodyText,
 * tasks.title). Phase 4 adds vector hybrid via Cohere reranker.
 */

import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireWorkspaceContext } from "./lib/workspaceContext";
import type { Doc } from "./_generated/dataModel";

export type SearchHit =
  | { type: "company"; doc: Doc<"companies">; score: number }
  | { type: "contact"; doc: Doc<"contacts">; score: number }
  | { type: "note"; doc: Doc<"notes">; score: number }
  | { type: "task"; doc: Doc<"tasks">; score: number };

export const universal = query({
  args: {
    q: v.string(),
    limitPerType: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const wsCtx = await requireWorkspaceContext(ctx, { minimumRole: "viewer" });
    const wsId = wsCtx.workspace._id;
    const q = args.q.trim();
    if (!q) return [] as SearchHit[];
    const per = Math.min(args.limitPerType ?? 5, 20);

    const [companies, contacts, notes, tasks] = await Promise.all([
      ctx.db
        .query("companies")
        .withSearchIndex("search_name", (b) =>
          b.search("name", q).eq("workspaceId", wsId),
        )
        .take(per),
      ctx.db
        .query("contacts")
        .withSearchIndex("search_name", (b) =>
          b.search("firstName", q).eq("workspaceId", wsId),
        )
        .take(per),
      ctx.db
        .query("notes")
        .withSearchIndex("search_body", (b) =>
          b.search("bodyText", q).eq("workspaceId", wsId),
        )
        .take(per),
      ctx.db
        .query("tasks")
        .withSearchIndex("search_title", (b) =>
          b.search("title", q).eq("workspaceId", wsId),
        )
        .take(per),
    ]);

    const hits: SearchHit[] = [
      ...companies
        .filter((d) => d.archivedAt === undefined)
        .map((doc, i) => ({ type: "company" as const, doc, score: per - i })),
      ...contacts
        .filter((d) => d.archivedAt === undefined)
        .map((doc, i) => ({ type: "contact" as const, doc, score: per - i })),
      ...notes
        .filter((d) => d.archivedAt === undefined)
        .map((doc, i) => ({ type: "note" as const, doc, score: per - i })),
      ...tasks
        .filter((d) => d.archivedAt === undefined)
        .map((doc, i) => ({ type: "task" as const, doc, score: per - i })),
    ];

    return hits;
  },
});
