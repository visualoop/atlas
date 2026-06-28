# 05 · Data Model

Convex schema. Final column names + validators live in `convex/schema.ts`. This file is the source of intent — what entities exist, how they relate, what invariants matter.

## Conventions

- All primary keys: Convex auto-generates `Id<"table">`. Never invent surrogates.
- `_creationTime` is auto-added to every row. Use it as the row's natural "appeared at" timestamp.
- Add explicit timestamp fields only when you need *semantic* time distinct from creation (`occurredAt` on `auditLog`, `signedAt` on documents, etc.)
- All money: `v.int64()` cents. **Never** floats. KES × 100.
- Soft-delete via optional `archivedAt: v.optional(v.number())` (epoch ms). Active rows have it absent.
- Every query path needs an `index`. No `.filter()` on hot paths.
- Foreign keys are `v.id("table")`. Convex doesn't enforce referential integrity — application code must.
- All mutations call `recordAudit` from `convex/lib/authHelpers.ts` so `auditLog` is the unblinking witness.
- File storage = `v.id("_storage")`. Use `ctx.storage.generateUploadUrl()` and `ctx.storage.getUrl(id)`.

## Top-level entity map

```
users (from authTables)
 └── userProfiles (1:1, Atlas extension)
 └── members (N: org memberships)
      ├── invitations (pending → joined member)
      └── workspaceMembers (N: per-workspace roles)

organizations
 └── workspaces (1:N)
      ├── pipelines → stages → deals  (Phase 5)
      ├── companies (1:N) → contacts (1:N)  (Phase 1)
      ├── conversations (1:N) → messages → attachments  (Phase 2/4)
      ├── tasks  (Phase 1)
      ├── notes  (Phase 1)
      ├── files  (Phase 1 — Convex storage Ids)
      ├── templates  (email · whatsapp · document)
      ├── documents → documentVersions → invoiceLineItems  (Phase 7a)
      ├── campaigns → sequenceSteps → enrollments  (Phase 8)
      ├── timelineEvents (polymorphic — the spine)
      ├── aiMemoryFacts  (Phase 4)
      └── (workspace settings inline on workspaces row)

Cross-cutting / org-level:
 ├── orgIntegrationKeys (encrypted Tier-1)
 ├── userPersonalKeys (encrypted Tier-2)
 ├── aiModels (registry)
 ├── aiFeatureBindings (which model for which feature, per workspace or org default)
 ├── aiUsageEvents (token + cost accounting)
 ├── paystackSubaccounts (workspace ↔ subaccount_code)
 ├── paystackCustomers (contact ↔ customer_code)
 ├── paymentRequests (invoice ↔ Paystack payment request)
 ├── paystackTransfers (outbound payouts)
 ├── webhookEvents (idempotency + raw payloads)
 ├── prospectorSearches / prospectorSearchResults / prospectorSuppressions  (Phase 3)
 ├── auditLog
 ├── _storage (Convex built-in)
 └── authTables.* (users, authSessions, authAccounts, …)
```

## Phase 0 tables (already shipped)

### Convex Auth tables (from `authTables`)

`users`, `authSessions`, `authAccounts`, `authVerificationCodes`, `authRefreshTokens`, `authVerifiers`, `authRateLimits`. Schema controlled by `@convex-dev/auth`; we never edit these directly.

### `userProfiles` — Atlas extension on top of `users`

```ts
userProfiles: defineTable({
  userId: v.id("users"),
  fullName: v.optional(v.string()),
  avatarStorageId: v.optional(v.id("_storage")),
  timezone: v.string(),                     // 'Africa/Nairobi'
  locale: v.string(),                       // 'en'
  onboardedAt: v.optional(v.number()),
  lastActiveOrgId: v.optional(v.id("organizations")),
  lastActiveWorkspaceId: v.optional(v.id("workspaces")),
}).index("by_userId", ["userId"])
```

### `organizations`

```ts
organizations: defineTable({
  name: v.string(),
  slug: v.string(),                         // 'blyss' — globally unique
  logoStorageId: v.optional(v.id("_storage")),
  metadata: v.optional(v.any()),
  archivedAt: v.optional(v.number()),
}).index("by_slug", ["slug"])
```

### `members` (user ↔ org with role)

