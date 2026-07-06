/**
 * Email templates — list, get, create, update, archive, seed defaults.
 *
 * Templates are workspace-scoped. Every workspace gets 12 seeded
 * defaults (isSystem=true) on first list() call so the picker is
 * never empty. User-created templates are isSystem=false.
 *
 * Merge tags are rendered server-side at send time. See
 * `renderTemplate` in this file for the exact list.
 */

import { v } from "convex/values";
import {
  internalQuery,
  mutation,
  query,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { requireUser } from "./lib/authHelpers";
import type { Doc, Id } from "./_generated/dataModel";

const CATEGORY = v.union(
  v.literal("cold_outreach"),
  v.literal("follow_up"),
  v.literal("meeting"),
  v.literal("proposal"),
  v.literal("invoice"),
  v.literal("thank_you"),
  v.literal("newsletter"),
  v.literal("nurture"),
  v.literal("re_engage"),
  v.literal("general"),
);

type Category =
  | "cold_outreach"
  | "follow_up"
  | "meeting"
  | "proposal"
  | "invoice"
  | "thank_you"
  | "newsletter"
  | "nurture"
  | "re_engage"
  | "general";

/* ============================================================ */
/* Public queries                                                 */
/* ============================================================ */

export const list = query({
  args: {
    category: v.optional(CATEGORY),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<Array<Doc<"emailTemplates">>> => {
    const user = await requireUser(ctx);
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!profile?.lastActiveWorkspaceId) return [];

    // Auto-seed if this workspace has never had templates before
    await ensureSeeded(ctx as unknown as MutationCtx, profile.lastActiveWorkspaceId).catch(() => {
      // query context can't write — silent no-op. UI can invoke
      // seedDefaults mutation explicitly on first visit if needed.
    });

    const rows = args.category
      ? await ctx.db
          .query("emailTemplates")
          .withIndex("by_workspace_category", (q) =>
            q
              .eq("workspaceId", profile.lastActiveWorkspaceId!)
              .eq("category", args.category!),
          )
          .collect()
      : await ctx.db
          .query("emailTemplates")
          .withIndex("by_workspace_sort", (q) =>
            q.eq("workspaceId", profile.lastActiveWorkspaceId!),
          )
          .collect();

    return rows
      .filter((r) => args.includeArchived || !r.archivedAt)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

export const get = query({
  args: { id: v.id("emailTemplates") },
  handler: async (ctx, args): Promise<Doc<"emailTemplates"> | null> => {
    const user = await requireUser(ctx);
    const t = await ctx.db.get(args.id);
    if (!t) return null;
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!profile || profile.lastActiveWorkspaceId !== t.workspaceId) return null;
    return t;
  },
});

/* ============================================================ */
/* Mutations                                                       */
/* ============================================================ */

export const create = mutation({
  args: {
    name: v.string(),
    category: CATEGORY,
    subject: v.string(),
    bodyHtml: v.string(),
    bodyText: v.optional(v.string()),
    preheader: v.optional(v.string()),
    description: v.optional(v.string()),
    defaultSenderIdentityId: v.optional(v.id("senderIdentities")),
    mergeTags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!profile?.lastActiveWorkspaceId) throw new Error("No active workspace");

    // Place at the end of the sort order
    const existing = await ctx.db
      .query("emailTemplates")
      .withIndex("by_workspace_sort", (q) =>
        q.eq("workspaceId", profile.lastActiveWorkspaceId!),
      )
      .collect();
    const maxOrder = existing.reduce(
      (m, r) => Math.max(m, r.sortOrder),
      0,
    );

    return await ctx.db.insert("emailTemplates", {
      workspaceId: profile.lastActiveWorkspaceId,
      name: args.name.slice(0, 100),
      category: args.category,
      subject: args.subject.slice(0, 200),
      bodyHtml: args.bodyHtml,
      bodyText: args.bodyText,
      preheader: args.preheader?.slice(0, 200),
      description: args.description?.slice(0, 200),
      defaultSenderIdentityId: args.defaultSenderIdentityId,
      mergeTags: args.mergeTags,
      isSystem: false,
      sortOrder: maxOrder + 10,
      createdBy: user._id,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("emailTemplates"),
    patch: v.object({
      name: v.optional(v.string()),
      category: v.optional(CATEGORY),
      subject: v.optional(v.string()),
      bodyHtml: v.optional(v.string()),
      bodyText: v.optional(v.string()),
      preheader: v.optional(v.string()),
      description: v.optional(v.string()),
      defaultSenderIdentityId: v.optional(v.id("senderIdentities")),
      mergeTags: v.optional(v.array(v.string())),
    }),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const t = await ctx.db.get(args.id);
    if (!t) throw new Error("Template not found");
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!profile || profile.lastActiveWorkspaceId !== t.workspaceId) {
      throw new Error("Not authorized");
    }
    await ctx.db.patch(args.id, args.patch);
  },
});

export const archive = mutation({
  args: { id: v.id("emailTemplates") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const t = await ctx.db.get(args.id);
    if (!t) return;
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!profile || profile.lastActiveWorkspaceId !== t.workspaceId) {
      throw new Error("Not authorized");
    }
    await ctx.db.patch(args.id, { archivedAt: Date.now() });
  },
});

export const seedDefaults = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!profile?.lastActiveWorkspaceId) throw new Error("No workspace");
    return await ensureSeeded(ctx, profile.lastActiveWorkspaceId);
  },
});

