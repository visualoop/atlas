# 18 · Growth Engine

The layer that turns Atlas from an operations spine into a **growth machine**. Four related modules that together handle everything a founder-CEO does between "have a product" and "close a deal": publishing, content, listening for trends, and measuring what works.

## The four modules

| Module | Phase | Purpose |
|---|---|---|
| **Social Publishing** | 8a | Cross-post + schedule to Facebook / Instagram / LinkedIn from one composer |
| **Content & Marketing Hub** | 8b | Newsletter, landing pages, lead magnets, SEO content ideation |
| **Trend & Brand Intelligence** | 8c | Daily digest of brand mentions, competitor moves, trending topics (Groq Compound-powered) |
| **Marketing Analytics** | in 9 | UTM tracking + attribution + funnel + cost-per-lead + content performance |

They share the same data spine (contacts, companies, timeline, workspaces) and reuse the same AI gateway. New tables are additive.

---

## Module 1 — Social Publishing (Phase 8a, ~2 weeks)

### What it does

Compose once → cross-post to Facebook Pages, Instagram Business, and LinkedIn (personal + company) with per-platform tweaks. Schedule ahead. Track engagement. Reply to comments from Atlas Inbox.

### Platforms at launch

| Platform | Native API | Auth | Scheduling | Analytics |
|---|---|---|---|---|
| Facebook Pages | Graph API `/{page-id}/feed` + `scheduled_posts` | OAuth 2.0 | Native (`scheduled_publish_time`) | Page Insights |
| Instagram Business | Graph API two-step (`/media` container → `/media_publish`) | Same as FB (linked account) | Atlas-side cron | Media Insights |
| LinkedIn personal | Posts API, `w_member_social` scope | OAuth 2.0 | Atlas-side cron | Not exposed via API |
| LinkedIn company | Posts API, `w_organization_social` | OAuth 2.0 | Atlas-side cron | Follower Insights |

X (Twitter, $200/mo min), TikTok (approval-gated), YouTube (10K units/day quota) — deferred until launch or via Composio if we need them earlier.

### Data model (additive to schema)

```ts
socialConnections: defineTable({
  workspaceId: v.id("workspaces"),
  platform: v.union(
    v.literal("facebook_page"),
    v.literal("instagram_business"),
    v.literal("linkedin_person"),
    v.literal("linkedin_org"),
  ),
  externalId: v.string(),                 // page/account id
  displayName: v.string(),                // e.g., "Blyss Studio (LinkedIn)"
  encryptedAccessToken: v.string(),       // Tier-1 secret pattern
  encryptedRefreshToken: v.optional(v.string()),
  tokenExpiresAt: v.optional(v.number()),
  scopes: v.array(v.string()),
  connectedBy: v.id("users"),
  status: v.union(v.literal("active"), v.literal("expired"), v.literal("revoked")),
})
  .index("by_workspace", ["workspaceId"])
  .index("by_platform_external", ["platform", "externalId"]),

socialPosts: defineTable({
  workspaceId: v.id("workspaces"),
  authorId: v.id("users"),
  // Composer state — the *canonical* draft. Per-platform overrides go
  // in `platforms[]`.
  body: v.string(),
  mediaIds: v.array(v.id("_storage")),
  platforms: v.array(v.object({
    connectionId: v.id("socialConnections"),
    bodyOverride: v.optional(v.string()),        // per-platform tweak
    firstComment: v.optional(v.string()),        // LinkedIn convention
    status: v.union(
      v.literal("scheduled"),
      v.literal("publishing"),
      v.literal("posted"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    scheduledFor: v.optional(v.number()),
    postedAt: v.optional(v.number()),
    externalPostId: v.optional(v.string()),
    externalUrl: v.optional(v.string()),
    error: v.optional(v.string()),
    metrics: v.optional(v.any()),                // pulled by insights cron
  })),
  campaign: v.optional(v.string()),              // free-form tag for attribution
  archivedAt: v.optional(v.number()),
})
  .index("by_workspace", ["workspaceId"])
  .index("by_author", ["authorId"])
  .index("by_workspace_campaign", ["workspaceId", "campaign"]),

socialComments: defineTable({
  workspaceId: v.id("workspaces"),
  socialPostId: v.optional(v.id("socialPosts")),
  connectionId: v.id("socialConnections"),
  externalId: v.string(),
  externalPostId: v.string(),
  authorName: v.string(),
  authorExternalId: v.string(),
  body: v.string(),
  postedAt: v.number(),
  respondedAt: v.optional(v.number()),
  respondedBy: v.optional(v.id("users")),
  archivedAt: v.optional(v.number()),
})
  .index("by_workspace_post", ["workspaceId", "socialPostId"])
  .index("by_external", ["externalPostId", "externalId"])
```

