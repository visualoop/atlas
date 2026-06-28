# 08 · AI Gateway

The single substrate every AI feature in Atlas talks to. Provider-agnostic, free-tier-first, admin-configurable. Designed so adding a new provider is one adapter file + one row in `ai_models`, no code changes anywhere else.

## The architecture in one diagram

```
        ┌──────────────────────────────────────────┐
Feature │  draftReply, summarizeThread, classify,  │
code    │  research, digest, generate, critique,   │
        │  …                                       │
        └──────────────────┬───────────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────────────┐
        │  lib/ai/gateway.ts                       │
        │  ai.chat(...)  ai.classify(...)          │
        │  ai.summarize(...)  ai.embed(...)        │
        └──────────────────┬───────────────────────┘
                           │
            ┌──────────────┴──────────────┐
            ▼                             ▼
  ┌──────────────────────┐    ┌──────────────────────┐
  │ Resolver              │    │ Telemetry            │
  │ workspace + feature   │    │ ai_usage_events      │
  │ → AIFeatureBinding    │    │ tokens, cost, latency│
  │ → primary model       │    │ status, fallback     │
  │ → fallback chain      │    │                      │
  └──────────┬────────────┘    └──────────────────────┘
             │
             ▼
  ┌─────────────────────────────────────────────────┐
  │  Vercel AI SDK v6                                │
  │  generateText / streamText / generateObject      │
  │  + tools, streaming, structured output           │
  └──────────┬──────────────────────────────────────┘
             │
   ┌─────────┼──────────┬──────────┬──────────┬────────┐
   ▼         ▼          ▼          ▼          ▼        ▼
 Gemini   Groq    OpenRouter  Mistral  Cohere  …more
  ▲         ▲          ▲          ▲          ▲
  └─────────┴──────────┴──────────┴──────────┘
       org_integration_keys (encrypted Tier 1)
       lib/secrets/org.ts → decrypted per-call
```

## Public API — what feature code calls

```ts
// lib/ai/gateway.ts

interface ChatRequest {
  workspaceId: string;
  feature: AIFeature;
  messages: CoreMessage[];
  system?: string;
  tools?: ToolSet;
  maxTokens?: number;
  temperature?: number;
}

interface ChatResponse {
  text: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'length' | 'tool-calls' | 'error';
  usage: { input: number; output: number; cost: number };
  model: string;       // resolved model id
  fellBackTo?: string; // if primary failed
}

ai.chat(req: ChatRequest): Promise<ChatResponse>
ai.stream(req: ChatRequest): AsyncIterable<ChatStreamChunk>
ai.classify<T>(req: ClassifyRequest<T>): Promise<T>      // structured output via Zod
ai.summarize(req: SummarizeRequest): Promise<string>
ai.embed(text: string, opts?: { feature?: 'search_index' }): Promise<number[]>
```

Feature code never sees provider keys. Feature code passes `workspaceId` and `feature` — the gateway resolves everything else.

## AIFeature enum (the bindable list)

```ts
type AIFeature =
  | 'draft_email_reply'
  | 'draft_email_compose'
  | 'draft_whatsapp_reply'
  | 'draft_whatsapp_compose'
  | 'summarize_thread'
  | 'classify_lead_intent'
  | 'classify_lead_fit'
  | 'score_lead_readiness'
  | 'research_company'
  | 'enrich_company_from_website'
  | 'generate_daily_digest'
  | 'generate_weekly_review'
  | 'generate_monthly_forecast'
  | 'generate_document'
  | 'critique_document'
  | 'meeting_prep_brief'
  | 'meeting_summary_extract'
  | 'detect_rotting_deals'
  | 'recommend_next_action'
  | 'subject_line_optimizer'
  | 'send_time_optimizer'
  | 'pre_send_critic'
  | 'ai_qa_search'             // "what's Patricia's open project status?"
  | 'memory_fact_extract'      // pull facts from messages/meetings
  | 'embed_search_index';      // embeddings only
```

