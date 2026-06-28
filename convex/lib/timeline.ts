/**
 * Timeline event helper — every mutation that changes a user-visible
 * entity (contact, company, deal, document, payment) should call
 * `recordTimelineEvent` so the spine table stays complete.
 *
 * Distinct from `recordAudit` (which logs all mutations including
 * internal/secret ones) — `timelineEvents` is the user-facing
 * activity feed shown in the contact/company slide-over.
 */

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export interface TimelineEventInput {
  workspaceId: Id<"workspaces">;
  eventType: string;
  actorId?: Id<"users">;
  subjectType: string;
  subjectId: string;
  relatedRefs?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

export async function recordTimelineEvent(
  ctx: MutationCtx,
  input: TimelineEventInput,
): Promise<void> {
  await ctx.db.insert("timelineEvents", {
    workspaceId: input.workspaceId,
    eventType: input.eventType,
    actorId: input.actorId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    relatedRefs: input.relatedRefs,
    payload: input.payload,
    occurredAt: Date.now(),
  });
}