### AI features

- **`generate_social_post`** — given a topic (or a Won deal, or a trending mention) → drafts a cross-platform post with per-platform variants respecting character limits + tone. Hashtags per platform.
- **`optimize_send_time`** — analyzes prior engagement per platform to suggest best-posting-time. Falls back to platform norms if no history.
- **`generate_image`** — Gemini Flash Image (free) or FLUX schnell on Together (trial) for social visuals.
- **`respond_to_review`** — one-click reply drafting for public reviews / comments.
- **`suggest_content_ideas`** — from workspace context (recent Won deals, current pipeline, trends) → 5–10 post ideas ranked by predicted engagement.

### Publishing pipeline

1. **Composer** — single editor. Left: shared text + media. Right: per-platform preview + tweak.
2. **Schedule** — pick datetime, or "post now". Save as `socialPosts` row with `platforms[].status='scheduled'`.
3. **Cron `publish-social-scheduled`** (`crons.interval` every 1 min) picks up rows with `scheduledFor <= now && status='scheduled'`, calls native API per platform, records external post ID + URL, marks `posted`.
4. **Cron `sync-social-insights`** (`crons.cron` every 6h) pulls metrics for posts <30 days old.
5. **Cron `sync-social-comments`** (`crons.interval` every 15 min) pulls new comments on posts <30 days old; unread ones route to unified Inbox.

### UI

- `/social` — calendar view (default) showing scheduled + posted content across all connected platforms
- `/social/compose` — the composer with per-platform preview
- `/social/library` — media library backed by Convex storage
- `/social/analytics` — engagement dashboard (reach, engagement, top posts)
- `/settings/connections` — connect / disconnect / re-auth social accounts (Tier-1 tokens)
- Inbox unified toggle: `Email · WhatsApp · Comments · All`

---

## Module 2 — Content & Marketing Hub (Phase 8b, ~1.5 weeks)

### What it does

Newsletter (via Resend Broadcasts), landing pages, lead magnets, and AI-powered SEO content ideation.

### Newsletter

Piggybacks on Resend's Broadcasts API + Audiences. Each workspace has one or more Audiences. Contacts can be auto-subscribed based on tag/lifecycle. Broadcast composer uses TipTap + React Email templates.

- **Composer**: subject + preheader + rich body (TipTap → React Email HTML)
- **Segments**: filter by tag, lifecycle stage, custom field
- **Send**: immediate or scheduled
- **Analytics**: opens, clicks, unsubscribes per broadcast — from Resend webhooks
- **AI**: subject line writer, pre-send critic, send-time optimizer

### Landing pages

Atlas-hosted micro-pages under `pages.atlas.blyss.co.ke/<workspace>/<slug>`:

- Templates: **Product launch**, **Waitlist**, **Event**, **Lead magnet**
- WYSIWYG-ish (block-based, TipTap-driven for text + image blocks)
- Signup form → creates a Contact + auto-tags them
- Analytics: views, signups, conversion rate
- Cloudflare-cached (60s TTL) for speed

### Lead magnets

- Upload PDF / video / template pack → generate landing page → capture email → auto-deliver via email + tag contact + trigger sequence enrollment
- Track download rate, conversion rate