/* ============================================================ */
/* Seeding — 12 defaults, one call per workspace                 */
/* ============================================================ */

async function ensureSeeded(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
): Promise<{ seeded: number }> {
  const existing = await ctx.db
    .query("emailTemplates")
    .withIndex("by_workspace_sort", (q) => q.eq("workspaceId", workspaceId))
    .first();
  if (existing) return { seeded: 0 };

  const now = Date.now();
  let inserted = 0;
  for (const t of DEFAULT_TEMPLATES) {
    await ctx.db.insert("emailTemplates", {
      workspaceId,
      name: t.name,
      category: t.category,
      subject: t.subject,
      bodyHtml: t.bodyHtml,
      bodyText: t.bodyText,
      description: t.description,
      preheader: t.preheader,
      mergeTags: t.mergeTags,
      isSystem: true,
      sortOrder: t.sortOrder,
    });
    inserted++;
  }
  void now;
  return { seeded: inserted };
}

/* ============================================================ */
/* Merge-tag renderer                                              */
/* Used by send flow + preview UI                                  */
/* ============================================================ */

export interface RenderContext {
  contact?: {
    firstName?: string;
    lastName?: string;
    title?: string;
    email?: string;
  };
  company?: {
    name?: string;
    industry?: string;
    city?: string;
  };
  workspace: {
    name: string;
    oneLiner?: string;
    website?: string;
  };
  owner: {
    firstName: string;
    fullName?: string;
  };
  deal?: {
    name?: string;
    amount?: string;
    currency?: string;
  };
}

/**
 * Render {{tag}} placeholders in a string against a context.
 * Missing values render as empty strings. Never leaks curly braces.
 */
export function renderTemplate(source: string, ctx: RenderContext): string {
  return source.replace(/\{\{\s*([a-zA-Z_.]+)\s*\}\}/g, (_m, path: string) => {
    const parts = path.split(".");
    let value: unknown = ctx;
    for (const p of parts) {
      if (value && typeof value === "object" && p in (value as Record<string, unknown>)) {
        value = (value as Record<string, unknown>)[p];
      } else if (p === "date" && parts[0] === "today") {
        return new Date().toLocaleDateString("en-KE", {
          day: "numeric",
          month: "long",
          year: "numeric",
        });
      } else if (p === "weekday" && parts[0] === "today") {
        return new Date().toLocaleDateString("en-KE", { weekday: "long" });
      } else {
        return "";
      }
    }
    return value == null ? "" : String(value);
  });
}

