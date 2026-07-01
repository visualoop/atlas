# 15 · Phases

12 phases (0–11). Each is shippable. Acceptance criteria are the gate. We do not start phase N+1 until phase N's acceptance is green.

Estimates assume one full-time engineer-CEO with AI assist. Calendar weeks; actual elapsed time depends on Justine's other commitments.

---

## Phase 0 — Foundation (week 0 → 1)

**Goal:** empty Atlas with auth, theme, shell, palette, and Today view skeleton — production-grade from line one.

**Tasks:**
- Project structure: `app/`, `lib/`, `db/`, `components/`, `ai/`, `emails/`, `jobs/`, `scripts/`
- `lib/env.ts` with Zod-validated env loading
- Drizzle setup with first migration (orgs, workspaces, memberships, sessions; Better Auth tables managed by its CLI)
- Better Auth installed with Organization + API Key + Two Factor plugins
- Email + password + magic link + Google OAuth all working
- `next-themes` integration with dark default
- shadcn init with our `components.json` (style: new-york, base color: slate, css vars)
- Bulk install full shadcn registry (see `17-theme-and-shadcn.md`)
- Atlas theme tokens injected into `app/globals.css`
- Geist + Geist Mono + Instrument Serif loaded via `next/font/google`
- Custom overrides for Button, Input, Card, Sheet, Dialog, Badge, Tabs, Table, Tooltip
- App shell: topbar (workspace switcher + ⌘K + bell + user menu) + sidebar (icon-only collapsed) + main + status bar
- ⌘K command palette stub (just navigation, no actions yet)
- Today view shell (4 empty state cards)
- Settings shell (`/settings/profile`, `/settings/security`, `/settings/members`, `/settings/integrations` — all rendered, but Integrations tab is a stub)
- Invitation flow scaffolded end-to-end (send → email via system Resend → click → accept or create-own-org → land in workspace)
- pg-boss installed + worker process scaffold
- R2 client + presigned upload helper
- Encrypted-secrets helper (`lib/secrets/{org,user}.ts`) with AES-256-GCM
- Sentry + structured logging (Pino) + PostHog
- PWA: manifest, service worker, install prompt (functional but minimal offline)
- CI/CD: GitHub Actions (lint, type-check, test, build) + Vercel preview deploys
- Seed: Blyss org, Justine as Owner, 3 workspaces (Omnix, Marketplace, Studio)

**Acceptance:**
- [ ] `npm run dev` starts cleanly; visit `<port>.blyss.co.ke` and see the sign-in screen
- [ ] Sign in with Google → land in Today view
- [ ] Topbar shows `Blyss ▼` and `Omnix ▼` (default workspace)
- [ ] `⌘1`, `⌘2`, `⌘3` switch between Omnix, Marketplace, Studio
- [ ] `⌘K` opens command palette (with just nav items so far)
- [ ] Dark default, `next-themes` toggle works
- [ ] Theme tokens applied throughout — no shadcn defaults visible
- [ ] `/settings/members` lists members (just Justine), Invite button opens form
- [ ] Send invitation → email arrives via system Resend → click → choose "join Blyss" or "create my own org" → joined or new org created
- [ ] `/settings/integrations` shows provider list, all unconfigured
- [ ] Audit log records every mutation in `/admin/audit-log` (Owner only)
- [ ] 2FA setup flow exists at `/settings/security`
- [ ] Lighthouse Performance ≥ 95, Accessibility ≥ 95 on signed-in shell pages
- [ ] No Tier 1/Tier 2 secret in client bundle (build artifact grep)

---

## Phase 1 — The graph (week 1 → 3)

**Goal:** the contact + timeline spine that every other module reads.