### SEO content ideation

Uses **Groq Compound** for the web-search-heavy loop:

- Weekly cron: scan competitor blogs + top-ranking articles for workspace's target keywords
- Cluster by topic → surface content gaps ("competitors write about eTIMS compliance; you don't")
- Suggest 5 content angles per week, ranked by traffic-opportunity heuristic

### Data model

```ts
newsletters: defineTable({
  workspaceId: v.id("workspaces"),
  name: v.string(),
  resendAudienceId: v.string(),          // from Resend Audiences API
  subscribersCount: v.number(),
  archivedAt: v.optional(v.number()),
}).index("by_workspace", ["workspaceId"]),

broadcasts: defineTable({
  workspaceId: v.id("workspaces"),
  newsletterId: v.id("newsletters"),
  subject: v.string(),
  preheader: v.optional(v.string()),
  body: v.any(),                          // TipTap JSON
  bodyHtml: v.string(),                   // rendered for send
  resendBroadcastId: v.optional(v.string()),
  scheduledFor: v.optional(v.number()),
  sentAt: v.optional(v.number()),
  status: v.union(
    v.literal("draft"),
    v.literal("scheduled"),
    v.literal("sending"),
    v.literal("sent"),
    v.literal("cancelled"),
  ),
  metrics: v.optional(v.any()),          // opens, clicks, unsubs
  authorId: v.id("users"),
})
  .index("by_workspace_status", ["workspaceId", "status"])
  .index("by_newsletter", ["newsletterId"]),

landingPages: defineTable({
  workspaceId: v.id("workspaces"),
  slug: v.string(),                       // URL slug
  template: v.string(),                   // 'product_launch' | 'waitlist' | …
  title: v.string(),
  seoDescription: v.optional(v.string()),
  content: v.any(),                       // block-based JSON
  leadMagnetStorageId: v.optional(v.id("_storage")),
  redirectAfterSignup: v.optional(v.string()),
  autoTag: v.optional(v.string()),        // tag applied to captured contacts
  authorId: v.id("users"),
  publishedAt: v.optional(v.number()),
  archivedAt: v.optional(v.number()),
  views: v.number(),
  signups: v.number(),
})
  .index("by_workspace_slug", ["workspaceId", "slug"])
  .index("by_workspace_published", ["workspaceId", "publishedAt"]),

seoIdeas: defineTable({
  workspaceId: v.id("workspaces"),
  topic: v.string(),
  angle: v.string(),
  competitors: v.array(v.string()),       // URLs
  estimatedTraffic: v.optional(v.number()),
  status: v.union(v.literal("suggested"), v.literal("drafted"), v.literal("published"), v.literal("dismissed")),
  generatedAt: v.number(),
}).index("by_workspace_status", ["workspaceId", "status"]),
```

---

## Module 3 — Trend & Brand Intelligence (Phase 8c, ~1 week)

### What it does

Daily digest of what the world says about your brand + competitors + industry, powered by **Groq Compound** (web search + code + agentic browsing in one call).

### Watch lists per workspace

```ts
brandWatches: defineTable({
  workspaceId: v.id("workspaces"),
  kind: v.union(v.literal("brand"), v.literal("competitor"), v.literal("industry_topic")),
  query: v.string(),                      // 'Blyss', 'Wati', 'Kenya pharmacy eTIMS'
  sources: v.array(v.string()),           // ['web', 'reddit', 'x', 'hackernews', 'news']
  lastCheckedAt: v.optional(v.number()),
  archivedAt: v.optional(v.number()),
}).index("by_workspace", ["workspaceId"]),

trendMentions: defineTable({
  workspaceId: v.id("workspaces"),
  brandWatchId: v.id("brandWatches"),
  url: v.string(),
  title: v.string(),
  source: v.string(),                     // 'reddit.com/r/kenya' | 'news.ycombinator.com' | …
  excerpt: v.string(),
  sentiment: v.union(v.literal("positive"), v.literal("neutral"), v.literal("negative")),
  publishedAt: v.optional(v.number()),
  discoveredAt: v.number(),
  actionTakenAt: v.optional(v.number()),  // when founder responded
})
  .index("by_workspace_discovered", ["workspaceId", "discoveredAt"])
  .index("by_watch", ["brandWatchId"]),
```

