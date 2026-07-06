# Atlas AI Architecture

Atlas is a founder's operating system with a unified AI agent
running under it. Every AI feature — reply drafts, cold outreach,
briefings, per-page recommendations, newsletter drafts, social
posts, fit scoring, deal nudges, Copilot — is built on the same
four foundations.

## The four foundations

### 1. Persona harness (`convex/lib/agentPersona.ts`)

One function, `buildAgentSystem(persona, role)`, is the single
source of every AI system prompt. It emits six blocks in order:

- **Identity** — who the assistant is (default "Atlas", per-workspace
  configurable), who the founder is (first name from users table),
  what workspace they run.
- **Business** — one-liner, offerings, ideal customer, pricing,
  currency, timezone. Any blank field is omitted.
- **Voice** — brand voice from settings, plus a hard ban on AI-slop
  patterns ("delve", "leverage", "hope this finds you", em-dashes as
  filler, etc.).
- **Grounding rules** — forbid inventing names, numbers, or
  teammates. Solo founders never get "assign to Alex".
- **Perspective** — role-specific. `email_reply` says "you're the
  seller, replying as ${firstName}." `email_cold` says "you're
  drafting from ${workspaceName} to a prospect." Each role has its
  own perspective. See `PROMPT_MAP.md` for every one.
- **Output** — role-specific format contract (JSON schema, Markdown,
  plain body, etc.).

Roles: `email_reply`, `email_cold`, `whatsapp_cold`, `whatsapp_reply`,
`briefing`, `compose_assist`, `fit_score`, `deal_analyst`,
`copilot_chat`, `newsletter_draft`, `social_post`, `content_idea`,
`campaign_personalize`, `analytics_summary`, `general`.

Every AI feature calls this. Fixed for good the class of bug where
one feature had one identity and another had a different one.

### 2. Task-aware model routing (`convex/ai/router.ts`)

`pickModelChain(taskCategory, options)` returns an ordered fallback
chain of `{provider, model, ...}` steps. Task categories map to
model preferences: `chat_agentic` prefers Claude Sonnet or GPT-4o,
`extract_json` prefers Gemini Flash, `long_context` prefers
Gemini 1.5 Pro.

Chain filter is `providersFromKeys(workspaceKeys)` — only providers
the workspace actually configured are eligible. The chain always
ends with `openrouter/auto` as a universal safety net if the
workspace has OpenRouter.

### 3. Long-term memory (`convex/workspaceKnowledge.ts`)

A `workspaceKnowledge` table stores atomic facts about contacts,
companies, deals, or the workspace itself. Every write is
subject-scoped (e.g. `subjectType: "contact", subjectId: "..."`)
and carries confidence + freshness fields.

Two write paths:

- **Auto-extract** — every inbound message body is scheduled through
  `extractFactsFromMessage` (2s after ingest). The model returns up
  to 5 atomic facts as JSON (`"Prefers WhatsApp over email"`,
  `"Uses Kimton POS today"`, etc.). Dedupe on write bumps
  `lastVerifiedAt` instead of creating duplicates.
- **Manual** — `remember` mutation. Copilot can call this via a tool
  in future. Users can call it directly.

One read path: `retrieveInternal(workspaceId, subjectType, subjectId, limit)`
returns the top-N most recently verified facts. Retrofits like
`draftEmailReply` call this before building the prompt and inject a
`# What you already know` block into the system prompt.

### 4. Proactive per-page agents (`convex/pageAgents.ts`)

Instead of surfacing "count of X, count of Y" on each list page,
Atlas surfaces **verdicts**:

- `/contacts` → "AI · Reach out to these first" with three cards
- `/companies` → same shape
- `/pipelines` → "AI · Save these deals today" — three deals ranked
  by worst health + oldest idle
- `/today` → "Do these next" — three specific moves, each with a
  deep-link to the record

Every ranker action loads the persona harness, hands the model a
list of real record ids + fields, and asks for 3 picks with a
one-sentence "why". The response is validated against the input id
set so the model can't invent records.

## How the pieces fit

```
                                       ┌──────────────────────┐
                                       │  workspaceKnowledge  │
                                       │   (fact retrieval)   │
                                       └──────────┬───────────┘
                                                  │
                                                  ▼
   User action  ──►  Feature action  ──►  buildAgentSystem(persona, role)
   (compose,          (draftEmailReply,       │
    score fit,         composeAssist,         ├─►  ai/runFeature
    draft cold,        scoreContactFit,       │      │
    newsletter,        rankDealsToSaveToday,  │      ├─► pickModelChain(taskCategory)
    ...)               draftNewsletter, ...)  │      │      │
                                              │      │      ▼
                                              │      │   Groq/Gemini/Cerebras/
                                              │      │   OpenAI/Anthropic/OpenRouter
                                              │      │
                                              │      ▼
                                              │   Response
                                              ▼
                                    Result (grounded, persona-consistent)
```

## Feature index