**Tasks:**
- `companies`, `contacts`, `org_companies` tables + indexes
- CRUD via Server Actions
- List pages with TanStack Table + filters
- Slide-over detail (Sheet) with tabs: Timeline / Conversations / Deals / Notes / Files / Tasks / AI memory (last is empty until Phase 5)
- Custom fields (typed) per workspace
- Tags + lists + saved views
- Universal `timeline_events` table + `recordEvent` helper
- Notes with TipTap editor + plain-text extraction for FTS
- Tasks with due dates, priorities, recurrence, assignment
- Files with R2 presigned upload
- Audit log on every mutation
- Search index with FTS + pgvector embeddings (HNSW)
- Hybrid search via RRF (BM25 + cosine) — wrapped in `lib/search.ts`
- Search-as-you-type in ⌘K palette
- Bulk actions on lists (assign owner, change stage, tag, delete, export)
- Soft-delete with restore + 30-day hard-delete cron

**Acceptance:**
- [ ] Create a company → contact → note → task → file → upload PDF
- [ ] Slide-over opens with all tabs populated
- [ ] Timeline shows all the events in chronological order
- [ ] Search "Mama Brenda" finds the company across all data types
- [ ] Bulk-tag 5 contacts in one action
- [ ] Soft-delete a contact → archived view; restore works; hard delete after 30d
- [ ] Audit log records every mutation
- [ ] All Lighthouse + Drizzle EXPLAIN tests pass

---

## Phase 2 — Email (week 3 → 5)

**Goal:** Atlas is the email client. Receive, thread, draft, send, attach.