### Daily cron

`crons.cron("scan brand mentions", "0 5 * * *", ...)` at 05:00 UTC:

For each active `brandWatches` row, call Groq Compound with:

```
"Search the web for recent mentions of "<query>". Focus on <sources>. Return JSON with: url, title, source, excerpt (2 sentences), publishedAt (ISO), sentiment (positive|neutral|negative)."
```

Dedupe against existing `trendMentions` by URL. New mentions go into the table. AI classifies sentiment. Today view surfaces the top 3 unread mentions per workspace.

### Content angle generator

From accumulated `trendMentions`, weekly cron generates `seoIdeas` and stores them for the Content Hub — closing the loop: **see a trend → generate a post idea → draft the post → publish across social**.

### UI

- `/trends` — chronological feed of mentions, filterable by watch, sentiment, source
- Today view section: "Mentions today" with count + sentiment mix
- One-click "Reply to this" → drafts a response via `respond_to_review`
- One-click "Turn into a post" → routes to Social composer with a draft body

---

## Module 4 — Marketing Analytics + Attribution (in Phase 9, ~+1 week)

### What it does

Answer the question **"which channel is closing deals?"** across email + WhatsApp + social + direct.

### UTM builder

Every outgoing link (in emails, WhatsApp, social posts, landing pages) can be auto-decorated with UTM parameters:

```ts
utmLinks: defineTable({
  workspaceId: v.id("workspaces"),
  destinationUrl: v.string(),
  utmSource: v.string(),                  // 'email' | 'whatsapp' | 'facebook' | 'linkedin' | 'direct'
  utmMedium: v.string(),                  // 'campaign' | 'social' | 'newsletter'
  utmCampaign: v.string(),
  utmContent: v.optional(v.string()),
  shortSlug: v.string(),                  // pay.atlas.blyss.co.ke/<slug>
  clicks: v.number(),                     // updated by short-link redirect handler
  authorId: v.id("users"),
})
  .index("by_slug", ["shortSlug"])
  .index("by_workspace_campaign", ["workspaceId", "utmCampaign"]),
```

Short-link `httpAction` in `convex/http.ts` handles `atl.blyss.co.ke/<slug>` (or `pay.atlas.blyss.co.ke/l/<slug>`) → increments click count + 302-redirects to the destination with UTM params intact.

### Attribution model

Every `contacts` row acquires:

- `firstTouchSource` — the campaign / social post / referrer that led to first contact
- `lastTouchSource` — the same at the moment they converted to Customer
- `touchpoints[]` — full journey of clicks + opens + replies

Deal `won_at` triggers attribution computation: which touchpoints contributed? Multi-touch attribution (first + last + linear).

### Cost per lead / customer

Manual data entry per campaign (or auto from social ad platforms when we add Meta Ads later):

- `campaigns.budget` — how much you spent
- `campaigns.leads` — # contacts acquired
- `campaigns.customers` — # deals Won attributed to this campaign
- Compute `CPL` and `CAC` per campaign, per channel

### Funnel analytics

Per pipeline: conversion rate at each stage transition, average time in stage, drop-off rates. Surfaces in `/analytics/funnels`.

### Content performance

Per social post / email / landing page: leads generated, revenue attributed. Ranks best performers so the founder can double down.

---

## Sales Enablement Vault (into Phase 6 Documents)

Additions to the Documents module:

```ts
salesAssets: defineTable({
  workspaceId: v.id("workspaces"),
  kind: v.union(
    v.literal("playbook"),                // scripts / talk tracks per stage
    v.literal("battlecard"),              // competitor comparison
    v.literal("testimonial"),             // customer quote
    v.literal("case_study"),              // Won deal write-up
    v.literal("pricing_calculator"),      // parameterized quote
  ),
  title: v.string(),
  body: v.any(),                          // TipTap JSON
  bodyText: v.string(),
  meta: v.optional(v.any()),              // e.g., testimonial: { customerId, quote, role }
  linkedRecords: v.optional(v.array(v.object({
    type: v.string(),
    id: v.string(),
  }))),                                   // battlecard applies to which deals, etc.
  archivedAt: v.optional(v.number()),
  authorId: v.id("users"),
})
  .index("by_workspace_kind", ["workspaceId", "kind"])
  .searchIndex("search_body", {
    searchField: "bodyText",
    filterFields: ["workspaceId", "kind", "archivedAt"],
  }),
```

**AI workflows added:**
- `generate_case_study` — from a Won deal + linked conversations → drafts case study, extracts quotable moments
- `pull_relevant_assets` — during proposal composition, AI suggests which testimonials + battlecards to include based on deal context

---

## Growth Loops (into Phase 5 Deals + Phase 7 Documents)

### Referral tracker

```ts
referrals: defineTable({
  workspaceId: v.id("workspaces"),
  referrerContactId: v.id("contacts"),    // who referred
  referredContactId: v.id("contacts"),    // new lead
  dealId: v.optional(v.id("deals")),      // deal it closed as
  status: v.union(v.literal("pending"), v.literal("qualified"), v.literal("won"), v.literal("lost")),
  rewardKind: v.optional(v.string()),     // 'credit' | 'commission' | 'thank_you_note'
  rewardAmountCents: v.optional(v.int64()),
  rewardPaidAt: v.optional(v.number()),
  notes: v.optional(v.string()),
})
  .index("by_workspace", ["workspaceId"])
  .index("by_referrer", ["referrerContactId"])
  .index("by_deal", ["dealId"]),
```

Cron `nudge-referrers-monthly` (`crons.cron` 1st of month, 09:00 UTC): pull all customers Won last month → send AI-drafted "you might know someone else who'd benefit" nudge with a personal referral link (tracked UTM).

### Review requests

Post-Won automation: 7 days after deal Won, auto-send a review request via the customer's preferred channel (email or WhatsApp) with a link to Google Business Profile / Trustpilot / a native Atlas review form.

```ts
reviewRequests: defineTable({
  workspaceId: v.id("workspaces"),
  contactId: v.id("contacts"),
  dealId: v.optional(v.id("deals")),
  channel: v.union(v.literal("email"), v.literal("whatsapp")),
  targetPlatform: v.string(),             // 'google_business' | 'trustpilot' | 'atlas_native'
  sentAt: v.number(),
  clickedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  rating: v.optional(v.number()),
  reviewText: v.optional(v.string()),
})
  .index("by_workspace", ["workspaceId"])
  .index("by_contact", ["contactId"]),
```

### NPS + feedback

Quarterly NPS survey to all Customers. AI summarizes verbatims. Detractors → task queue with "reach out" pre-drafted.

---

## Product / Demo Ops (into Phase 10 Calendar)

### Async demos

- Upload screen recording (Convex storage) or paste Loom URL
- Auto-transcribe via **Groq Whisper large-v3-turbo** (free)
- AI extracts questions asked → creates follow-up tasks
- Share link: `demos.atlas.blyss.co.ke/<slug>` — trackable views + drop-off

### Trial license management (Omnix-specific)

For the Omnix workspace where Justine sells offline license keys:

```ts
licenses: defineTable({
  workspaceId: v.id("workspaces"),
  contactId: v.id("contacts"),
  productSku: v.string(),                 // 'omnix-dawa', 'omnix-soko-retail', …
  licenseKey: v.string(),
  machineFingerprint: v.optional(v.string()),
  status: v.union(
    v.literal("issued"),
    v.literal("activated"),
    v.literal("expired"),
    v.literal("revoked"),
  ),
  issuedAt: v.number(),
  activatedAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
  renewalDueAt: v.optional(v.number()),
  paymentRequestId: v.optional(v.id("paymentRequests")),
})
  .index("by_workspace_status", ["workspaceId", "status"])
  .index("by_contact", ["contactId"])
  .index("by_key", ["licenseKey"]),
```