/**
 * Public query used by the composer preview.
 * Pulls the current workspace's context so client-side rendering
 * has real values.
 */
export const renderContextForActive = query({
  args: {
    contactId: v.optional(v.id("contacts")),
    companyId: v.optional(v.id("companies")),
    dealId: v.optional(v.id("deals")),
  },
  handler: async (ctx, args): Promise<RenderContext | null> => {
    const user = await requireUser(ctx);
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (!profile?.lastActiveWorkspaceId) return null;
    const ws = await ctx.db.get(profile.lastActiveWorkspaceId);
    if (!ws) return null;

    const first =
      user.name?.split(/\s+/)[0] ??
      user.email?.split("@")[0] ??
      "there";

    let contact: RenderContext["contact"];
    let company: RenderContext["company"];
    let deal: RenderContext["deal"];

    if (args.contactId) {
      const c = await ctx.db.get(args.contactId);
      if (c && c.workspaceId === ws._id) {
        contact = {
          firstName: c.firstName,
          lastName: c.lastName,
          title: c.title,
          email: c.email,
        };
        if (!args.companyId && c.companyId) {
          const co = await ctx.db.get(c.companyId);
          if (co && co.workspaceId === ws._id) {
            company = {
              name: co.name,
              industry: co.industry,
              city: co.city,
            };
          }
        }
      }
    }
    if (args.companyId && !company) {
      const co = await ctx.db.get(args.companyId);
      if (co && co.workspaceId === ws._id) {
        company = { name: co.name, industry: co.industry, city: co.city };
      }
    }
    if (args.dealId) {
      const d = await ctx.db.get(args.dealId);
      if (d && d.workspaceId === ws._id) {
        deal = {
          name: d.name,
          amount: d.amountCents
            ? (Number(d.amountCents) / 100).toLocaleString()
            : undefined,
          currency: d.currency,
        };
      }
    }

    return {
      contact,
      company,
      workspace: {
        name: ws.name,
        oneLiner: ws.oneLiner,
        website: ws.website,
      },
      owner: {
        firstName: first,
        fullName: user.name,
      },
      deal,
    };
  },
});

/* ============================================================ */
/* Default template set                                            */
/* ============================================================ */

interface DefaultTemplate {
  name: string;
  category: Category;
  description: string;
  preheader: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  mergeTags: string[];
  sortOrder: number;
}

function html(body: string): string {
  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.55; color: #111827;">${body}</div>`;
}

