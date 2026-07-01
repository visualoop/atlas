"use node";

/**
 * Meeting reminder + AI pre-meeting brief cron.
 *
 * Every 5 minutes:
 *   - Find calendarEvents with startAt in [now, now+65min] AND
 *     reminderSentAt undefined AND status='scheduled' AND
 *     archivedAt undefined.
 *   - For each: send a reminder email to owner + any attendees.
 *     If the event has a linked contactId/dealId, also generate
 *     an AI pre-meeting brief using summarize_thread/summarize_contact
 *     and store on event.aiBriefText.
 *   - Mark reminderSentAt = now so we don't spam.
 */

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

export const sendMeetingReminders = internalAction({
  args: {},
  handler: async (ctx): Promise<{ reminded: number; briefed: number }> => {
    const due: Array<{
      _id: Id<"calendarEvents">;
      workspaceId: Id<"workspaces">;
      organizationId: Id<"organizations">;
      ownerEmail: string | null;
      title: string;
      startAt: number;
      conferenceUrl?: string;
      location?: string;
      attendeeEmails?: string[];
      contactId?: Id<"contacts">;
      dealId?: Id<"deals">;
    }> = await ctx.runQuery(internal.calendarActionsHelpers.listUpcomingUnreminded, {});

    let reminded = 0;
    let briefed = 0;
    for (const e of due) {
      // Compose reminder body
      const startsIn = Math.max(0, Math.round((e.startAt - Date.now()) / 60000));
      const html = `<div style="font-family:Georgia,serif;font-size:15px;line-height:1.55">
        <p><strong>Reminder:</strong> ${escapeHtml(e.title)}</p>
        <p>Starts in ${startsIn} minutes.</p>
        ${e.conferenceUrl ? `<p>Join: <a href="${escapeHtml(e.conferenceUrl)}">${escapeHtml(e.conferenceUrl)}</a></p>` : ""}
        ${e.location ? `<p>Where: ${escapeHtml(e.location)}</p>` : ""}
      </div>`;
      const text = `Reminder: ${e.title}\nStarts in ${startsIn} min.\n${e.conferenceUrl ?? e.location ?? ""}`;

      const recipients = [
        ...(e.ownerEmail ? [e.ownerEmail] : []),
        ...(e.attendeeEmails ?? []),
      ].filter((v, i, a) => a.indexOf(v) === i);

      if (recipients.length > 0) {
        await ctx.runAction(internal.emailsOutSystem.sendOrgEmail, {
          workspaceId: e.workspaceId,
          organizationId: e.organizationId,
          to: recipients,
          subject: `Reminder: ${e.title} in ${startsIn} min`,
          html,
          text,
        });
        reminded++;
      }

      // AI brief — best-effort, don't block reminder
      if (e.contactId || e.dealId) {
        try {
          const brief: string | null = await ctx.runAction(
            internal.calendarActions.generateAiBrief,
            { eventId: e._id, contactId: e.contactId, dealId: e.dealId },
          );
          if (brief) briefed++;
        } catch {
          // ignore
        }
      }

      await ctx.runMutation(internal.calendarActionsHelpers.markReminderSent, {
        eventId: e._id,
      });
    }
    return { reminded, briefed };
  },
});

/* ------------------------------------------------------------------ */
/* AI pre-meeting brief                                                */
/* ------------------------------------------------------------------ */

import { v } from "convex/values";

export const generateAiBrief = internalAction({
  args: {
    eventId: v.id("calendarEvents"),
    contactId: v.optional(v.id("contacts")),
    dealId: v.optional(v.id("deals")),
  },
  handler: async (ctx, args): Promise<string | null> => {
    const context: {
      workspaceId: Id<"workspaces">;
      apiKey: string | null;
      contactSummary?: string;
      recentThreads?: string;
      dealNotes?: string;
      brandBlock?: string;
    } | null = await ctx.runQuery(internal.calendarActionsHelpers.gatherBriefContext, args);
    if (!context || !context.apiKey) return null;

    const prompt = `Write a 4-bullet pre-meeting brief for the founder before a scheduled meeting.

${context.brandBlock ? context.brandBlock + "\n\n" : ""}Context:
${context.contactSummary ? `Contact: ${context.contactSummary}\n` : ""}${context.dealNotes ? `Deal: ${context.dealNotes}\n` : ""}${context.recentThreads ? `Recent messages:\n${context.recentThreads}\n` : ""}

Rules:
- Kenyan English. No AI-slop language.
- 4 short bullets max.
- Cover: who they are, what they last asked, what to open with, what to close with.
- If context is thin, say so.`;

    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${context.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: "You are a concise sales assistant. Write in Kenyan English." },
            { role: "user", content: prompt },
          ],
          temperature: 0.4,
          max_tokens: 300,
        }),
      });
      if (!res.ok) return null;
      const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = j.choices?.[0]?.message?.content?.trim();
      if (!text) return null;
      await ctx.runMutation(internal.calendarActionsHelpers.saveBrief, {
        eventId: args.eventId,
        text,
      });
      return text;
    } catch {
      return null;
    }
  },
});

/* ------------------------------------------------------------------ */

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