Cron `licenses-renewal-reminders` — 30/14/7/1 day before `renewalDueAt`, auto-draft M-PESA renewal invoice + reminder.

### Product changelog

Simple markdown-per-workspace changelog. Public URL: `atlas.blyss.co.ke/<workspace>/changelog`. Post to social from changelog entry with one click.

---

## Cash flow + runway view (into Phase 9 Analytics)

Living dashboard combining:

- **Cash on hand** — sum of Paystack settlement balances across all subaccounts
- **Expected in (next 30d)** — sent invoices with `status='sent'` + upcoming subscription charges
- **Expected out (next 30d)** — scheduled Transfers + open payouts + fixed monthly (rent, salaries — manual entry)
- **Runway** — cash / monthly burn = weeks/months until zero
- **MRR / ARR** — from active subscriptions
- **AR aging** — unpaid invoices grouped by 0–30 / 31–60 / 61–90 / 90+ days

Data model: `financialSnapshots` table stores daily rollups; `manualExpenses` table stores fixed costs (rent, tools, salaries) entered by hand.

---

## ⌘J AI Copilot (into Phase 4 AI gateway + Phase 11 polish)

Persistent AI panel that opens with `⌘J` (parallel to `⌘K` navigation palette). Already knows the user's current workspace, active record if a slide-over is open, and the last N timeline events.

Capabilities:
- **Ask anything** — "who did I forget to reply to?", "what changed today?", "draft a follow-up for Patricia"
- **Cross-record actions** — "add all cold pharmacies in Nairobi to a WhatsApp broadcast draft"
- **Voice input** — hold `Space` to dictate (Groq Whisper)
- **Suggested actions** — proactively surfaces "3 things you could do right now"

Backed by Groq Compound + Composio for cross-app reach (see `19-integrations.md`).

---

## Voice + vision + image gen (into Phase 4)

- **Voice notes anywhere** — hold-to-record widget in the ⌘K palette, in every note composer, in the Copilot. Groq Whisper (free) transcribes → text goes wherever the widget is.
- **Meeting audio** — drag `.mp3`/`.mp4` into a meeting record → auto-transcribe → summary + action items via `meeting_summary_extract` workflow.
- **Receipt / doc OCR** — upload receipt image → Gemini vision extracts vendor, amount, date, category → creates a manual expense entry.
- **Image generation** — Gemini Flash Image (nano-banana, free) for social visuals + doc illustrations. Prompt from the composer, one-click regenerate.

---

## Data model additions summary

New tables introduced in this document:

- `socialConnections`, `socialPosts`, `socialComments`
- `newsletters`, `broadcasts`, `landingPages`, `seoIdeas`
- `brandWatches`, `trendMentions`
- `utmLinks`
- `salesAssets`
- `referrals`, `reviewRequests`
- `licenses`
- `financialSnapshots`, `manualExpenses`

All workspace-scoped, all indexed on `by_workspace` at minimum. Money fields are `v.int64()` cents. Every mutation writes `auditLog` and (where user-visible) emits `timelineEvents`.

## What this does not include (deferred)

- **X (Twitter) publishing** — API is $200/mo minimum; add later if the founder decides it's worth it. Composio can proxy it in the meantime.
- **TikTok / YouTube publishing** — approval-gated, low ROI at Atlas's current stage.
- **Meta Ads / Google Ads management** — Phase 12 add-on once ad spend is a real line item.
- **Native mobile app** — PWA covers 90%; native follows if usage patterns demand it.
- **Contract redlining** — DocuSeal covers 80% of what the studio needs; redlining follows if bigger deals require it.
- **Full CMS for a public marketing site** — Blyss Studio's own site is Payload-based; Atlas doesn't replicate that.
