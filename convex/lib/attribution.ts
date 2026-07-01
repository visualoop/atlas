/**
 * Attribution touch logger — one-liner helper for every place a
 * revenue-adjacent event happens (landing signup, email reply,
 * deal created, deal won, meeting booked). Call from within a
 * mutation:
 *
 *   await recordAttribution(ctx, {
 *     workspaceId, contactId, touchType: 'deal_created',
 *     source: 'campaign', campaignId: cId
 *   });
 */

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

type TouchType =
  | "utm_click"
  | "landing_view"
  | "landing_signup"
  | "email_click"
  | "email_reply"
  | "social_click"
  | "first_response"
  | "meeting_booked"
  | "deal_created"
  | "deal_won";

export interface AttributionInput {
  workspaceId: Id<"workspaces">;
  touchType: TouchType;
  contactId?: Id<"contacts">;
  sessionId?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  utmLinkId?: Id<"utmLinks">;
  landingPageId?: Id<"landingPages">;
  campaignId?: Id<"campaigns">;
  broadcastId?: Id<"broadcasts">;
  socialPostId?: Id<"socialPosts">;
}

export async function recordAttribution(
  ctx: MutationCtx,
  input: AttributionInput,
): Promise<void> {
  await ctx.db.insert("attributionTouches", {
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    sessionId: input.sessionId,
    touchType: input.touchType,
    source: input.source,
    medium: input.medium,
    campaign: input.campaign,
    utmLinkId: input.utmLinkId,
    landingPageId: input.landingPageId,
    campaignId: input.campaignId,
    broadcastId: input.broadcastId,
    socialPostId: input.socialPostId,
    occurredAt: Date.now(),
  });
}
