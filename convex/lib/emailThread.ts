/**
 * Email threading + normalization helpers.
 *
 * Threading resolution order:
 *   1. If `inReplyTo` header exists and points to a known Message-ID
 *      in our DB → thread onto that message's conversation.
 *   2. Otherwise, walk `references` chain and find the first known
 *      Message-ID.
 *   3. Otherwise, hash the normalized subject + participant set and
 *      look for an existing conversation with matching threadingKey.
 *      This catches "manual" replies that lose the References header
 *      (Outlook clients do this occasionally).
 *   4. Otherwise, this is a new conversation.
 */

import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/** Normalize a subject line — strip Re:/Fwd:/Fw: prefixes, collapse whitespace. */
export function normalizeSubject(raw: string | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/^(?:\s*(?:re|fwd?)\s*:)+\s*/i, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Simple stable hash for the threading key fallback. */
export function threadingKeyFrom(
  subject: string | undefined,
  emails: string[],
): string {
  const normSubj = normalizeSubject(subject);
  const parts = [...emails].map((e) => e.trim().toLowerCase()).sort().join(",");
  const combined = `${normSubj}|${parts}`;
  // FNV-1a 32-bit hash — enough for a per-workspace bucket
  let hash = 0x811c9dc5;
  for (let i = 0; i < combined.length; i++) {
    hash ^= combined.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Given inbound email headers, find the matching conversation in this
 * workspace or return null (caller creates a new one).
 */
export async function findConversationForInbound(
  ctx: QueryCtx | MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    inReplyTo?: string;
    references?: string[];
    subject?: string;
    participantEmails: string[];
  },
): Promise<Doc<"conversations"> | null> {
  // 1. inReplyTo → find message with that Message-ID → its conversation
  if (args.inReplyTo) {
    const parent = await ctx.db
      .query("messages")
      .withIndex("by_message_id", (q) => q.eq("messageId", args.inReplyTo))
      .first();
    if (parent && parent.workspaceId === args.workspaceId) {
      return await ctx.db.get(parent.conversationId);
    }
  }

  // 2. References chain
  for (const ref of args.references ?? []) {
    const parent = await ctx.db
      .query("messages")
      .withIndex("by_message_id", (q) => q.eq("messageId", ref))
      .first();
    if (parent && parent.workspaceId === args.workspaceId) {
      return await ctx.db.get(parent.conversationId);
    }
  }

  // 3. Subject + participant hash fallback
  const key = threadingKeyFrom(args.subject, args.participantEmails);
  const existing = await ctx.db
    .query("conversations")
    .withIndex("by_workspace_threading_key", (q) =>
      q.eq("workspaceId", args.workspaceId).eq("threadingKey", key),
    )
    .first();
  return existing ?? null;
}

/** Strip HTML tags for a plain-text preview when only HTML is available. */
export function htmlToPlain(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse `"Name <email@x>"` → { name, email }. */
export function parseAddress(raw: string): { name?: string; email: string } {
  const angle = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(raw);
  if (angle) {
    return { name: angle[1]?.trim() || undefined, email: angle[2].trim().toLowerCase() };
  }
  return { email: raw.trim().toLowerCase() };
}

/** Extract email domain (empty string if invalid). */
export function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return email.slice(at + 1).toLowerCase();
}
