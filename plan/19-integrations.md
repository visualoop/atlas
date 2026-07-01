# 19 · Integrations & Automation

Atlas's "connect to everything else" story. Instead of building N-per-N integrations by hand, we adopt **Composio** as the integration platform: 1,000+ apps / 3,000+ tools behind a single MCP endpoint (or SDK), with OAuth managed by Composio, first-class Vercel AI SDK adapter, and dynamic just-in-time tool loading so the AI's context window doesn't drown.

**We do not use Zapier.** Composio replaces every Zapier-style workflow, and does so through AI-native primitives that fit our stack.

## Why Composio and not Zapier

| Concern | Zapier | Composio |
|---|---|---|
| Positioning | 2010s no-code triggers/actions between SaaS | 2020s AI-agent-native integration platform |
| Primitive | Zap = trigger + action | Toolkit = auth + tools exposed as callable functions to an LLM |
| Auth handling | Per Zap, per user | Centralized, delegated OAuth, one connection per user per app |
| Cost model | Per-task pricing that scales with volume | Free tier for developers; per-user or per-app tiers for production |
| Fits our AI gateway | Not really — Zapier is a UI product | Yes — Composio exposes tools directly to Vercel AI SDK / MCP |
| Long tail apps | Broad but stale | 20K+ tools across 1000+ apps, actively maintained |

Composio is the right primitive for Atlas because **the automation surface is AI-native by design**. The founder doesn't build a Zap; they say to the ⌘J Copilot "when a new contact enters Warm, add them to my HubSpot too and send me a Slack ping" and Atlas orchestrates it via Composio tools + the AI gateway.

## What Composio brings to Atlas

- **OAuth handling** for hundreds of apps (Gmail, Slack, GitHub, Notion, HubSpot, Salesforce, Linear, Jira, Asana, Trello, Airtable, Google Drive, Dropbox, Google Calendar, Microsoft 365, Discord, Telegram, and so on)
- **Dynamic tool loading** — LLMs load only the tools they need, so the AI gateway's context window stays lean
- **Sandboxed workbench** — Composio runs tool calls in isolated environments; safer than executing arbitrary user-defined workflows in our own process
- **First-class SDK for Vercel AI SDK** — plug directly into our existing `convex/ai/gateway.ts`
- **MCP endpoint** — same tools also usable from Claude Code, Cursor, OpenCode, etc., outside Atlas
- **Programmatic tool calling** — Composio can write orchestration code in a remote workbench to handle multi-step chains without to-and-fro with the LLM

## What Atlas builds natively vs delegates to Composio

**Native** (owned by Atlas end-to-end):
- Resend outbound + inbound
- Meta WhatsApp Cloud API
- Facebook Pages / Instagram Business / LinkedIn (the four platforms we ship in Phase 8a)
- Google Places API (Prospector)
- Paystack full-stack
- Google Calendar / Microsoft Calendar OAuth (Phase 10 — user-level Tier-2 secrets)
- DocuSeal (self-hosted on our cluster)
- The AI providers themselves (Gemini, Groq, OpenRouter, etc.)

These are core to Atlas's identity — reliability, cost control, and workspace-scoped auth flows justify owning them.

**Composio** (delegate everything else):
- HubSpot / Salesforce / Pipedrive (if a founder needs to sync Atlas with their old CRM)
- Google Drive / Dropbox / OneDrive (file sync)
- Slack / Discord / Telegram (team notifications)
- GitHub / GitLab (dev workflow triggers for Blyss Studio)
- Notion / Airtable / Google Sheets (data export / import)
- Linear / Jira / Trello (project management sync)
- Twitter/X, TikTok, YouTube publishing (until we build native)
- Every other long-tail SaaS

Rule of thumb: **if it's on the critical path of a phase we're shipping, we build native. If it's a nice-to-have connector, Composio handles it.**

## Data model

```ts
// Per-org connection to Composio itself
composioConfig: defineTable({
  organizationId: v.id("organizations"),
  encryptedApiKey: v.string(),           // Tier-1 secret
  enabledToolkits: v.array(v.string()),   // ['github', 'slack', 'notion', …]
  createdBy: v.id("users"),
  archivedAt: v.optional(v.number()),
}).index("by_org", ["organizationId"]),

// Per-user OAuth connections through Composio
composioConnections: defineTable({
  workspaceId: v.id("workspaces"),
  userId: v.id("users"),
  toolkit: v.string(),                    // 'github' | 'slack' | 'notion' | …
  composioAccountId: v.string(),          // Composio's connection ref
  displayName: v.string(),                // "Justine's GitHub"
  status: v.union(
    v.literal("active"),
    v.literal("expired"),
    v.literal("revoked"),
  ),
  scopes: v.array(v.string()),
  connectedAt: v.number(),
  lastUsedAt: v.optional(v.number()),
})
  .index("by_workspace_toolkit", ["workspaceId", "toolkit"])
  .index("by_user_toolkit", ["userId", "toolkit"]),
```

## Integration in the AI gateway

Composio's Vercel AI SDK adapter plugs directly into our tool registry:

```ts
// convex/ai/tools/composio.ts
import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";

export async function getComposioTools(
  ctx: ActionCtx,
  organizationId: Id<"organizations">,
  userId: Id<"users">,
  toolkits: string[],
) {
  const apiKey = await getOrgKey({
    ctx, organizationId,
    provider: "composio",
    reason: "ai_gateway_tools",
  });

  const composio = new Composio({
    apiKey: apiKey.value,
    provider: new VercelProvider(),
  });

  // Fetch just the tools we need for this call
  const tools = await composio.tools.get(
    userId, { toolkits },
  );

  return tools;
}
```

