# 01 · Mission

## Why Atlas exists

Atlas exists because **one technical founder is doing the work of a five-person company** — sales lead, account manager, customer support, copywriter, project manager, accountant, recruiter — across three different businesses, while still trying to ship code. The cost of that workload isn't the hours; it's the **context switching**. Every time Justine leaves his editor to handle a Gmail thread, a WhatsApp reply, a Google Calendar invite, a Notion doc, a CRM drag, or a manual reconciliation in Sheets, the engineering brain spins down and the code halts.

Atlas's job is to **collapse all of that into one fast, keyboard-driven surface** that feels like an extension of the editor — so the founder can do CEO work in the same posture they do engineering work.

## What "save time, improve decisions, or increase revenue" actually means here

Every feature in Atlas must answer one of three questions. If it cannot, it does not ship.

| Question | Examples that pass | Examples that fail |
|---|---|---|
| **Save time?** | One-keystroke AI draft reply that reads thread context. Bulk import 50 pharmacy leads with one Maps search. AI-summarized timeline at the top of every company. | An onboarding wizard. A "tip of the day" widget. A welcome email tour. |
| **Improve a decision?** | Morning brief flagging 3 rotting deals + recommended actions. Cohort churn signals for Marketplace creators. "This proposal is over-scoped vs similar wins" critic. | A dashboard with seven sparklines and no recommendation. An "earnings this month!" banner. |
| **Increase revenue?** | Prospector pulling 200 cold leads with auto-personalized first-touch in 10 minutes. Reply detection that auto-pauses a sequence. Deal-recovery suggestions on quiet contacts. | "Share Atlas on Twitter" buttons. Referral programs (no customers yet). NPS surveys. |

## What Atlas is NOT

- **Not a CRM.** A CRM optimizes for the salesperson who logs activity to satisfy a manager. Atlas optimizes for the founder who *is* the salesperson and has no manager. There is no "log a call" friction. Everything is captured automatically or extracted by AI from the source artifact (the email, the WhatsApp, the meeting).
- **Not a project manager.** Tasks exist, but they're outcome-anchored ("draft Sokoni proposal v2") not ceremony-anchored ("update sprint board"). No standups, no scrum, no story points.
- **Not a chatbot.** AI is the silent partner that drafts, summarizes, classifies, and proposes — the founder always approves. There is no chat sidebar that needs prompting; AI surfaces are embedded in the work (Draft button in the reply, Summary at the top of the thread, Score next to the deal).
- **Not a marketing site.** Atlas has no public surface. Auth-required at the door. The signup flow only exists for team members invited by the org owner, plus the future Atlas-as-SaaS path.

## The compound bet

Atlas's value is **multiplicative across modules**, not additive. The email module alone is replaceable (Superhuman). The WhatsApp module alone is replaceable (Wati, AiSensy). The pipeline alone is replaceable (Pipedrive). What's not replaceable is what happens when:

> A WhatsApp reply lands → Atlas knows it's about the Karen project → AI surfaces the last proposal + last three emails on the same thread → drafts a reply in 200ms → you approve → it sends → the pipeline stage auto-advances → a follow-up task is scheduled for next Tuesday → tomorrow's daily digest shows progress.

That chain is the product. Every module exists to make the chain shorter, faster, smarter.

## The "do everything from one app" promise

By Phase 8, a working day for Justine should look like this without ever leaving Atlas:

1. **08:00** — Open Atlas. Today view shows: 4 replies waiting, 2 deals rotting, 1 invoice overdue, 1 proposal viewed twice yesterday. AI-suggested actions next to each.
2. **08:05–09:00** — Clear the inbox: ⌘K → "Inbox" → triage with j/k. AI drafts each reply, approve or rewrite.
3. **09:00–10:00** — Studio discovery call. Atlas opened the meeting brief automatically (last 5 interactions + open items + suggested talking points). Meeting note dictated post-call → AI structures into action items + scoped quote draft.
4. **10:00–12:00** — Code (Omnix v0.17 release). Atlas is in the background, web-push notifications muted except critical.
5. **12:30** — ⌘K → "Prospector" → search "pharmacies in Mombasa" → 80 results → AI ranks by fit → bulk WhatsApp first-touch drafts → approve 40 → sent.
6. **14:00** — Blyss Marketplace creator onboarding follow-up. Pipeline shows 3 creators stuck at "first listing". Atlas drafts a check-in for each based on what they uploaded vs didn't.
7. **17:30** — Daily wrap. Review tomorrow's AI-suggested top 3 actions. Close Atlas.

Atlas does not appear on this list because Atlas *is* the work surface for all of it.

## What success looks like at each phase boundary

The acceptance criteria in `15-phases.md` are not vague. Each phase ends with a working slice we can demo. By Phase 11, Justine should be able to fire every other tool currently running this work:

- Gmail / Outlook → Atlas Inbox
- WhatsApp Business app → Atlas WhatsApp inbox
- Sheets-as-CRM → Atlas Pipelines
- Notion / Google Docs as proposal/quote/invoice → Atlas Documents
- Paystack dashboard (mostly) → Atlas Payments
- Google Calendar → Atlas Calendar (with two-way sync)
- Stripe Atlas / Mercury for outbound payouts (Kenya) → Atlas Transfers via Paystack
- HubSpot / Pipedrive trials → never installed
- Mailchimp / Beehiiv for outbound campaigns → Atlas Campaigns
- A separate analytics tool → Atlas Analytics with AI digest

If any of these is still open at the end of Phase 11, that's a build defect.