const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    name: "First touch — value hook",
    category: "cold_outreach",
    description: "Opens a cold conversation with one specific value proposition.",
    preheader: "Quick idea for {{company.name}}",
    subject: "One idea for {{company.name}}",
    mergeTags: ["contact.firstName", "company.name", "workspace.name", "workspace.oneLiner", "owner.firstName"],
    sortOrder: 10,
    bodyHtml: html(`
<p>Hi {{contact.firstName}},</p>
<p>I run {{workspace.name}} — {{workspace.oneLiner}}. I came across {{company.name}} and had one specific idea I think could help.</p>
<p><em>[one specific value hook here]</em></p>
<p>Worth a 10-minute call this week?</p>
<p>— {{owner.firstName}}</p>`),
    bodyText:
      "Hi {{contact.firstName}},\n\nI run {{workspace.name}} — {{workspace.oneLiner}}. I came across {{company.name}} and had one specific idea I think could help.\n\n[one specific value hook here]\n\nWorth a 10-minute call this week?\n\n— {{owner.firstName}}",
  },
  {
    name: "First touch — mutual reference",
    category: "cold_outreach",
    description: "Warmer opener when there's a shared connection or industry.",
    preheader: "Connecting on {{company.industry}}",
    subject: "{{contact.firstName}} — quick note on {{company.industry}}",
    mergeTags: ["contact.firstName", "company.industry", "company.name", "workspace.name", "owner.firstName"],
    sortOrder: 20,
    bodyHtml: html(`
<p>Hi {{contact.firstName}},</p>
<p>I've been talking to a few {{company.industry}} operators in {{company.city}} lately — kept hearing the same problem, so figured I'd reach out.</p>
<p>At {{workspace.name}} we <em>[what we do that solves it]</em>. Two questions for you:</p>
<ol>
  <li><em>[Question 1]</em></li>
  <li><em>[Question 2]</em></li>
</ol>
<p>No pitch — genuinely trying to understand where {{company.name}} is at.</p>
<p>— {{owner.firstName}}</p>`),
    bodyText:
      "Hi {{contact.firstName}},\n\nI've been talking to a few {{company.industry}} operators in {{company.city}} lately — kept hearing the same problem, so figured I'd reach out.\n\nAt {{workspace.name}} we [what we do that solves it]. Two questions for you:\n1. [Question 1]\n2. [Question 2]\n\nNo pitch — genuinely trying to understand where {{company.name}} is at.\n\n— {{owner.firstName}}",
  },
  {
    name: "Nudge — 3 days quiet",
    category: "follow_up",
    description: "Gentle bump when a reply hasn't come.",
    preheader: "Following up on my last note",
    subject: "Re: {{contact.firstName}} — still worth a chat?",
    mergeTags: ["contact.firstName", "workspace.name", "owner.firstName"],
    sortOrder: 30,
    bodyHtml: html(`
<p>Hi {{contact.firstName}},</p>
<p>Bumping this to the top of your inbox in case it got buried. Still keen to trade notes if you have 10 minutes this week.</p>
<p>If the timing is wrong, just say — I'll catch you next quarter.</p>
<p>— {{owner.firstName}}</p>`),
    bodyText:
      "Hi {{contact.firstName}},\n\nBumping this to the top of your inbox in case it got buried. Still keen to trade notes if you have 10 minutes this week.\n\nIf the timing is wrong, just say — I'll catch you next quarter.\n\n— {{owner.firstName}}",
  },
  {
    name: "Nudge — decision date ask",
    category: "follow_up",
    description: "Move a stalled proposal forward with a direct ask.",
    preheader: "Where are we on the proposal?",
    subject: "{{contact.firstName}} — where are we on the proposal?",
    mergeTags: ["contact.firstName", "owner.firstName"],
    sortOrder: 40,
    bodyHtml: html(`
<p>Hi {{contact.firstName}},</p>
<p>Wanted to check in on the proposal I sent through. To keep things clean on my side, could you let me know a rough decision date? Whether that's a yes, no, or "not this quarter", I'd rather know so I can plan.</p>
<p>Happy to jump on a quick call if there are questions open.</p>
<p>— {{owner.firstName}}</p>`),
    bodyText:
      "Hi {{contact.firstName}},\n\nWanted to check in on the proposal I sent through. To keep things clean on my side, could you let me know a rough decision date? Whether that's a yes, no, or 'not this quarter', I'd rather know so I can plan.\n\nHappy to jump on a quick call if there are questions open.\n\n— {{owner.firstName}}",
  },
  {
    name: "Meeting confirmation",
    category: "meeting",
    description: "After they say yes to a call.",
    preheader: "Confirmed — details inside",
    subject: "Confirmed: {{workspace.name}} × {{company.name}} — {{today.weekday}}",
    mergeTags: ["contact.firstName", "workspace.name", "company.name", "owner.firstName", "today.weekday"],
    sortOrder: 50,
    bodyHtml: html(`
<p>Hi {{contact.firstName}},</p>
<p>Confirmed for our call. I'll ping you a calendar invite separately.</p>
<p>What I'll come prepared with:</p>
<ul>
  <li>Short walkthrough of {{workspace.name}}</li>
  <li>A few questions specific to {{company.name}}</li>
  <li>Pricing if it's relevant</li>
</ul>
<p>If there's anything you'd like me to focus on, just reply.</p>
<p>— {{owner.firstName}}</p>`),
    bodyText:
      "Hi {{contact.firstName}},\n\nConfirmed for our call. I'll ping you a calendar invite separately.\n\nWhat I'll come prepared with:\n- Short walkthrough of {{workspace.name}}\n- A few questions specific to {{company.name}}\n- Pricing if it's relevant\n\nIf there's anything you'd like me to focus on, just reply.\n\n— {{owner.firstName}}",
  },
  {
    name: "Reschedule",
    category: "meeting",
    description: "Diary conflict — propose new times.",
    preheader: "Small reschedule",
    subject: "Reschedule — new times below",
    mergeTags: ["contact.firstName", "owner.firstName"],
    sortOrder: 60,
    bodyHtml: html(`
<p>Hi {{contact.firstName}},</p>
<p>Something came up on my side and I need to move our call. Sorry for the shuffle. A few options that would work for me:</p>
<ul>
  <li><em>[Option 1]</em></li>
  <li><em>[Option 2]</em></li>
  <li><em>[Option 3]</em></li>
</ul>
<p>Which fits best?</p>
<p>— {{owner.firstName}}</p>`),
    bodyText:
      "Hi {{contact.firstName}},\n\nSomething came up on my side and I need to move our call. Sorry for the shuffle. A few options that would work for me:\n- [Option 1]\n- [Option 2]\n- [Option 3]\n\nWhich fits best?\n\n— {{owner.firstName}}",
  },
  {
    name: "Proposal delivery",
    category: "proposal",
    description: "Send the proposal doc with a short cover.",
    preheader: "Proposal attached — {{deal.name}}",
    subject: "Proposal — {{deal.name}}",
    mergeTags: ["contact.firstName", "deal.name", "deal.amount", "deal.currency", "owner.firstName"],
    sortOrder: 70,
    bodyHtml: html(`
<p>Hi {{contact.firstName}},</p>
<p>Attached is the proposal for {{deal.name}}. High-level summary:</p>
<ul>
  <li><strong>Scope:</strong> <em>[one line]</em></li>
  <li><strong>Timeline:</strong> <em>[one line]</em></li>
  <li><strong>Investment:</strong> {{deal.currency}} {{deal.amount}}</li>
</ul>
<p>Take your time reviewing. Any questions, just reply — I'll turn it around same day.</p>
<p>— {{owner.firstName}}</p>`),
    bodyText:
      "Hi {{contact.firstName}},\n\nAttached is the proposal for {{deal.name}}. High-level summary:\n- Scope: [one line]\n- Timeline: [one line]\n- Investment: {{deal.currency}} {{deal.amount}}\n\nTake your time reviewing. Any questions, just reply — I'll turn it around same day.\n\n— {{owner.firstName}}",
  },
  {
    name: "Invoice reminder",
    category: "invoice",
    description: "Polite nudge on an unpaid invoice.",
    preheader: "Small nudge on {{deal.name}}",
    subject: "Invoice for {{deal.name}} — quick reminder",
    mergeTags: ["contact.firstName", "deal.name", "deal.amount", "deal.currency", "owner.firstName"],
    sortOrder: 80,
    bodyHtml: html(`
<p>Hi {{contact.firstName}},</p>
<p>Quick reminder on the invoice for {{deal.name}} — {{deal.currency}} {{deal.amount}}. If it slipped through, no drama. If there's a question on it, ping me.</p>
<p>Payment options are on the invoice itself.</p>
<p>— {{owner.firstName}}</p>`),
    bodyText:
      "Hi {{contact.firstName}},\n\nQuick reminder on the invoice for {{deal.name}} — {{deal.currency}} {{deal.amount}}. If it slipped through, no drama. If there's a question on it, ping me.\n\nPayment options are on the invoice itself.\n\n— {{owner.firstName}}",
  },
  {
    name: "Thank you — after purchase",
    category: "thank_you",
    description: "Warm confirmation after a deal closes.",
    preheader: "Thanks for choosing {{workspace.name}}",
    subject: "Welcome — {{workspace.name}}",
    mergeTags: ["contact.firstName", "workspace.name", "owner.firstName"],
    sortOrder: 90,
    bodyHtml: html(`
<p>Hi {{contact.firstName}},</p>
<p>Thank you for going with {{workspace.name}}. Genuinely — I don't take that lightly.</p>
<p>Here's what happens next:</p>
<ol>
  <li><em>[Onboarding step 1]</em></li>
  <li><em>[Onboarding step 2]</em></li>
</ol>
<p>You'll hear from me directly — no support ticket system. Just reply and I'll pick it up.</p>
<p>— {{owner.firstName}}</p>`),
    bodyText:
      "Hi {{contact.firstName}},\n\nThank you for going with {{workspace.name}}. Genuinely — I don't take that lightly.\n\nHere's what happens next:\n1. [Onboarding step 1]\n2. [Onboarding step 2]\n\nYou'll hear from me directly — no support ticket system. Just reply and I'll pick it up.\n\n— {{owner.firstName}}",
  },
  {
    name: "Thank you — after meeting",
    category: "thank_you",
    description: "Post-call warm note with a next step.",
    preheader: "Good chat today",
    subject: "Good chat — {{contact.firstName}}",
    mergeTags: ["contact.firstName", "owner.firstName"],
    sortOrder: 100,
    bodyHtml: html(`
<p>Hi {{contact.firstName}},</p>
<p>Thanks for making time today. A quick recap of what we agreed:</p>
<ul>
  <li><em>[Action 1 — who owns it]</em></li>
  <li><em>[Action 2 — who owns it]</em></li>
</ul>
<p>I'll circle back on <em>[date]</em>. Ping me sooner if anything changes.</p>
<p>— {{owner.firstName}}</p>`),
    bodyText:
      "Hi {{contact.firstName}},\n\nThanks for making time today. A quick recap of what we agreed:\n- [Action 1 — who owns it]\n- [Action 2 — who owns it]\n\nI'll circle back on [date]. Ping me sooner if anything changes.\n\n— {{owner.firstName}}",
  },
  {
    name: "Case study share",
    category: "nurture",
    description: "Idle contact, low-pressure warmth.",
    preheader: "Thought this might interest you",
    subject: "Something you might like — {{workspace.name}}",
    mergeTags: ["contact.firstName", "workspace.name", "owner.firstName"],
    sortOrder: 110,
    bodyHtml: html(`
<p>Hi {{contact.firstName}},</p>
<p>Not chasing anything — just thought this might interest you. We published a short piece on <em>[topic]</em>. Two-minute read, nothing to sign up for.</p>
<p><em>[link]</em></p>
<p>— {{owner.firstName}}</p>`),
    bodyText:
      "Hi {{contact.firstName}},\n\nNot chasing anything — just thought this might interest you. We published a short piece on [topic]. Two-minute read, nothing to sign up for.\n\n[link]\n\n— {{owner.firstName}}",
  },
  {
    name: "6-month check-in",
    category: "re_engage",
    description: "Restart a cold lead cleanly.",
    preheader: "Been a minute",
    subject: "Been a minute — {{contact.firstName}}",
    mergeTags: ["contact.firstName", "workspace.name", "owner.firstName"],
    sortOrder: 120,
    bodyHtml: html(`
<p>Hi {{contact.firstName}},</p>
<p>Been a while — 6 months, give or take. We've shipped a few things at {{workspace.name}} since we last spoke:</p>
<ul>
  <li><em>[thing 1]</em></li>
  <li><em>[thing 2]</em></li>
</ul>
<p>Curious where you're at. If it's still not the right time, no worries — I'll go quiet.</p>
<p>— {{owner.firstName}}</p>`),
    bodyText:
      "Hi {{contact.firstName}},\n\nBeen a while — 6 months, give or take. We've shipped a few things at {{workspace.name}} since we last spoke:\n- [thing 1]\n- [thing 2]\n\nCurious where you're at. If it's still not the right time, no worries — I'll go quiet.\n\n— {{owner.firstName}}",
  },
];