Each feature has a **default binding** ship value (set in seed data). Org Owner overrides per workspace in `Settings → AI`.

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
| `generate_weekly_review` | Gemini 2.5 Pro (if available free) | Gemini Flash | Anthropic |
| `generate_monthly_forecast` | Gemini 2.5 Flash | Groq Llama 3.3 | – |
| `generate_document` | Gemini 2.5 Flash | Anthropic Claude (if paid) | OpenRouter |
| `critique_document` | Gemini 2.5 Flash | Groq Llama 3.3 | Anthropic |
| `meeting_prep_brief` | Gemini 2.5 Flash | Groq Llama 3.3 | – |
| `meeting_summary_extract` | Gemini 2.5 Flash | Groq Llama 3.3 | – |
| `detect_rotting_deals` | Groq Llama 3.3 (cheap, internal) | Cerebras | Gemini Flash Lite |
| `recommend_next_action` | Gemini 2.5 Flash | Groq Llama 3.3 | – |
| `subject_line_optimizer` | Groq Llama 3.3 | Gemini Flash Lite | – |
| `send_time_optimizer` | Heuristic + Groq for tie-break | – | – |
| `pre_send_critic` | Gemini Flash Lite | Groq Llama 3.3 | – |
| `ai_qa_search` | Gemini 2.5 Flash + tool-use | OpenRouter | – |
| `memory_fact_extract` | Gemini Flash Lite | Groq Llama 3.3 | – |
| `embed_search_index` | Gemini text-embedding-004 | Cohere embed-v3 | – |

**Rationale:**
- Gemini 2.5 Flash is the workhorse — 1M context, free, multi-modal, great for long emails and synthesis
- Groq for speed-critical (classification, internal scoring) — 200+ tokens/sec, free tier 30 RPM / 1K RPD
- Cohere only for embeddings + rerank (specialist)
- Anthropic / OpenAI only when org explicitly pays for them (paid tier)

## Resolver behavior

```ts
async function resolveBinding(workspaceId, feature) {
  // 1. workspace override
  const wsBinding = await db.ai_feature_bindings.findFirst({
    where: { workspace_id: workspaceId, feature }
  });
  if (wsBinding) return wsBinding;

  // 2. org default
  const orgBinding = await db.ai_feature_bindings.findFirst({
    where: { org_id, feature, workspace_id: null }
  });
  if (orgBinding) return orgBinding;

  // 3. ship default (hardcoded seed)
  return SHIP_DEFAULTS[feature];
}
```

## Fallback chain logic

```
try primary model:
  if rate_limit_error: log + try next fallback
  if budget_exceeded: log + try next fallback (cheaper model)
  if provider_error_5xx: log + retry once, then next fallback
  if timeout > 30s: cancel + next fallback
  if invalid_response (Zod validation fails for classify): log + next fallback
  if success: return

if all fallbacks fail:
  record audit event 'ai_call_failed_all_providers'
  return graceful error to caller
  caller decides UI: "AI unavailable — draft manually" affordance
```

Every fallback hop records to `ai_usage_events` with `fallback_used=true`.

## Budget guards

Per workspace, per day, in `ai_feature_bindings.daily_budget_kes`. Default `null` = unlimited.

```
before each call:
  spent_today = sum(ai_usage_events.cost where workspace + day = today)
  if budget set AND spent_today + estimated_cost > budget:
    skip primary, try fallbacks in order, pick the free one
    if no free fallback: hard fail with 'budget_exceeded'
```

Budget is in KES for human-readable; conversion from USD-quoted models happens at call time using a daily-cached USD→KES rate.

## Tool registry

The gateway exposes a curated set of tools that AI workflows can call. Each tool is a typed function with a Zod input schema.

```ts
// lib/ai/tools/index.ts
export const tools = {
  // Reads
  lookupContact: tool({ /* find by email/phone/name */ }),
  lookupCompany: tool({ /* find by name/domain/place_id */ }),
  searchTimeline: tool({ /* recent events for a subject */ }),
  searchMessages: tool({ /* hybrid FTS+vector search */ }),
  webSearch: tool({ /* Brave or similar — TODO confirm provider */ }),
  webFetch: tool({ /* fetch URL, return text */ }),

  // Writes (always require user approval gate in calling feature)
  createTask: tool({ /* draft → return for approval */ }),
  draftEmail: tool({ /* draft only, no send */ }),
  draftWhatsApp: tool({ /* draft only, no send */ }),
  createNote: tool({ /* internal note, no approval needed */ }),
  recordMemoryFact: tool({ /* AI memory write */ }),
};
```

