# Atlas AI Architecture

How the assistant persona, model routing, inbound handling, and
proactive AI features fit together as of the Persona + Router +
Inbound wave.

## Overview

Atlas is designed so its user reviews AI work rather than doing it:

- **Copilot** — always-visible tool-using agent that answers questions about the workspace
- **Inbound auto-draft** — every reply email lands with a suggested response ready to review
- **Compose AI** — no blank pages; every email starts with a draft option
- **Today briefing** — AI paragraph summarizes the day's actual state
- **Deal nudges** — daily AI-generated next actions on rotting deals
- **Auto-draft on prospect import** — cold emails written silently in background
- **Fit scoring** — one-click AI scoring for contacts + companies
- **Live notifications** — toasts surface hot leads, rotting deals, inbound replies
- **Configurable persona** — every workspace names their assistant + tunes its voice

Model choice is decoupled from feature code — a task-aware router
picks the best available model for each call.

## Model routing

```
convex/ai/
├── catalog.ts    — 15 models across 6 providers, tagged by task fit
├── router.ts     — pickModelChain(taskCategory, options)
└── ...
convex/lib/
└── tokenEstimate.ts — chars/4 heuristic for context sizing
```

`pickModelChain(taskCategory, options)` returns a fallback chain
of `{provider, model, contextWindow, ...}` tuples. Task categories:

| category | who calls it | example models |
|---|---|---|
| `chat_agentic` | Copilot tool-using turns | llama-3.3-70b, claude-sonnet, gpt-4o |
| `chat_fast` | quick chat replies | llama-3.1-8b, gemini-flash |
| `draft_short` | short outreach | claude-haiku, gemini-flash |
| `draft_long` | long emails, docs | claude-sonnet, gpt-4o |
| `summarize` | briefings, thread summaries | gemini-flash |
| `long_context` | huge doc analysis | gemini-1.5-pro (2M tokens) |
| `extract_json` | fit scoring, ranker | gemini-flash w/ JSON mode |
| `reason_hard` | deal nudges, complex analysis | claude-sonnet, gpt-4o |

Sort order within a task: quality DESC → latency DESC (if speed
matters) → contextWindow DESC (if long context) → cost ASC →
latency ASC.

Consumers:
- `convex/copilot.ts` — `chat_agentic`, filters to providers with SDKs
- `convex/prospectorRanking.ts` — `extract_json`
- `app/api/copilot/route.ts` — `chat_agentic` for the Next.js streaming route

Cold outreach + document generation still route through
`convex/ai.ts runFeature` (feature-registry chains). Both systems
coexist.

## Assistant persona

Per-workspace. Fields on the `workspaces` table:
- `assistantName` — defaults to "Atlas" if unset
- `assistantPersonaTraits` — freeform character notes

`convex/lib/workspaceContextAi.ts` builds a `workspaceBrandBlock`
that appends a `## Your persona` section with the name + traits.
Every AI feature that reads brand context automatically gets the
persona injection.

UI:
- `/settings/workspace` — "Your assistant" section with name + traits inputs
- Copilot panel header shows the workspace's chosen name via
  `api.copilotHelpers.workspaceBrandInfo`

## Resend inbound v2

```
HTTP webhook → convex/http.ts (parses email.received + legacy formats)
             → messagesInbound.ingest mutation
             → scheduler.runAfter(0, emailsInboundFetch.fetchInboundBody)
                 → GET api.resend.com/emails/received/{id}   [Node]
                 → updateMessageBody(bodyText, bodyHtml)      [V8 mutation]
                 → for each attachment: download + storage.store + attach
                 → scheduleAutoDraft(messageId)               [V8 mutation]
                     → scheduler.runAfter(0, draftEmailReply {system: true})
                         → aiWorkflows.draftEmailReply (session-less path)
                             → saveAutoDraft(msg.aiDraftReply)
                     → notify(kind: inbound_arrived)
```

Webhook URL: `${CONVEX_SITE_URL}/inbound/email` — copy-able from
`/settings/integrations`. Requires `RESEND_INBOUND_SECRET` env var
matching the Svix secret Resend sends.

## Auto-draft (inbound + prospect)

