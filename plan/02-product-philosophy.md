# 02 · Product Philosophy

## The persona Atlas is designed for

**Justine Gichana — engineer-CEO.** Senior software engineer by training, currently doing CEO work 90% of the time across three companies he also writes the code for. Comfortable in a terminal. Reaches for `:` and `⌘K` faster than the mouse. Hates context switching because the cost is a 20-minute spin-up back into the codebase. Reviews AI drafts in one keystroke and ships.

Every design call in Atlas is decided by asking *"What would this engineer-CEO do here?"* — not what the average sales rep, not what a manager logging into a CRM, not what a B2B SaaS designer would default to.

## The 11 principles

These decide every design and architecture call. When two principles conflict (they sometimes do), the one earlier in the list wins.

### 1. Keyboard first, always

Every action must have a keyboard path. The mouse exists for graphs and image cropping. If you can't reach a feature with `⌘K → typed query → enter`, it doesn't exist.

- Universal `⌘K` palette routes to any record, any view, any action
- Workspace switch: `⌘1`, `⌘2`, `⌘3` (or named keys)
- Inbox navigation: `j` / `k` / `r` / `a` / `c` / `d` (Linear convention)
- Slide-overs open with `?` / `e` / type-specific keys; close with `Esc`
- Forms submit with `⌘↵`, cancel with `Esc`
- Multi-select with `Shift+↑/↓`, bulk action with `⌘A` then keyed verb

### 2. One surface, no context switches

Atlas replaces Gmail, WhatsApp Business, Sheets-as-CRM, Notion-as-proposal, Calendar, and Paystack dashboard. The founder should not need a second tab open during a working day. When integration is unavoidable (Google Calendar OAuth), Atlas pulls into its own surface — it never bounces the founder out.

### 3. AI proposes, founder approves

AI never auto-sends, never auto-bills, never auto-decides. Every AI artifact ships with a "review and send" gate. The gate is one keystroke wide (`⌘↵`) so it stays fast, but it is always present. The exception is internal classification (lead scoring, intent detection) — those run silent because they don't leave Atlas.

### 4. The timeline is the spine

Every action — email sent, WhatsApp received, deal moved, payment received, document signed, meeting held — lands in a single polymorphic `timeline_events` table. Every record (contact / company / deal) reads its timeline back. The timeline is what makes AI context possible: when drafting a reply, the AI reads the last N events on the company timeline, not just the email thread.

### 5. Server-first

React Server Components are the default. Client components exist only where genuine interactivity demands them (forms, drag-and-drop, command palette). This is non-negotiable for performance: Atlas's tables are dense, its inbox is large, and round-trip costs to the client kill the feel.

### 6. Calm density, not decoration

Atlas is a dense application — many records, many threads, many open deals. Density is a feature, not a flaw. We achieve calm density through:
- Hairline borders, never shadows
- 32–36px row heights in tables, mono numerals
- One accent color (`#FF5B1F`), used ≤ 4× per viewport
- Generous whitespace at section boundaries; tight inside content blocks
- Type carries hierarchy — sizes do the work, not boxes

There are no decorative gradients, animated counters, hover-zoom on images, or "trusted by N companies" strips. Every pixel earns its place.

### 7. Mistakes are reversible

Every destructive action has Undo. Deals soft-delete with a 30-day window. Sent emails can be unsend within 30 seconds (Resend supports this via scheduled-send + cancel). Inbound spam → "mark as not-lead" untrains the AI classifier. The founder should never be afraid to press Enter.

### 8. AI runs on cheap

Atlas's AI gateway routes by feature → cheapest capable model in the registry. Free-tier providers (Gemini, Groq, Mistral, Cerebras, GitHub Models) are tried first; paid providers are fallbacks. Per-feature model binding so cheap models do cheap work (Groq for classification at 30 RPM), capable models do capable work (Gemini Flash for long-form drafting). Token + cost accounting is always on, even when cost is $0, so the founder sees what would cost if free tiers vanished.

### 9. Money is precise, not pretty

Money is stored as `numeric(20, 4)` — never `real`, never `float`. Tax math is integer-cents. KES is the default currency. Multi-currency is supported but conversions are deferred: invoice in KES, store conversion rate at time of payment, report in the workspace's reporting currency. The Omnix audit report taught us this lesson; Atlas inherits it.

### 10. Audit everything

Every mutation goes through a path that records actor + before-state + after-state + reason. Secret access is audited (who decrypted Paystack key at 14:23). Soft-deletes record the actor and timestamp. AI calls log the model, tokens, cost, and inputs (with PII redacted per policy). The audit log is queryable and exportable.

### 11. Phase by phase, no MVP shortcuts

We build in 12 phases. Each phase is shippable and demonstrable. We do not "skip ahead" to get a flashier demo. We do not "patch in later" something that should be foundational. Phase 0 takes a week and looks boring; that week is what makes Phase 4's AI gateway possible in 2 weeks instead of 6. Discipline now, velocity later.

## What we explicitly reject

- **The CRM playbook.** "Log a call" buttons, activity counts as a KPI, sales-rep leaderboards.
- **The B2B SaaS aesthetic.** Gradient hero, three-column emoji features, drop-shadow cards, "Get Started for Free!" CTAs.
- **The chatbot AI pattern.** A chat sidebar that needs prompting. AI is in the work, not in a separate panel.
- **The all-things-to-all-people surface.** Atlas refuses to ship a feature that doesn't pass the time/decisions/revenue test, even if a user asks for it.
- **The "AI-first" marketing veneer.** Atlas uses AI heavily, but every workflow works without it (degraded but functional) — because free tiers are rate-limited and providers go down. AI is a force multiplier, not a load-bearing wall.

## Cadence

- **Daily**: morning AI digest, inbox triage, prospector outreach, deal moves.
- **Weekly**: AI business review on Friday afternoon. Weekly forecasting.
- **Monthly**: AI monthly summary on the 1st. Reconciliation across Paystack.
- **Quarterly**: archive cold leads, prune dead sequences, rotate API keys.

These cadences are baked into the product: digest email cron, weekly review document auto-generated, monthly summary delivered via WhatsApp + email + in-app. The founder doesn't *schedule* these; Atlas runs them.