Every tool call is logged with the AI call's `request_id` so traces show which tools were used.

**Hard rule:** tools never auto-send messages, auto-move deals, or auto-spend money. They only draft + propose. The feature that wraps the AI call decides what to do with the draft.

## Encryption layer

All Tier 1 secrets (provider API keys) are stored in `org_integration_keys` encrypted with `ATLAS_MASTER_KEY`. Decryption happens in `lib/secrets/org.ts`:

```ts
export async function getOrgKey(orgId, provider): Promise<string> {
  const row = await db.org_integration_keys.findFirst({
    where: { org_id: orgId, provider, status: 'active' }
  });
  if (!row) throw new ProviderNotConfiguredError(provider);

  const masterKey = Buffer.from(env.ATLAS_MASTER_KEY, 'base64');
  const { iv, ciphertext, authTag } = parseEncrypted(row.encrypted_value);

  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  await recordAudit({
    action: 'decrypted_secret',
    resource_type: 'org_integration_key',
    resource_id: row.id,
    payload: { provider, reason: 'ai_gateway_call' },
  });

  return plain.toString('utf-8');
}
```

Decrypted values **never** leave the server process. Never serialized to a client component, never logged, never echoed in errors.

## Per-provider adapters

`lib/ai/providers/*.ts` — one file per provider, all returning the same Vercel AI SDK `LanguageModelV2` shape.

```ts
// lib/ai/providers/gemini.ts
export async function getGeminiModel(orgId, modelId: string) {
  const apiKey = await getOrgKey(orgId, 'gemini');
  const provider = createGoogleGenerativeAI({ apiKey });
  return provider.languageModel(modelId);
}

// lib/ai/providers/groq.ts (OpenAI-compatible)
export async function getGroqModel(orgId, modelId: string) {
  const apiKey = await getOrgKey(orgId, 'groq');
  const provider = createOpenAICompatible({
    name: 'groq',
    apiKey,
    baseURL: 'https://api.groq.com/openai/v1',
  });
  return provider.languageModel(modelId);
}

// lib/ai/providers/openrouter.ts
export async function getOpenRouterModel(orgId, modelId: string) {
  const apiKey = await getOrgKey(orgId, 'openrouter');
  const provider = createOpenAICompatible({
    name: 'openrouter',
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    headers: { 'HTTP-Referer': env.NEXT_PUBLIC_APP_URL },
  });
  return provider.languageModel(modelId);
}

// etc.
```

`lib/ai/gateway.ts` has a dispatch:

```ts
function getModel(orgId, model: AIModel) {
  switch (model.provider) {
    case 'gemini': return getGeminiModel(orgId, model.model_id);
    case 'groq': return getGroqModel(orgId, model.model_id);
    case 'openrouter': return getOpenRouterModel(orgId, model.model_id);
    case 'mistral': return getMistralModel(orgId, model.model_id);
    case 'cohere': return getCohereModel(orgId, model.model_id);
    case 'cerebras': return getCerebrasModel(orgId, model.model_id);
    case 'github_models': return getGitHubModelsModel(orgId, model.model_id);
    case 'together': return getTogetherModel(orgId, model.model_id);
    case 'openai': return getOpenAIModel(orgId, model.model_id);
    case 'anthropic': return getAnthropicModel(orgId, model.model_id);
  }
}
```

## Model registry (seeded)

The `ai_models` table is seeded at deploy time with the current free-tier and key paid models. Operator updates the registry via migration when models change.

Examples (partial):