**Tasks:**
- Resend outbound: multi sender identity per workspace, DKIM verification status surface
- Resend Inbound webhook receiver
- Cloudflare Email Routing → Worker fallback path (functional, optional)
- MIME parsing via `mailparser`
- Thread linking by Message-ID / In-Reply-To / References → attach to existing conversation or create new
- Conversations + messages schema (already in 05)
- Inbox UI: 3-pane layout, j/k/r/a/c/d shortcuts
- Per-message: render HTML (sanitized), attachments to R2
- Compose UI in slide-over: rich text via TipTap, recipient autocomplete from contacts
- Templates (per workspace) with variable substitution
- Workspace signatures
- Snooze / pin / archive / star
- Send with attachments (uploaded or from Documents library)
- Schedule send (Resend's scheduled-send capability)
- Unsend within 30 seconds (cancel scheduled send)
- Search inside Inbox (FTS + filters)
- Reply / Reply All / Forward
- Drafts auto-save (every 2s of inactivity)

**Acceptance:**
- [ ] Org Owner pastes Resend org key, verifies a sending domain
- [ ] Send email from Atlas → recipient receives, lands in their inbox
- [ ] Reply from outside → Atlas inbound webhook receives, thread linked correctly to original conversation
- [ ] Attach a PDF from Documents library → recipient receives PDF
- [ ] Inbox renders ≥ 1000 threads at < 400ms
- [ ] j/k navigation, r/a/c keyboard, all responsive < 100ms
- [ ] Snooze a thread → drops out of inbox, returns at scheduled time
- [ ] Compose autosaves drafts
- [ ] Send-then-unsend within 30s works

---

## Phase 3 — Prospector (week 5 → 6)

See `09-prospector.md`. Acceptance criteria there.

**Goal:** Google Maps lead-gen workflow, bulk import to pipeline, AI first-touch drafts.

---

## Phase 4 — WhatsApp (week 6 → 8)

**Goal:** Meta Cloud API direct. Unified inbox with email. Templates, broadcasts, opt-out.

**Tasks:**
- Org Owner provisions Meta WhatsApp Business app, pastes App ID + App Secret + WABA ID + Phone Number ID(s)
- Webhook verification (`hub.verify_token` exchange, signature validation per request)
- Inbound message handler: parse, normalize phone, attach to contact (auto-create if new), thread by `wa_id`
- AI classify intent on inbound
- Outbound: free-form (within 24h of last inbound) + template (outside)
- Template manager: create → submit to Meta → poll status → mark approved/rejected
- Broadcasts with audience filter + opt-out + Meta tier rate limit
- Cost tracker per conversation window (per-message in 2026 model)
- Media attachments (PDF, image, audio, video) within Meta size limits
- Unified inbox toggle: Email / WhatsApp / All
- Reply detection auto-pauses sequences (cross-channel)
- Bulk first-touch drafts via Prospector → batch send

**Acceptance:**
- [ ] Receive a WhatsApp message → appears in Inbox tagged with WhatsApp icon, AI classified
- [ ] Reply with free-form (within 24h) → recipient receives
- [ ] Submit a marketing template → goes to "pending" → Meta approves (sandbox) → status updates
- [ ] Send approved template to a contact → recipient receives
- [ ] Attach PDF in WhatsApp message → recipient receives PDF
- [ ] Bulk broadcast to 50 contacts → rate-limited per Meta tier, opt-outs respected
- [ ] Cost tracker shows running spend per conversation window

---

## Phase 5 — AI gateway + 14 workflows (week 8 → 10)

See `08-ai-gateway.md`. Acceptance:

- [ ] Org Owner pastes Gemini + Groq + OpenRouter + Mistral + Cohere keys → all test green
- [ ] Settings → AI shows 4 tabs with provider/model/feature/usage views
- [ ] Each of the 14 ship features runs and produces output
- [ ] Fallback chain works (kill primary key → fallback fires → audit logged)
- [ ] Budget guard works (set KES 10/day → exceed → switches to free model)
- [ ] Usage tab shows token + cost accounting per feature per day
- [ ] AI memory facts extracted from new messages, displayed in contact slide-over
- [ ] AI Q&A: "what's Patricia's open project status?" returns coherent answer with sources
- [ ] PII redaction policy works in "Mask" mode

---

## Phase 6 — Pipelines + deals (week 10 → 11.5)

**Tasks:**
- `pipelines`, `stages`, `deals` schema + per-workspace shapes pre-seeded
- Kanban board with `@dnd-kit/core`, optimistic move + Undo
- Table view with TanStack Table, inline edit
- Deal slide-over with all related records (Timeline, Contacts, Files, Documents, Tasks)
- Multi-currency
- Stage automations (on enter → send template / create task / advance another deal)
- AI: `detect_rotting_deals`, `recommend_next_action`
- Win/loss reasons capture on stage transition to Won/Lost
- Deal templates (Studio "discovery scope", Omnix "trial → paid")

**Acceptance:**
- [ ] Create a deal, move through stages via drag and j/k+arrow keys
- [ ] Stage automation fires on enter (e.g., enters Proposal → creates "Follow up" task)
- [ ] AI flags a deal idle > 14 days as rotting, suggests next action
- [ ] Win/loss reason required on closing
- [ ] Multi-currency: KES, USD, ZAR deals coexist in Marketplace workspace

---

## Phase 7a — Documents + PDF + signing (week 11.5 → 13.5)

**Tasks:**
- `documents`, `document_versions`, `invoice_line_items` schemas
- Document templates with locked sections
- TipTap editor with variable insertion (`{{deal.amount}}`)
- `@react-pdf/renderer` for server-side PDF generation
- AI feature `generate_document` (takes deal + workspace template → drafts)
- AI feature `critique_document` (flags scope creep, pricing, missing terms)
- Public share link `/share/{token}` with view tracking
- DocuSeal self-host (Hetzner VPS, Docker container)
- DocuSeal integration: create document → embed signing iframe → webhook → audit trail
- Send document via email (auto-attached PDF + share link)
- Send via WhatsApp (PDF media + short link)

**Acceptance:**
- [ ] Generate a proposal from a Studio deal → PDF renders identically to on-screen
- [ ] Public share link opens unauth view; tracked
- [ ] Send via email; client receives PDF + share link CTA
- [ ] Client signs via embedded DocuSeal; signature webhook fires; audit trail captured
- [ ] Convert quote to invoice retains line items

---

## Phase 7b — Payments (Paystack full-stack) (week 13.5 → 15.5)

See `10-payments.md`. Acceptance there.

---

## Phase 8 — Campaigns + sequences (week 15.5 → 17)

**Tasks:**
- Campaign builder (audience filter → message → schedule)
- Email sequences (multi-step drips)
- WhatsApp sequences (template-based)
- A/B testing with stat-sig gate
- Suppression list per workspace + global
- AI subject writer + send-time optimizer + pre-send critic
- Reply detection auto-pauses
- Stop-on-conversion

**Acceptance:**
- [ ] Build 3-step email sequence, enroll 50 contacts
- [ ] First message sends at scheduled time, second 3 days later, third 7 days later
- [ ] One contact replies → sequence pauses for that contact only
- [ ] A/B test 2 subject lines → significance reached → winner picked automatically
- [ ] Suppression: opted-out contact does not receive

---

## Phase 9 — Analytics + daily digest (week 17 → 18.5)

**Tasks:**
- Per-workspace dashboards (Omnix license funnel / Marketplace GMV / Studio P&L)
- AI daily digest cron at 7am Africa/Nairobi → email + WhatsApp + in-app
- AI weekly review Friday 4pm → generated doc
- AI monthly forecast 1st of month
- Custom "Ask Atlas" reports via AI Q&A
- CSV + PDF export
- Saved reports + scheduled email of reports

**Acceptance:**
- [ ] Open Today view at 7am → digest delivered + 3 actionable items
- [ ] Friday 4pm → weekly review document arrives
- [ ] "Ask Atlas: top 5 sources of leads this month" returns a coherent answer with chart
- [ ] Export CSV of any pre-built report

---

## Phase 10 — Calendar + meetings (week 18.5 → 20)

**Tasks:**
- Google Calendar OAuth two-way sync (per user, Tier 2 secret)
- Meeting booker (single + group)
- Public booking page `book.blyss.co.ke/<ws>/<type>`
- iCal feed per workspace
- Pre-meeting brief AI (1 hour before)
- Post-meeting summary + action items (upload audio → Whisper on Groq → AI extract)

**Acceptance:**
- [ ] Connect Google Calendar in Personal Settings → events sync into Atlas
- [ ] Create a booking type "30-min discovery" → public URL
- [ ] Lead books a slot → meeting created in Atlas + Google + lead receives ICS
- [ ] 1 hour before meeting → pre-brief notification with last 5 interactions
- [ ] Post-meeting: paste transcript → action items extracted to Tasks

---

## Phase 11 — Polish + PWA + hardening (week 20 → 21.5)

**Tasks:**
- PWA install flow (icons, splash, manifest, install prompt)
- Service worker offline-read for Today view + cached inbox
- Web push notifications for critical events
- Full mobile responsive sweep — every page works at 320 / 375 / 414 / 768
- Lighthouse all green ≥ 95
- Security audit: CSP, HSTS, rate limits, encryption review
- Backup strategy operational (weekly R2 dumps tested)
- Restore drill performed
- User docs at `docs.atlas.blyss.co.ke`
- Admin/operator runbook in `/ops/`

**Acceptance:**
- [ ] Install Atlas to dock (macOS) / start menu (Windows) / home screen (mobile)
- [ ] Disconnect network → Today view + cached inbox readable
- [ ] Web push notification fires for new urgent reply
- [ ] All Lighthouse routes ≥ 95 (perf, a11y, best practices, SEO)
- [ ] `npm audit` clean
- [ ] Sentry + PostHog + uptime monitor all reporting
- [ ] Restore from backup tested

---

## Phase 12+ — Extensions (post-launch)

Slot in without re-platforming because the foundation handles it:

- **Contracts** — redlining, version history, multi-party signing
- **Knowledge base** — internal wiki, AI-searchable
- **Automation builder** — no-code "when X then Y" rules
- **Customer portal** — for Atlas-as-SaaS, Atlas's own customers
- **SMS** via Africa's Talking
- **Voice** — call recording + Whisper transcription + click-to-call via Twilio
- **Browser extension** — capture lead from LinkedIn / X / any page
- **AI autonomous agents** — "every Monday, find pharmacies without Omnix, draft outreach"
- **Accounting basics** — P&L pulled from Atlas + manual entries
- **Inventory-aware deals** — for the Omnix workspace, deals know which modules each customer bought

## Cross-phase milestones

| Week | Milestone |
|---|---|
| 1 | Atlas shell + auth + theme demo |
| 3 | Contact graph + Notes + Tasks + Files + universal ⌘K search |
| 5 | Email module — Atlas replaces Gmail |
| 6 | Prospector — first cold leads imported |
| 8 | WhatsApp module — Atlas replaces WhatsApp Business app |
| 10 | AI gateway live, all 20+ workflows including Groq Compound + Free Router + voice + vision + image gen |
| 11.5 | Pipelines demo with real deals + referral tracking |
| 13.5 | Documents + PDF + signing + Sales Enablement Vault |
| 15.5 | Payments wired, first invoice paid via Atlas |
| 17 | Campaigns + sequences |
| **19** | **Social Publishing — Facebook + Instagram + LinkedIn from one composer** |
| **20.5** | **Content & Marketing Hub — Newsletter + landing pages + SEO ideation** |
| **21.5** | **Trend Intelligence — daily brand + competitor + industry digest** |
| 23 | Analytics + Attribution + Cash flow + morning digest |
| 24.5 | Calendar + Meetings + Async Demos + Trial Licenses |
| 25.5 | Polish + PWA + hardening |
| 26+ | **Integrations & Automation Builder (Composio) + Public API + ⌘J Copilot** |

**Atlas v1.0 launches by week ~26.**

## Revised phase plan (with growth engine)

The plan expanded from 11 to 14 phases. The core sequence (0–7b) is unchanged. The growth-engine phases (8a, 8b, 8c) slot after Campaigns and before Analytics so all outbound channels exist before we measure them. Automation moves into Phase 12 with Composio as the substrate.

| # | Phase | Weeks | Slice output |
|---|---|---|---|
| 0 | Foundation | 0–1 ✅ | Auth, theme, shell, palette |
| 1 | The graph | 1–3 🟢 | Contacts + Companies + Notes + Tasks + Files + Timeline + Search |
| 2 | Email | 3–5 | Resend in + out + threaded inbox |
| 3 | Prospector | 5–6 | Google Maps lead gen |
| 4 | WhatsApp | 6–8 | Meta Cloud API |
| 5 | AI gateway + workflows | 8–10 | 10-provider abstraction, all workflows, voice + vision + image gen |
| 6 | Pipelines + deals | 10–11.5 | Kanban + rotting detection + **referral tracker** |
| 7a | Documents + signing + **Sales Enablement Vault** | 11.5–13.5 | Proposals, quotes, invoices, PDF, DocuSeal, playbooks, testimonials, case studies |
| 7b | Payments (Paystack full-stack) | 13.5–15.5 | Subaccounts, links, invoices, subs, transfers, splits |
| 8 | Campaigns + sequences | 15.5–17 | Email + WhatsApp sequences |
| **8a** | **Social Publishing** (new) | **17–19** | **FB + IG + LinkedIn composer, scheduler, comment inbox** |
| **8b** | **Content & Marketing Hub** (new) | **19–20.5** | **Newsletter (Resend Broadcasts), landing pages, lead magnets, SEO ideation** |
| **8c** | **Trend & Brand Intelligence** (new) | **20.5–21.5** | **Groq Compound-powered daily digest of mentions + competitors + trends** |
| 9 | Analytics + Attribution + Cash flow | 21.5–23 | Per-workspace dashboards, UTM tracking, multi-touch attribution, cash flow + runway, daily AI digest |
| 10 | Calendar + Meetings + **Demo Ops** | 23–24.5 | Google Cal sync + booking + async demos + trial licenses |
| 11 | Polish + PWA + hardening | 24.5–25.5 | PWA install, offline read, Lighthouse ≥ 95, security audit |
| **12** | **Extensions: Composio integrations, Automation Builder, Public API, ⌘J Copilot** | **25.5+** | **Full agent orchestration; connect to 1000+ apps via Composio; no-code automations; persistent AI copilot** |
| 12+ | Long-tail extensions | ongoing | Contracts redlining, knowledge base, customer portal, SMS, voice, browser extension, native mobile, AI autonomous agents |