Feature code:

```ts
const composioTools = await getComposioTools(ctx, orgId, userId, ["gmail", "notion"]);

const result = await generateText({
  model: geminiFlash,
  tools: { ...atlasNativeTools, ...composioTools },
  messages,
});
```

The AI gateway picks up Composio tools alongside our native tools. Cross-app orchestration Just Works from within a Convex action.

## Native automation builder (uses Composio under the hood)

Even with Composio, we ship a **native automation builder** for the founder — a no-code IFTTT-style UI that reads much better than "write a prompt to the copilot" for high-value recurring workflows.

```ts
automations: defineTable({
  workspaceId: v.id("workspaces"),
  name: v.string(),                       // "When contact turns Warm, post to LinkedIn"
  description: v.optional(v.string()),
  trigger: v.object({
    kind: v.string(),                     // 'contact_lifecycle_changed' | 'deal_stage_changed' | 'schedule' | 'webhook_received' | 'social_comment_received' | 'inbound_email_matched' | …
    config: v.any(),                      // trigger-specific
  }),
  conditions: v.array(v.object({
    kind: v.string(),                     // 'field_equals' | 'has_tag' | 'ai_classifies_as' | …
    config: v.any(),
  })),
  actions: v.array(v.object({
    kind: v.string(),                     // 'send_email_template' | 'create_task' | 'compose_social_post' | 'run_composio_tool' | 'run_ai_workflow' | …
    config: v.any(),
  })),
  status: v.union(v.literal("draft"), v.literal("active"), v.literal("paused")),
  runsCount: v.number(),
  failuresCount: v.number(),
  lastRunAt: v.optional(v.number()),
  authorId: v.id("users"),
})
  .index("by_workspace_status", ["workspaceId", "status"]),

automationRuns: defineTable({
  automationId: v.id("automations"),
  workspaceId: v.id("workspaces"),
  triggerPayload: v.any(),
  status: v.union(v.literal("running"), v.literal("succeeded"), v.literal("failed"), v.literal("skipped_conditions")),
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
  error: v.optional(v.string()),
  actionResults: v.array(v.any()),
})
  .index("by_automation", ["automationId"])
  .index("by_workspace_recent", ["workspaceId", "startedAt"]),
```

### Trigger sources

- `timelineEvents` — anything on the spine can trigger an automation
- Convex `scheduler.runAfter` — for scheduled triggers
- `httpAction` at `/webhook/inbound/<id>` — for inbound webhook triggers
- `crons.cron` — for recurring schedules

### Action registry

- **Native actions**: send email template, create task, compose social post, advance deal stage, tag contact, run AI workflow, send WhatsApp template, generate invoice from template
- **Composio actions**: any tool in Composio's registry — "post to Slack #sales-wins", "create Notion page", "add row to Google Sheets", "create GitHub issue"

### UI

Node-based builder in `/automations`:

```
[Trigger: contact_lifecycle_changed to='warm']
      │
      ▼
[Condition: tag contains 'pharmacy']
      │
      ▼
[Action 1: create task "Draft outreach"]
[Action 2: compose social post via generate_social_post]
[Action 3: post to Slack #sales via Composio]
```

Templates library: pre-built automations founders can enable in one click:
- "New contact from Prospector → Enrich company → Draft outreach"
- "Won deal → Auto-generate case study → Post to LinkedIn"
- "Overdue invoice → M-PESA reminder → Slack notification"
- "New social mention (positive) → Reply draft → Turn into testimonial"

## Public API (Phase 12)

For advanced users, Atlas exposes a public REST API + webhook subscriptions so external tools (or scripts) can:

- Read contacts / companies / deals / conversations
- Create tasks / notes
- Trigger AI workflows
- Subscribe to webhook events (`deal.won`, `contact.created`, etc.)

Auth via Better Auth's API Key plugin — pattern already established but not yet wired.

## Security notes

- Composio API key is a Tier-1 org secret, encrypted at rest with the AES-GCM helper
- Per-user Composio connections are Tier-2 secrets (each user OAuths themselves)
- Automation runs are audit-logged in `automationRuns` with full payload
- Failed automations retry with exponential backoff (max 3 attempts), then land in a dead-letter queue for founder review
- Rate limiting: max 100 automation runs per workspace per hour (configurable)

## Cost model

Composio has a free tier for developers (per their pricing). For production at Atlas's scale, we expect to move to a paid tier once we exceed the free quotas. Same "start free, pay when we grow" pattern as every other tier-0/tier-1 provider.

## What comes together

The full stack looks like:

```
Founder types in ⌘J: "when a contact turns Warm, add them to
                       HubSpot and post a LinkedIn announcement"

  ▼
AI gateway (Groq Compound / Gemini Flash) understands intent
  ▼
Generates an `automations` row with:
  - Trigger: contact_lifecycle_changed → warm
  - Action 1: Composio.hubspot.create_contact
  - Action 2: run_ai_workflow generate_social_post → LinkedIn
  ▼
Founder previews + confirms
  ▼
Automation is active — Convex `timelineEvents` writes trigger
`automationRuns`, actions execute (native or via Composio)
```

This is the ⌘J copilot fulfilling its promise: the founder speaks a workflow into existence, Atlas orchestrates it end-to-end.