```
gemini · gemini-2.5-flash      · {chat, tools, json_mode, vision, long_context} · 1M ctx · free
gemini · gemini-2.5-pro        · {chat, tools, json_mode, vision, long_context} · 1M ctx · free
gemini · gemini-2.5-flash-lite · {chat, tools, json_mode}                       · 1M ctx · free
gemini · text-embedding-004    · {embedding}                                    · -     · free

groq · llama-3.3-70b-versatile · {chat, tools, json_mode} · 128K ctx · free (30 RPM / 1K RPD)
groq · llama-3.1-8b-instant    · {chat, tools, json_mode} · 128K ctx · free
groq · whisper-large-v3-turbo  · {audio_transcription}    · -        · free

openrouter · deepseek/deepseek-chat-v3:free          · {chat} · 128K · free
openrouter · qwen/qwen3-235b-a22b:free               · {chat} · 128K · free
openrouter · meta-llama/llama-4-maverick:free        · {chat} · -    · free

mistral · mistral-large-latest          · {chat, tools, json_mode} · paid
mistral · mistral-small-latest          · {chat, tools, json_mode} · free (with phone verify)

cohere · embed-v3-multilingual          · {embedding}       · 1024d · free
cohere · rerank-v3.5                    · {rerank}          · -     · free

cerebras · llama-3.3-70b                · {chat, tools}     · 128K  · free (fast)

github_models · gpt-4o-mini             · {chat, tools}     · 128K  · free (with GH account)

together · meta-llama/Llama-3.3-70B     · {chat}            · -     · paid (trial credit)

openai · gpt-5                          · {chat, tools, json_mode, vision} · paid
openai · gpt-5-mini                     · {chat, tools, json_mode}         · paid
openai · text-embedding-3-large         · {embedding}                      · paid

anthropic · claude-sonnet-4-5           · {chat, tools, json_mode, vision} · paid
anthropic · claude-haiku-4-5            · {chat, tools, json_mode}         · paid
```

The registry shape lets the UI render "Gemini 2.5 Flash (free, 1M context, tools)" so the Owner picks intelligently.

## Settings UI (Org Owner, in `Settings → AI`)

Four tabs:

### Tab 1: Providers

List of all supported providers. Each card shows:
- Status: Not configured / Configured ✓ / Error: last call failed
- "Add key" button (or "Rotate key" if configured)
- "Test connection" button (calls a no-op endpoint per provider)
- Last successful call timestamp

When adding: form with key field, optional meta fields (e.g., WhatsApp WABA ID, Phone Number IDs). On save, key is encrypted and `last_four` stored for display. Key never displayed again.

### Tab 2: Models

Per provider, list of models from the registry. Toggle "Enabled" per model. Disabled models cannot be bound in Tab 3.

### Tab 3: Features

Table of all `AIFeature` values, each row:
- Feature name
- Description (1-line)
- Primary model dropdown (filtered by enabled + capability match)
- Fallback chain (drag-and-drop add fallback models)
- Workspace override? (toggle per workspace from a sub-row)
- Daily budget (KES) — optional
- Save

Reset-to-defaults button reverts to ship defaults.

### Tab 4: Usage

Cost dashboard:
- Today / This week / This month
- By feature (bar chart)
- By model (table with calls + tokens + cost)
- By workspace (if multiple)
- Provider quotas (current usage vs free-tier limit, refreshed daily)

## Memory facts

AI memory is `ai_memory_facts` (see `05-data-model.md`). Lifecycle:

1. **Extraction (background job after every message/meeting):** `memory_fact_extract` feature pulls facts from recent events. Saved with `source_event_id`, `confidence`.
2. **Injection (every AI call):** gateway includes top-N facts (by relevance to scope) in the system prompt. Scope = the conversation's contact + company + workspace.
3. **Supersession:** when a new fact contradicts an old one, mark old as `superseded_by` rather than delete. Audit trail preserved.
4. **Expiry:** facts with `expires_at` set (e.g., "Patricia is on leave until Nov 15") auto-drop after expiry.
5. **Manual edit:** Org Owner / Admin can edit / delete facts in the contact slide-over's "AI memory" tab.

## PII redaction policy

Configurable per workspace in `Settings → AI → Privacy`:

- **None** (default for solo founder) — full content sent to providers
- **Mask emails/phones** — replace with `[EMAIL]`/`[PHONE]` tokens before sending
- **Mask names** — replace person/company names with token placeholders
- **Strict** — strip all known PII; AI works on de-identified content

When masked tokens come back in the AI output, they're un-masked on the server before display.

## Audit + observability

- Every AI call → row in `ai_usage_events`
- Every secret decryption → row in `audit_log` (action='decrypted_secret')
- Sentry tags AI errors with `feature`, `provider`, `model`
- PostHog event `ai_workflow_used` per workflow invocation
- A `/admin/ai-health` page (Org Owner only) shows: last 24h calls, error rate per provider, fallback rate, average latency