```ts
members: defineTable({
  organizationId: v.id("organizations"),
  userId: v.id("users"),
  role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),
  invitedBy: v.optional(v.id("users")),
  joinedAt: v.number(),
})
  .index("by_org", ["organizationId"])
  .index("by_user", ["userId"])
  .index("by_org_user", ["organizationId", "userId"])
```

### `invitations`

```ts
invitations: defineTable({
  organizationId: v.id("organizations"),
  email: v.string(),                        // lowercase
  role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),
  workspaceAssignments: v.optional(
    v.array(v.object({
      workspaceId: v.id("workspaces"),
      role: v.union(v.literal("owner"), v.literal("admin"),
                    v.literal("member"), v.literal("viewer")),
    })),
  ),
  inviterId: v.id("users"),
  token: v.string(),                        // URL-safe random
  status: v.union(
    v.literal("pending"),
    v.literal("accepted"),
    v.literal("declined"),
    v.literal("revoked"),
    v.literal("expired"),
  ),
  expiresAt: v.number(),
})
  .index("by_token", ["token"])
  .index("by_org_email", ["organizationId", "email"])
  .index("by_email_status", ["email", "status"])
```

### `workspaces`

```ts
workspaces: defineTable({
  organizationId: v.id("organizations"),
  slug: v.string(),                         // 'omnix' | 'marketplace' | 'studio'
  name: v.string(),
  description: v.optional(v.string()),
  currency: v.string(),                     // 'KES' default
  timezone: v.string(),                     // 'Africa/Nairobi'
  brandColor: v.optional(v.string()),
  archivedAt: v.optional(v.number()),
})
  .index("by_org", ["organizationId"])
  .index("by_org_slug", ["organizationId", "slug"])
```

### `workspaceMembers`

```ts
workspaceMembers: defineTable({
  workspaceId: v.id("workspaces"),
  userId: v.id("users"),
  role: v.union(v.literal("owner"), v.literal("admin"),
                v.literal("member"), v.literal("viewer")),
  invitedBy: v.optional(v.id("users")),
  joinedAt: v.number(),
})
  .index("by_workspace", ["workspaceId"])
  .index("by_user", ["userId"])
  .index("by_workspace_user", ["workspaceId", "userId"])
```

### `orgIntegrationKeys` (Tier-1 — encrypted)

```ts
orgIntegrationKeys: defineTable({
  organizationId: v.id("organizations"),
  provider: v.union(
    // AI
    v.literal("gemini"), v.literal("groq"), v.literal("openrouter"),
    v.literal("mistral"), v.literal("cohere"), v.literal("cerebras"),
    v.literal("github_models"), v.literal("openai"), v.literal("anthropic"),
    v.literal("together"),
    // Comms
    v.literal("resend"), v.literal("meta_whatsapp"),
    v.literal("cloudflare_email_routing"),
    // Other
    v.literal("google_maps_places"), v.literal("paystack"),
    v.literal("docuseal"),
  ),
  label: v.string(),                        // 'Primary' default
  encryptedValue: v.string(),               // base64(iv ‖ ciphertext-with-tag)
  keyVersion: v.number(),
  lastFour: v.string(),                     // for display
  status: v.union(v.literal("active"), v.literal("rotating"), v.literal("revoked")),
  meta: v.optional(v.any()),                // provider-specific extras
  createdBy: v.optional(v.id("users")),
  rotatedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
})
  .index("by_org", ["organizationId"])
  .index("by_org_provider", ["organizationId", "provider"])
  .index("by_org_provider_label", ["organizationId", "provider", "label"])
```

Encryption: AES-256-GCM (Web Crypto in V8 runtime). The master key (`CONFIG_ENCRYPTION_KEY`) is the **only** env-stored secret. All Tier-1/2 values flow through `convex/lib/secrets.ts`.

### `userPersonalKeys` (Tier-2 — encrypted)

```ts
userPersonalKeys: defineTable({
  userId: v.id("users"),
  provider: v.union(
    v.literal("google_calendar"),
    v.literal("microsoft_calendar"),
    v.literal("personal_api"),
  ),
  encryptedValue: v.string(),
  keyVersion: v.number(),
  lastFour: v.string(),
  status: v.union(v.literal("active"), v.literal("rotating"), v.literal("revoked")),
  meta: v.optional(v.any()),
})
  .index("by_user", ["userId"])
  .index("by_user_provider", ["userId", "provider"])
```

