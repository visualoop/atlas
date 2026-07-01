/**
 * Helpers for demoRecordings.ts (Node runtime action).
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";
import { getOrgKey } from "./lib/secretsAccess";
import type { Id } from "./_generated/dataModel";

export const prepare = internalQuery({
  args: { demoRecordingId: v.id("demoRecordings") },
  handler: async (ctx, args) => {
    const rec = await ctx.db.get(args.demoRecordingId);
    if (!rec) return { apiKey: null, storageId: null };
    const ws = await ctx.db.get(rec.workspaceId);
    if (!ws) return { apiKey: null, storageId: null };

    const members = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("organizationId", ws.organizationId))
      .collect();
    const owner = members.find((m) => m.role === "owner") ?? members[0];
    if (!owner) return { apiKey: null, storageId: null };

    let apiKey: string | null = null;
    try {
      const k = await getOrgKey(ctx, {
        organizationId: ws.organizationId,
        provider: "groq",
        reason: "whisper_transcribe",
        actorId: owner.userId,
      });
      apiKey = k.value;
    } catch {}

    let storageId: Id<"_storage"> | null = null;
    if (rec.videoFileId) {
      const f = await ctx.db.get(rec.videoFileId);
      if (f) storageId = f.storageId;
    }

    return { apiKey, storageId };
  },
});

export const saveTranscript = internalMutation({
  args: {
    demoRecordingId: v.id("demoRecordings"),
    transcript: v.string(),
    summary: v.optional(v.string()),
    questions: v.array(v.string()),
    actionItems: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.demoRecordingId, {
      transcriptText: args.transcript,
      transcriptedAt: Date.now(),
      aiSummary: args.summary,
      aiQuestions: args.questions,
      aiActionItems: args.actionItems,
    });
  },
});
