/**
 * Helpers for documentsActions.ts (DocuSeal integration).
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { getOrgKey } from "./lib/secretsAccess";
import type { Id } from "./_generated/dataModel";

const DEFAULT_DOCUSEAL_URL = "https://api.docuseal.com";

async function ownerOfOrg(ctx: QueryCtx, orgId: Id<"organizations">) {
  const members = await ctx.db
    .query("members")
    .withIndex("by_org", (q) => q.eq("organizationId", orgId))
    .collect();
  return members.find((m) => m.role === "owner") ?? members[0] ?? null;
}

export const prepareSignatureRequest = internalQuery({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args): Promise<{
    workspaceId: Id<"workspaces">;
    apiKey: string | null;
    apiUrl: string;
    documentPdfBase64: string | null;
    documentTitle: string;
  }> => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) throw new Error("Document not found.");

    const ws = await ctx.db.get(doc.workspaceId);
    if (!ws) throw new Error("Workspace not found.");

    let apiKey: string | null = null;
    const owner = await ownerOfOrg(ctx, ws.organizationId);
    if (owner) {
      try {
        const k = await getOrgKey(ctx, {
          organizationId: ws.organizationId,
          provider: "docuseal",
          reason: "signature_request",
          actorId: owner.userId,
        });
        apiKey = k.value;
      } catch {}
    }

    let documentPdfBase64: string | null = null;
    if (doc.pdfStorageId) {
      const url = await ctx.storage.getUrl(doc.pdfStorageId);
      if (url) {
        // For MVP, we'll pass the URL; DocuSeal supports URL fetch too
        // Actually DocuSeal expects base64 — we'd fetch it in the action.
        // Simpler: return the storageId and let the action fetch it.
        documentPdfBase64 = url; // hack: store URL here, action handles both
      }
    }

    return {
      workspaceId: doc.workspaceId,
      apiKey,
      apiUrl: DEFAULT_DOCUSEAL_URL, // TODO: per-org override for self-hosted
      documentPdfBase64,
      documentTitle: doc.title,
    };
  },
});

export const recordSubmission = internalMutation({
  args: {
    documentId: v.id("documents"),
    submissionId: v.string(),
    signerEmail: v.string(),
    signerName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"documentSignatures">> => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) throw new Error("Document not found.");
    return await ctx.db.insert("documentSignatures", {
      workspaceId: doc.workspaceId,
      documentId: args.documentId,
      provider: "docuseal",
      externalId: args.submissionId,
      signerEmail: args.signerEmail,
      signerName: args.signerName,
      status: "sent",
    });
  },
});

export const listPendingSignatures = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<{
    _id: Id<"documentSignatures">;
    submissionId: string;
    workspaceId: Id<"workspaces">;
    apiKey: string | null;
    apiUrl: string;
    documentId: Id<"documents">;
  }>> => {
    const pending = await ctx.db
      .query("documentSignatures")
      .filter((q) =>
        q.and(
          q.eq(q.field("provider"), "docuseal"),
          q.neq(q.field("status"), "signed"),
          q.neq(q.field("status"), "declined"),
          q.neq(q.field("status"), "expired"),
        ),
      )
      .take(50);

    const out = await Promise.all(
      pending.map(async (p) => {
        if (!p.externalId) return null;
        const ws = await ctx.db.get(p.workspaceId);
        if (!ws) return null;
        let apiKey: string | null = null;
        const owner = await ownerOfOrg(ctx, ws.organizationId);
        if (owner) {
          try {
            const k = await getOrgKey(ctx, {
              organizationId: ws.organizationId,
              provider: "docuseal",
              reason: "poll_signature",
              actorId: owner.userId,
            });
            apiKey = k.value;
          } catch {}
        }
        return {
          _id: p._id,
          submissionId: p.externalId,
          workspaceId: p.workspaceId,
          apiKey,
          apiUrl: DEFAULT_DOCUSEAL_URL,
          documentId: p.documentId,
        };
      }),
    );

    return out.filter((x): x is NonNullable<typeof x> => x !== null);
  },
});

export const markSigned = internalMutation({
  args: {
    signatureId: v.id("documentSignatures"),
    signedPdfStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.signatureId, {
      status: "signed",
      signedAt: Date.now(),
      signedPdfStorageId: args.signedPdfStorageId,
    });
    // Also mark document as accepted (signed sub-status lives on documentSignatures)
    const sig = await ctx.db.get(args.signatureId);
    if (sig) {
      await ctx.db.patch(sig.documentId, { status: "accepted" });
    }
  },
});

export const updateSignatureStatus = internalMutation({
  args: {
    signatureId: v.id("documentSignatures"),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    // Only permit known statuses
    const allowed = ["pending", "sent", "viewed", "signed", "declined", "expired"];
    if (!allowed.includes(args.status)) return;
    await ctx.db.patch(args.signatureId, {
      status: args.status as "pending" | "sent" | "viewed" | "signed" | "declined" | "expired",
    });
  },
});