### `auditLog` — every mutation, every decryption, every send

```ts
auditLog: defineTable({
  organizationId: v.id("organizations"),
  workspaceId: v.optional(v.id("workspaces")),
  actorId: v.optional(v.id("users")),       // null = system
  action: v.union(
    v.literal("created"), v.literal("updated"), v.literal("deleted"),
    v.literal("archived"), v.literal("restored"),
    v.literal("created_secret"), v.literal("rotated_secret"),
    v.literal("revoked_secret"), v.literal("decrypted_secret"),
    v.literal("invited_member"), v.literal("accepted_invitation"),
    v.literal("revoked_invitation"), v.literal("changed_role"),
    v.literal("sent_email"), v.literal("sent_whatsapp"),
    v.literal("ai_call"),
  ),
  resourceType: v.string(),
  resourceId: v.string(),
  before: v.optional(v.any()),
  after: v.optional(v.any()),
  reason: v.optional(v.string()),
  ip: v.optional(v.string()),
  userAgent: v.optional(v.string()),
  requestId: v.optional(v.string()),
  payload: v.optional(v.any()),
  occurredAt: v.number(),
})
  .index("by_org_time", ["organizationId", "occurredAt"])
  .index("by_resource", ["resourceType", "resourceId"])
  .index("by_actor", ["actorId"])
```

## Phase 1+ tables (sketches — finalized when their phase opens)

### `companies` + `contacts` (Phase 1)

```ts
companies: defineTable({
  workspaceId: v.id("workspaces"),
  name: v.string(),
  domain: v.optional(v.string()),
  industry: v.optional(v.string()),
  size: v.optional(v.string()),
  country: v.string(),                      // 'KE' default
  city: v.optional(v.string()),
  address: v.optional(v.string()),
  phone: v.optional(v.string()),            // E.164
  whatsapp: v.optional(v.string()),
  emailPrimary: v.optional(v.string()),
  googlePlaceId: v.optional(v.string()),
  enrichedAt: v.optional(v.number()),
  enrichmentData: v.optional(v.any()),
  source: v.string(),                       // 'manual' | 'prospector' | …
  fitScore: v.optional(v.number()),         // 0–100
  lifecycleStage: v.string(),
  ownerId: v.optional(v.id("users")),
  customFields: v.optional(v.any()),
  archivedAt: v.optional(v.number()),
})
  .index("by_workspace", ["workspaceId"])
  .index("by_workspace_lifecycle", ["workspaceId", "lifecycleStage"])
  .index("by_workspace_place", ["workspaceId", "googlePlaceId"])
  .index("by_workspace_domain", ["workspaceId", "domain"])
  .searchIndex("search", {
    searchField: "name",
    filterFields: ["workspaceId", "lifecycleStage"],
  })
```

### `timelineEvents` — the spine (Phase 1)

```ts
timelineEvents: defineTable({
  workspaceId: v.id("workspaces"),
  eventType: v.string(),                    // see enum in 02/07
  actorId: v.optional(v.id("users")),
  subjectType: v.string(),                  // 'contact' | 'company' | 'deal' | …
  subjectId: v.string(),
  relatedRefs: v.optional(v.any()),
  payload: v.optional(v.any()),
  occurredAt: v.number(),
})
  .index("by_workspace_subject", ["workspaceId", "subjectType", "subjectId", "occurredAt"])
  .index("by_workspace_occurred", ["workspaceId", "occurredAt"])
```

### `conversations` + `messages` + `attachments` (Phase 2/4)