**Inbound**: `messages.aiDraftReply` + `aiDraftedAt` fields. Thread
reader shows a primary-tinted chip above the Reply button when
present. `[Use it]` copies the draft into the composer.

**Prospect import**: On every `importResult`, `bulkImport`, and
`importMapPlace` call, schedules
`internal.coldOutreach.autoDraftForCompany` 3 seconds later. The
draft is stored on `companies.enrichmentData.aiDraft = {email:
{subject, body, draftedAt}, whatsapp: {body, draftedAt}}`.

`OutreachDrafter` component subscribes to
`api.coldOutreachQueries.companyAiDraft` and auto-populates when
the cached draft exists.

## Session-less pattern

Schedulers, crons, and webhooks run without a user session. To do
brand-aware AI work we resolve the org owner as the actor:

```ts
const ws = await ctx.db.get(workspaceId);
const members = await ctx.db.query("members")
  .withIndex("by_org", (q) => q.eq("organizationId", ws.organizationId))
  .collect();
const owner = members.find((m) => m.role === "owner") ?? members[0];
// owner.userId → actorId for getOrgKey decryption + audit
```

Session-less loaders in `aiWorkflowHelpers.ts`:
- `loadConversationForReplyForSystem`
- `loadProspectorResultForSystem`
- `loadCompanyForOutreachForSystem`

Session-less setup in `copilotHelpers.ts`:
- `prepareForWorkspace` (mirrors `prepare` but takes a workspaceId)

## Compose AI

`convex/aiWorkflows.ts composeAssist` action — 5 modes:

- `draft` — from an empty body + a hint string
- `improve` — tighten current body, strip AI-slop
- `shorter` — halve length, keep the ask
- `longer` — expand with one supporting sentence
- `different_angle` — same ask, new hook + framing

Uses `draft_email_reply` feature chain. Prompt threads workspace
brand context in every call.

UI: `AIAssistBar` component above the RichComposer in
`app/(app)/inbox/compose-sheet.tsx`.

## Today briefing

`convex/dailyBriefings.ts` (Node) + `dailyBriefingsHelpers.ts` (V8):

- Cron: 03/09/15 UTC = 06/12/18 Africa/Nairobi
- Per workspace, gathers: unread conversations, tasks due today,
  meetings today, rotting deals count, uncontacted prospects, top
  open deal by amount, stalest deal, recent inbound subjects
- Prompts `summarize` task → Gemini Flash → 2-3 sentence paragraph
- Stores in `dailyBriefings` table (keeps last 3)
- Today page reads latest via `latestForWorkspace`, refreshes on
  demand via public `refreshMine` action

## Fit scoring

`convex/aiWorkflows.ts` — `scoreContactFit` + `scoreCompanyFit`
actions. Uses `extract_json` task → Gemini Flash → strict JSON
`{score: 0-100, reason: string}`.

Results persist to `contacts.fitScore + fitScoreReason` and
`companies.fitScore + fitScoreReason`.

UI: row-action dropdowns on `/contacts` and `/companies` tables.
Toast reads `Fit: 87/100 · Head of ops matches ICP exactly.`

## Deal nudges

`convex/pipelinesActions.ts classifyRottingDeals` cron runs daily
at 04:00 UTC. For each rotting deal:
- Groq llama-3.3-70b returns JSON `{healthScore, healthNotes, nextAction}`
- `updateDealHealth` mutation persists all three, including
  `deals.aiNextAction`
- Below score 40: emits `rotting_deal` notification

Deal cards render the nudge under the health chip with a
Sparkles icon + border-top separator.

## Notifications

Central bus in `convex/notifications.ts`:
- `notify(workspaceId, kind, title, body?, actionLink?)` — internalMutation
- `recent` — public query, workspace-scoped, unarchived, last 30
- `markRead / markAllRead` — public mutations
- `trimOld` — daily cron, deletes entries older than 30 days

Kinds: `inbound_arrived`, `rotting_deal`, `hot_lead`, `enrichment_complete`, `ai_scored`

`components/atlas/notification-subscriber.tsx` subscribes reactively
in the app shell. Any notification created after mount that hasn't
been read toasts via sonner with an "Open" action linking to
`actionLink`.

## Trigger points table

