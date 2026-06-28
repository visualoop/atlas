# 08 · AI Gateway

The single substrate every AI feature in Atlas talks to. Provider-agnostic, free-tier-first, admin-configurable. Runs entirely inside Convex `action`s (Convex's call-out-to-the-world primitive). Adding a new provider is one adapter file + one row in `aiModels`.

## Architecture

```
        Convex query/mutation/action      Next.js Server Component
        ──────────────────┬─────────       ────────────────┬────────
                          │                                 │
                          └────────────┬────────────────────┘
                                       ▼
                          ┌──────────────────────────────────────┐
                          │  Convex action: ai.chat / ai.stream │
                          │  ai.classify / ai.summarize         │
                          │  ai.embed                            │
                          └──────────┬──────────────────────────┘
                                     │
              ┌──────────────────────┴─────────────────────────┐
              ▼                                                 ▼
   ┌────────────────────────┐                  ┌─────────────────────────┐
   │ Resolver               │                  │ Telemetry               │
   │ workspaceId + feature  │                  │ aiUsageEvents           │
   │ → aiFeatureBindings    │                  │ tokens, cost, latency,  │
   │ → primary model        │                  │ status, fallback        │
   │ → fallback chain       │                  │                         │
   └──────────┬─────────────┘                  └─────────────────────────┘
              │
              ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  Vercel AI SDK v6                                             │
   │  generateText / streamText / generateObject                   │
   │  + tools, streaming, structured output                        │
   └──────────┬───────────────────────────────────────────────────┘
              │
    ┌─────────┼──────────┬──────────┬──────────┬────────┐
    ▼         ▼          ▼          ▼          ▼        ▼
 Gemini   Groq    OpenRouter  Mistral  Cohere  …more
   ▲         ▲          ▲          ▲          ▲
   └─────────┴──────────┴──────────┴──────────┘
       orgIntegrationKeys (Tier-1, AES-GCM encrypted)
       convex/lib/secrets.ts → decrypted per-call
```

## Public API — what feature code calls

`convex/ai/gateway.ts` exposes Convex `internalAction`s that other functions call via `ctx.runAction(internal.ai.gateway.chat, …)`:

```ts
// convex/ai/gateway.ts
export const chat = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    feature: v.string(),         // AIFeature enum
    messages: v.array(/* CoreMessage validator */),
    system: v.optional(v.string()),
    toolNames: v.optional(v.array(v.string())),
    maxTokens: v.optional(v.number()),
    temperature: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // 1. Resolve workspace → feature binding
    // 2. Decrypt provider key for binding.primary.provider
    // 3. Construct Vercel AI SDK model adapter
    // 4. Call generateText with tools
    // 5. On error/rate-limit/budget-exceed → next fallback in chain
    // 6. Log to aiUsageEvents
    // 7. Return { text, toolCalls, usage, model, fellBackTo? }
  },
});

// Similar:
export const stream = internalAction({ ... });    // streaming chat
export const classify = internalAction({ ... });  // structured Zod schema output
export const summarize = internalAction({ ... });
export const embed = internalAction({ ... });
```

Feature code never sees provider keys. Feature code passes `workspaceId` + `feature`; the gateway resolves everything else.

## `AIFeature` enum (the bindable list)

```ts
type AIFeature =
  | "draft_email_reply"
  | "draft_email_compose"
  | "draft_whatsapp_reply"
  | "draft_whatsapp_compose"
  | "summarize_thread"
  | "classify_lead_intent"
  | "classify_lead_fit"
  | "score_lead_readiness"
  | "research_company"
  | "enrich_company_from_website"
  | "generate_daily_digest"
  | "generate_weekly_review"
  | "generate_monthly_forecast"
  | "generate_document"
  | "critique_document"
  | "meeting_prep_brief"
  | "meeting_summary_extract"
  | "detect_rotting_deals"
  | "recommend_next_action"
  | "subject_line_optimizer"
  | "send_time_optimizer"
  | "pre_send_critic"
  | "ai_qa_search"
  | "memory_fact_extract"
  | "embed_search_index";
```

## Default binding ship values (the free-tier sweet spot)

| Feature | Primary | Fallback 1 | Fallback 2 |
|---|---|---|---|
| `draft_email_reply` | Gemini 2.5 Flash | Groq Llama 3.3 70B | OpenRouter free |
| `draft_email_compose` | Gemini 2.5 Flash | Groq Llama 3.3 70B | OpenRouter free |
| `draft_whatsapp_reply` | Groq Llama 3.3 70B (fast) | Gemini Flash Lite | OpenRouter |
| `summarize_thread` | Gemini Flash Lite | Groq Llama 3.3 | OpenRouter |
| `classify_lead_intent` | Groq Llama 3.3 70B | Gemini Flash Lite | Cerebras |
| `classify_lead_fit` | Gemini 2.5 Flash | Groq Llama 3.3 | OpenRouter |
| `score_lead_readiness` | Groq Llama 3.3 | Cerebras | Gemini Flash Lite |
| `research_company` | Gemini 2.5 Flash (tool-use, web) | OpenRouter | Anthropic (if paid) |
| `enrich_company_from_website` | Gemini Flash Lite | Cohere | Mistral |
| `generate_daily_digest` | Gemini 2.5 Flash | Groq Llama 3.3 | OpenRouter |
| `generate_weekly_review` | Gemini 2.5 Pro | Gemini 2.5 Flash | Anthropic |
| `generate_monthly_forecast` | Gemini 2.5 Flash | Groq Llama 3.3 | – |
| `generate_document` | Gemini 2.5 Flash | Anthropic Claude (paid) | OpenRouter |
| `critique_document` | Gemini 2.5 Flash | Groq Llama 3.3 | Anthropic |
| `meeting_prep_brief` | Gemini 2.5 Flash | Groq Llama 3.3 | – |
| `meeting_summary_extract` | Gemini 2.5 Flash | Groq Llama 3.3 | – |
| `detect_rotting_deals` | Groq Llama 3.3 | Cerebras | Gemini Flash Lite |
| `recommend_next_action` | Gemini 2.5 Flash | Groq Llama 3.3 | – |
| `subject_line_optimizer` | Groq Llama 3.3 | Gemini Flash Lite | – |
| `send_time_optimizer` | Heuristic + Groq tie-break | – | – |
| `pre_send_critic` | Gemini Flash Lite | Groq Llama 3.3 | – |
| `ai_qa_search` | Gemini 2.5 Flash + tool-use | OpenRouter | – |
| `memory_fact_extract` | Gemini Flash Lite | Groq Llama 3.3 | – |
| `embed_search_index` | Gemini text-embedding-004 | Cohere embed-v3 | – |

Rationale unchanged from the original plan — Gemini Flash is the workhorse, Groq is for speed-critical, Cohere only for embeddings + rerank, paid providers only when org explicitly enables them.

## Resolver logic (inside the gateway action)

```ts
async function resolveBinding(ctx, workspaceId, feature) {
  // 1. Workspace override
  const ws = await ctx.runQuery(internal.ai.bindings.forWorkspaceFeature, {
    workspaceId, feature,
  });
  if (ws) return ws;
  // 2. Org default
  const org = await ctx.runQuery(internal.ai.bindings.forOrgFeature, {
    organizationId: workspace.organizationId, feature,
  });
  if (org) return org;
  // 3. Ship default
  return SHIP_DEFAULTS[feature];
}
```

## Fallback chain logic

```
try primary:
  rate_limit_error    → log + try next fallback
  budget_exceeded     → log + try cheapest free fallback
  provider_5xx        → log + retry once, then next fallback
  timeout > 30s       → cancel + next fallback
  invalid Zod response (classify) → log + next fallback
  success             → return

all fallbacks fail:
  emit timelineEvent { eventType: 'ai_call_failed_all_providers', … }
  return graceful error to caller — UI shows "AI unavailable — draft manually"
```

Every hop writes to `aiUsageEvents` with `fallbackUsed: true`.

## Budget guards

Per workspace, per day, in `aiFeatureBindings.dailyBudgetKes`. Default `undefined` = unlimited.

```
before each call:
  spentToday = sum(aiUsageEvents.cost where workspace + day = today)
  if budget set AND spentToday + estimatedCost > budget:
    skip primary, pick first free-tier model in fallback chain
    if no free fallback: hard fail with 'budget_exceeded'
```

Budgets are in KES (human-readable). Convert from USD-quoted models using a daily-cached USD→KES rate stored in a `aiFxRates` doc.

## Tool registry

The gateway exposes a curated set of tools. Each is a typed function with a Zod input schema. **Hard rule: tools never auto-send, auto-bill, or auto-decide.** They only draft + propose.

```ts
// convex/ai/tools/index.ts
import { tool } from "ai";
import { z } from "zod";

export const lookupContact = tool({
  description: "Find a contact by email, phone, or name.",
  parameters: z.object({ /* … */ }),
  execute: async ({ ... }, { ctx, workspaceId }) => { /* runQuery */ },
});

// Other tools: lookupCompany, searchTimeline, searchMessages,
// webSearch, webFetch, createTaskDraft, draftEmail, draftWhatsApp,
// createNote, recordMemoryFact, …
```

Tool calls log with the AI call's `requestId` so traces show which tools fired.

## Encryption layer (provider key access)

All Tier-1 secrets live in `orgIntegrationKeys`, encrypted via `convex/lib/secrets.ts`. Decryption only in trusted internal* functions:

```ts
// convex/ai/_internal.ts
export const getDecryptedProviderKey = internalQuery({
  args: { organizationId: v.id("organizations"), provider: v.string() },
  handler: async (ctx, { organizationId, provider }) => {
    const row = await ctx.db
      .query("orgIntegrationKeys")
      .withIndex("by_org_provider_label", (q) =>
        q.eq("organizationId", organizationId).eq("provider", provider).eq("label", "Primary"),
      )
      .filter((q) => q.eq(q.field("status"), "active"))
      .unique();
    if (!row) throw new ConvexError({ code: "PROVIDER_NOT_CONFIGURED", message: provider });
    const value = await decrypt(row.encryptedValue);
    await ctx.db.insert("auditLog", { /* action: decrypted_secret */ });
    return value;
  },
});
```

Decrypted values **never** leave the Convex action. Never serialized to a client component, never logged, never echoed in errors.

## Per-provider adapters

`convex/ai/providers/*.ts` — one file per provider, all returning a Vercel AI SDK `LanguageModelV2` shape:

```ts
// convex/ai/providers/gemini.ts
import { createGoogleGenerativeAI } from "@ai-sdk/google";

export async function getGeminiModel(orgId: Id<"organizations">, modelId: string) {
  const apiKey = await getDecryptedProviderKey(orgId, "gemini");
  const provider = createGoogleGenerativeAI({ apiKey });
  return provider.languageModel(modelId);
}

// convex/ai/providers/groq.ts (OpenAI-compatible)
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export async function getGroqModel(orgId, modelId) {
  const apiKey = await getDecryptedProviderKey(orgId, "groq");
  return createOpenAICompatible({
    name: "groq",
    apiKey,
    baseURL: "https://api.groq.com/openai/v1",
  }).languageModel(modelId);
}
```

The gateway has a dispatcher switch on `model.provider`.

## Model registry (seeded)

`aiModels` table seeded at deploy via a one-shot `internalMutation` that's idempotent on `(provider, modelId)`. Operator updates by changing the seed file and re-running.

```
gemini · gemini-2.5-flash      · {chat, tools, json_mode, vision, long_context} · 1M ctx · free
gemini · gemini-2.5-pro        · {chat, tools, json_mode, vision, long_context} · 1M ctx · free
gemini · gemini-2.5-flash-lite · {chat, tools, json_mode}                       · 1M ctx · free
gemini · text-embedding-004    · {embedding}                                    · -     · free

groq · llama-3.3-70b-versatile · {chat, tools, json_mode} · 128K ctx · free (30 RPM / 1K RPD)
groq · llama-3.1-8b-instant    · {chat, tools, json_mode} · 128K ctx · free
groq · whisper-large-v3-turbo  · {audio_transcription}    · -        · free

openrouter · deepseek/deepseek-chat-v3:free    · {chat} · 128K · free
openrouter · qwen/qwen3-235b-a22b:free         · {chat} · 128K · free
openrouter · meta-llama/llama-4-maverick:free  · {chat} · -    · free

mistral · mistral-small-latest                 · {chat, tools, json_mode} · free (with phone verify)
mistral · mistral-large-latest                 · {chat, tools, json_mode} · paid

cohere · embed-v3-multilingual                 · {embedding}       · 1024d · free
cohere · rerank-v3.5                           · {rerank}          · -     · free

cerebras · llama-3.3-70b                       · {chat, tools}     · 128K  · free (fast)

github_models · gpt-4o-mini                    · {chat, tools}     · 128K  · free (with GH account)

together · meta-llama/Llama-3.3-70B            · {chat}            · -     · paid (trial credit)

openai · gpt-5                                 · {chat, tools, json_mode, vision} · paid
anthropic · claude-sonnet-4-5                  · {chat, tools, json_mode, vision} · paid
```

## Settings UI (Org Owner, `/settings/integrations` + `/settings/ai`)

Four tabs under AI settings:

1. **Providers** — cards with Status + Last call + Add key/Rotate key. Form encrypts via `convex/lib/secrets.ts`, stores `lastFour`. Key never displayed again.
2. **Models** — toggle "Enabled" per model from the registry. Disabled models can't be bound.
3. **Features** — table of all `AIFeature` values; primary model dropdown + fallback chain drag-and-drop + per-workspace override + daily KES budget. Reset-to-defaults button.
4. **Usage** — cost dashboard: today / this week / this month; by feature; by model; by workspace; provider quotas (current vs free-tier limit, refreshed daily by cron).

## Memory facts

`aiMemoryFacts` (schema in 05). Lifecycle:

1. **Extraction** (background cron after messages/meetings): `memory_fact_extract` pulls facts from recent events; saved with `sourceEventId`, `confidence`.
2. **Injection** (every AI call): gateway includes top-N facts (by relevance via vector search) in the system prompt. Scope = the conversation's contact + company + workspace.
3. **Supersession**: new fact contradicts old → mark `supersededBy`. Audit trail preserved.
4. **Expiry**: `expiresAt` auto-drops a fact ("on leave until Nov 15").
5. **Manual edit** in the contact slide-over's "AI memory" tab.

## PII redaction policy

`workspaces.aiPiiPolicy` (Phase 4 addition):

- **`none`** — full content sent (default for solo founder)
- **`mask_contacts`** — replace emails/phones with `[EMAIL]`/`[PHONE]`
- **`mask_names`** — replace person/company names with token placeholders
- **`strict`** — strip all known PII

Tokens are un-masked server-side before display.

## Audit + observability

- Every AI call → row in `aiUsageEvents`
- Every secret decryption → row in `auditLog` (`action='decrypted_secret'`)
- Sentry tags AI errors with `feature`, `provider`, `model`
- PostHog event `ai_workflow_used` per workflow invocation
- `/admin/ai-health` page (Org Owner only): last 24h calls, error rate per provider, fallback rate, avg latency