```ts
conversations: defineTable({
  workspaceId: v.id("workspaces"),
  channel: v.union(v.literal("email"), v.literal("whatsapp"),
                   v.literal("sms"), v.literal("call")),
  externalId: v.optional(v.string()),
  subject: v.optional(v.string()),
  participantEmails: v.optional(v.array(v.string())),
  participantPhones: v.optional(v.array(v.string())),
  companyId: v.optional(v.id("companies")),
  contactIds: v.array(v.id("contacts")),
  state: v.union(v.literal("open"), v.literal("snoozed"),
                 v.literal("archived"), v.literal("pinned")),
  snoozedUntil: v.optional(v.number()),
  lastMessageAt: v.number(),
  unreadCount: v.number(),
  aiSummary: v.optional(v.string()),
  aiSummaryAt: v.optional(v.number()),
})
  .index("by_workspace_state_time", ["workspaceId", "state", "lastMessageAt"])
  .index("by_workspace_external", ["workspaceId", "channel", "externalId"])
  .index("by_company", ["companyId"])

messages: defineTable({
  conversationId: v.id("conversations"),
  direction: v.union(v.literal("inbound"), v.literal("outbound")),
  senderEmail: v.optional(v.string()),
  senderPhone: v.optional(v.string()),
  recipientEmails: v.optional(v.array(v.string())),
  recipientPhones: v.optional(v.array(v.string())),
  subject: v.optional(v.string()),
  bodyText: v.string(),
  bodyHtml: v.optional(v.string()),
  meta: v.optional(v.any()),
  status: v.string(),
  failureReason: v.optional(v.string()),
  externalId: v.optional(v.string()),
  inReplyTo: v.optional(v.string()),
  aiDrafted: v.boolean(),
  aiModel: v.optional(v.string()),
  sentAt: v.optional(v.number()),
  receivedAt: v.optional(v.number()),
  readAt: v.optional(v.number()),
})
  .index("by_conv_time", ["conversationId", "_creationTime"])
  .index("by_external", ["externalId"])

attachments: defineTable({
  messageId: v.optional(v.id("messages")),
  documentId: v.optional(v.id("documents")),
  filename: v.string(),
  contentType: v.string(),
  sizeBytes: v.number(),
  storageId: v.id("_storage"),
})
```

### `pipelines` / `stages` / `deals` (Phase 5)

Same shape as the previous SQL sketch, just expressed with `v.id` / `v.union(...)` validators and Convex indexes. Money: `v.int64()` cents.

### `aiMemoryFacts` (Phase 4)

```ts
aiMemoryFacts: defineTable({
  workspaceId: v.id("workspaces"),
  scopeType: v.union(v.literal("workspace"), v.literal("company"),
                     v.literal("contact"), v.literal("deal")),
  scopeId: v.optional(v.string()),
  fact: v.string(),
  source: v.string(),
  sourceEventId: v.optional(v.id("timelineEvents")),
  confidence: v.number(),
  supersededBy: v.optional(v.id("aiMemoryFacts")),
  expiresAt: v.optional(v.number()),
})
  .index("by_scope", ["workspaceId", "scopeType", "scopeId"])
  .vectorIndex("by_embedding", {
    vectorField: "embedding",
    dimensions: 768,                        // Gemini text-embedding-004
    filterFields: ["workspaceId", "scopeType"],
  })
```

### Search index (Phase 1 universal search)

Convex's `searchIndex` is full-text only. For semantic search we layer a `vectorIndex` on the same table. We define them per-resource (companies, contacts, messages, notes, documents) rather than a single universal index, because Convex requires the searched fields to live on the same document.

## Critical invariants

1. **Every mutation calls `recordAudit`** — enforced by Go-style code review + a test that asserts each mutation file has at least one `recordAudit` call.
2. **All money is `v.int64()` cents.** Tax math is integer cents in code; we store the rounded result.
3. **Soft-deleted rows are filtered by default.** Helper `whereActive()` on every list query.
4. **`workspaceId` is on every workspace-scoped table.** Every query is row-level filtered by workspace.
5. **All indexes named with `by_…` prefix** (`by_org`, `by_workspace_subject`, etc.).
6. **No `.filter()` on hot paths.** Use indexes. `.filter()` is allowed only for tiny lookups.
7. **No raw `any` in payloads except `v.any()` on `metadata` / `payload` / `meta` columns** that genuinely hold variable shapes. New typed tables prefer explicit validators.
8. **Tier-1/2 `encryptedValue` is never returned to clients.** Internal queries only.

## Migration strategy

- `npx convex deploy` (or `npx convex dev` while developing) pushes schema diffs. Convex calls these "schema migrations."
- Renames / type changes that aren't compatible require a data migration: write an `internalMutation` that backfills, run it via the dashboard, then drop the old field in a follow-up deploy.
- Never edit the meaning of a field in place once data flows through it; add a new field, migrate, drop.