| trigger | kind | fired from |
|---|---|---|
| Inbound reply body fetched | `inbound_arrived` | `emailsInboundFetch_helpers.scheduleAutoDraft` |
| Deal healthScore < 40 | `rotting_deal` | `pipelinesActions.classifyRottingDeals` |
| Company fitScore ≥ 90 | `hot_lead` | `aiWorkflows.scoreCompanyFit` |

More can be added by calling `internal.notifications.notify` from
any mutation or action.

## Convex runtime split

Two categories of files:

1. **Node (`"use node"` at top)**: can `fetch()`, `import "node:crypto"`,
   do I/O. Contains only `action` / `internalAction`. Cannot host
   queries or mutations.
2. **V8 sandbox (no header)**: default. Can define query, mutation,
   internalQuery, internalMutation. **No `await import(...)` — hard
   fail.** All imports static top-of-file.

Non-Node files **cannot import from Node files** — bundling fails.
Query splits (like `coldOutreachQueries.ts`) exist because
`coldOutreach.ts` is Node.

## File index

**Model catalog + routing:**
- `convex/ai/catalog.ts`
- `convex/ai/router.ts`
- `convex/lib/tokenEstimate.ts`

**Router consumers:**
- `convex/copilot.ts`
- `convex/prospectorRanking.ts`
- `app/api/copilot/route.ts`

**Persona:**
- `convex/lib/workspaceContextAi.ts` — `workspaceBrandBlock` +
  `workspaceAssistantName`
- `convex/schema.ts` — `workspaces.assistantName` + `assistantPersonaTraits`
- `app/(app)/settings/workspace/page.tsx` — settings UI
- `convex/copilotHelpers.ts workspaceBrandInfo` — UI-facing name
- `components/atlas/copilot-panel.tsx` — dynamic panel header

**Inbound:**
- `convex/http.ts` — webhook handler with v2 detection
- `convex/emailsInboundFetch.ts` — Node body-fetch action
- `convex/emailsInboundFetch_helpers.ts` — V8 helpers
- `app/(app)/settings/integrations/page.tsx` — webhook URL copy card

**Auto-draft (inbound reply):**
- `convex/aiWorkflows.ts draftEmailReply` — accepts `system` + `persistToInboundMessage`
- `convex/aiWorkflowHelpers.ts` — `loadConversationForReplyForSystem`, `saveAutoDraft`
- `app/(app)/inbox/page.tsx` — auto-draft chip in thread reader

**Auto-draft (cold outreach):**
- `convex/coldOutreach.ts autoDraftForCompany`
- `convex/coldOutreachQueries.ts companyAiDraft`
- `convex/aiWorkflowHelpers.ts` — `loadCompanyForOutreachForSystem`, `saveCompanyAiDraft`
- `convex/prospector.ts` — schedules from `importResult`, `bulkImport`, `importMapPlace`
- `components/atlas/outreach-drafter.tsx` — reads cached draft on mount

**Compose AI:**
- `convex/aiWorkflows.ts composeAssist`
- `app/(app)/inbox/compose-sheet.tsx AIAssistBar`

**Today briefing:**
- `convex/dailyBriefings.ts` + `dailyBriefingsHelpers.ts`
- `convex/crons.ts` — 3x/day
- `app/(app)/today/page.tsx`

**Fit scoring:**
- `convex/aiWorkflows.ts` — `scoreContactFit`, `scoreCompanyFit`
- `convex/aiWorkflowHelpers.ts` — 4 helpers
- `app/(app)/contacts/page.tsx ContactRowActions`
- `app/(app)/companies/page.tsx CompanyRowActions`

**Deal nudges:**
- `convex/pipelinesActions.ts classifyRottingDeals` — daily cron
- `convex/pipelines.ts updateDealHealth`
- `app/(app)/pipelines/page.tsx DealCard`

**Notifications:**
- `convex/notifications.ts`
- `components/atlas/notification-subscriber.tsx`
- `components/atlas/app-shell.tsx` — mounts subscriber

## Migration notes

- All new schema fields are `v.optional(...)` — no data migration needed
- Cron additions are additive
- Legacy inbound format still parsed alongside `email.received` v2
- Cold outreach still uses feature-registry chains — router adoption there is future work