| Feature | Role | File |
|---|---|---|
| Reply draft (email) | `email_reply` | `convex/aiWorkflows.ts` |
| Reply draft (WhatsApp) | `whatsapp_reply` | `convex/aiWorkflows.ts` |
| Cold email | `email_cold` | `convex/coldOutreach.ts` |
| Cold WhatsApp | `whatsapp_cold` | `convex/coldOutreach.ts` |
| Auto-draft on inbound | `email_reply` | `convex/aiWorkflows.ts draftEmailReply` |
| Auto-draft on prospect import | `email_cold` | `convex/coldOutreach.ts autoDraftForCompany` |
| Fact extraction from inbound | `extract_json` featureId | `convex/aiWorkflows.ts extractFactsFromMessage` |
| Compose assist | `compose_assist` | `convex/aiWorkflows.ts` |
| Fit score (contact) | `fit_score` | `convex/aiWorkflows.ts` |
| Fit score (company) | `fit_score` | `convex/aiWorkflows.ts` |
| Rotting deal classifier | `deal_analyst` | `convex/pipelinesActions.ts` |
| Daily briefing | `briefing` | `convex/dailyBriefings.ts` |
| Copilot chat | `copilot_chat` | `app/api/copilot/route.ts` + `convex/copilotAgent.ts` |
| Contacts picks bar | `general` + hint | `convex/pageAgents.ts rankContactsForOutreach` |
| Companies picks bar | `general` + hint | `convex/pageAgents.ts rankCompaniesForOutreach` |
| Pipelines picks bar | `deal_analyst` + hint | `convex/pageAgents.ts rankDealsToSaveToday` |
| Today "Do these next" | `briefing` + hint | `convex/pageAgents.ts rankTodayActions` |
| Newsletter draft | `newsletter_draft` | `convex/publisherAI.ts` |
| Social post draft | `social_post` | `convex/publisherAI.ts` |
| Content ideas | `content_idea` | `convex/publisherAI.ts` |
| Analytics summary | `analytics_summary` | `convex/publisherAI.ts` |

## Grounding contract

Every AI feature meets these three grounding rules. If any is
violated, that's a bug to fix, not to tolerate:

1. **No invented names.** If a briefing has zero rotting deals, it
   must not mention rotting deals. If contacts has 2 people, the
   ranker skips the model and returns them directly. Empty data →
   canned message, never invented data.
2. **No invented teammates.** The grounding block in the harness
   says the founder works alone. No AI feature should say "assign
   to Alex" or "loop in your marketing lead" unless the workspace
   actually has multiple members.
3. **Correct perspective.** The founder is the seller. Reply drafts,
   cold outreach, newsletters, social posts — all speak as the
   workspace, not as the recipient. If the model outputs the
   opposite (as happened before the harness), that's the
   perspective block failing.

## Self-echo detection

Two layers stop the assistant replying to itself:

1. **At ingest** — `emails.ingestInbound` checks the sender email
   against workspace `senderIdentities`. If it matches, the message
   never becomes a conversation (`status: "self_echo"`).
2. **At draft time** — `draftEmailReply` also checks `ownAddresses`
   returned by the session-less loader. Even if a message got
   through ingest, the drafter still skips it and returns
   `skipped: "self_echo"`.

## Convex runtime split

- Files with `"use node"` at top run in Node. Can `fetch`, use
  crypto, do I/O. Only host `action` / `internalAction`.
- Files without run in V8. Host `query` / `mutation` /
  `internalQuery` / `internalMutation`. No `await import(...)`.
- V8 files can import pure utilities from Node files as long as
  the utility isn't tree-shaken through a Node-only path. In
  practice: `agentPersona.ts` is V8 (no I/O), so both Node and V8
  callers import it freely.

Query and mutation splits (e.g. `coldOutreach.ts` Node ↔
`coldOutreachQueries.ts` V8, `pageAgents.ts` Node ↔
`pageAgentsHelpers.ts` V8) exist because Convex won't let you
export a query from a Node module.

## Verification checklist

Every deploy should pass these smoke tests. See
`docs/PROMPT_MAP.md` for the exact prompt each role generates so
you can eyeball whether the model got what it should have.

- [ ] Send yourself an email from a workspace sender identity to
  your personal inbox → should be dropped as `self_echo` at ingest,
  no conversation created.
- [ ] Send yourself an email from a personal Gmail to your
  workspace address → should ingest, auto-draft, and the draft
  should reply *as you the seller* not *as the buyer*.
- [ ] Delete a conversation with the Trash button → conversation +
  messages + attachments + storage blobs all gone.
- [ ] Open `/today` with an empty workspace → shows canned
  briefing, no invented names, no "assign to Alex".
- [ ] Open `/today` with real data → briefing mentions actual
  record names + counts. "Do these next" shows three moves that
  link to real records.
- [ ] Open `/contacts` with 4+ contacts → AI picks bar renders
  three cards with specific reasons + working "Draft outreach"
  buttons.
- [ ] Open `/pipelines` → picks bar surfaces worst-health deals
  with reasons matching the daily-cron `aiNextAction`.
- [ ] Copilot chat sidebar → "help me draft a reply to Kimton"
  should never invent Kimton if it doesn't exist; if it does exist,
  the reply should be grounded in `workspaceKnowledge` facts.
- [ ] Draft cold outreach on a prospect → subject + body speak as
  the workspace to the prospect, not the other way around.

## Roadmap

- **Copilot memory tool** — expose `remember` as a Copilot tool so
  the chat interface can write facts.
- **Memory retrieval on cold outreach + fit scoring** — currently
  only reply drafts read from `workspaceKnowledge`; the other
  features should too.
- **Publisher UI** — `/content`, `/social`, `/campaigns`,
  `/analytics` need to actually call the new `publisherAI`
  actions.
- **Prospector picks bar** — same pattern for prospector results,
  ranking by fit + reachability.
- **Outreach queue picks bar** — batches by shared context.
- **Memory management UI** — `/settings/memory` to browse/edit/forget
  the workspace's stored facts.
