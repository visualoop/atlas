"use node";

/**
 * DocuSeal e-signature actions.
 *
 * DocuSeal is self-hostable — user provides their API base URL + key
 * via /settings/integrations. We POST document PDFs to their submissions
 * endpoint, poll for signed status, and download the signed PDF back
 * into Convex storage when ready.
 *
 * Cron entry: `pollSignatureStatus` runs every 10 minutes and updates
 * documentSignatures rows.
 */

import { v } from "convex/values";
import { internalAction, action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* ------------------------------------------------------------------ */
/* User-triggered: send a document for signature                       */
/* ------------------------------------------------------------------ */

export const createSignatureRequest = action({
  args: {
    documentId: v.id("documents"),
    signerEmail: v.string(),
    signerName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    submissionId: string;
    signatureRowId: Id<"documentSignatures">;
  }> => {
    const setup: {
      workspaceId: Id<"workspaces">;
      apiKey: string | null;
      apiUrl: string;
      documentPdfBase64: string | null;
      documentTitle: string;
    } = await ctx.runQuery(internal.documentsActionsHelpers.prepareSignatureRequest, {
      documentId: args.documentId,
    });
    if (!setup.apiKey) throw new Error("DocuSeal not configured for this workspace.");
    if (!setup.documentPdfBase64) throw new Error("Document has no rendered PDF yet.");

    const res = await fetch(`${setup.apiUrl}/api/submissions`, {
      method: "POST",
      headers: {
        "X-Auth-Token": setup.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        template_id: null,
        name: setup.documentTitle,
        send_email: true,
        submitters: [
          {
            email: args.signerEmail,
            name: args.signerName ?? args.signerEmail,
            role: "Signer",
          },
        ],
        // For MVP we pass PDF as base64
        documents: [{ name: setup.documentTitle, file: setup.documentPdfBase64 }],
      }),
    });
    if (!res.ok) {
      throw new Error(`DocuSeal ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const json = (await res.json()) as { id: number | string };
    const submissionId = String(json.id);

    const signatureRowId: Id<"documentSignatures"> = await ctx.runMutation(
      internal.documentsActionsHelpers.recordSubmission,
      {
        documentId: args.documentId,
        submissionId,
        signerEmail: args.signerEmail,
        signerName: args.signerName,
      },
    );

    return { submissionId, signatureRowId };
  },
});

/* ------------------------------------------------------------------ */
/* Cron: poll signature status                                         */
/* ------------------------------------------------------------------ */

export const pollSignatureStatus = internalAction({
  args: {},
  handler: async (ctx): Promise<{ polled: number; completed: number }> => {
    const pending: Array<{
      _id: Id<"documentSignatures">;
      submissionId: string;
      workspaceId: Id<"workspaces">;
      apiKey: string | null;
      apiUrl: string;
      documentId: Id<"documents">;
    }> = await ctx.runQuery(internal.documentsActionsHelpers.listPendingSignatures, {});

    let completed = 0;
    for (const p of pending) {
      if (!p.apiKey) continue;
      try {
        const res = await fetch(`${p.apiUrl}/api/submissions/${p.submissionId}`, {
          headers: { "X-Auth-Token": p.apiKey },
        });
        if (!res.ok) continue;
        const json = (await res.json()) as {
          status?: string;
          audit_log_url?: string;
          documents?: Array<{ url?: string }>;
        };
        const status = json.status ?? "pending";
        if (status === "completed" && json.documents?.[0]?.url) {
          // Download signed PDF into Convex storage
          const pdfRes = await fetch(json.documents[0].url);
          if (pdfRes.ok) {
            const blob = await pdfRes.blob();
            const storageId = await ctx.storage.store(blob);
            await ctx.runMutation(internal.documentsActionsHelpers.markSigned, {
              signatureId: p._id,
              signedPdfStorageId: storageId,
            });
            completed++;
          }
        } else {
          await ctx.runMutation(internal.documentsActionsHelpers.updateSignatureStatus, {
            signatureId: p._id,
            status,
          });
        }
      } catch {
        // Skip on error
      }
    }
    return { polled: pending.length, completed };
  },
});
