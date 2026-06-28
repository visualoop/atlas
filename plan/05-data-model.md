# 05 · Data Model

Drizzle schema sketch. Final column names + types live in `db/schema/*.ts`. This file is the source of intent — what entities exist, how they relate, what invariants matter.

## Conventions

- All primary keys: `uuid` (v4), generated server-side
- All timestamps: `timestamptz` (UTC ISO 8601)
- Soft-delete: `deleted_at timestamptz null` instead of physical delete
- Money: `numeric(20, 4)` with parallel `currency text` column (ISO 4217)
- All tables have: `id`, `created_at`, `updated_at`, optionally `deleted_at`
- Audit fields where applicable: `created_by uuid`, `updated_by uuid`
- All foreign keys have ON DELETE behavior explicitly chosen (cascade for owned-by, restrict otherwise)
- All indexes named explicitly (`idx_<table>_<columns>`)

## Top-level entity map

```
organizations (Better Auth)
 └── memberships (user ↔ org with role)
     └── invitations
 └── workspaces
      ├── workspace_members (user ↔ workspace with role)
      ├── pipelines → stages → deals
      ├── companies ←─── org_companies (cross-workspace link)
      │    └── contacts
      ├── conversations → messages
      │    └── attachments
      ├── tasks
      ├── notes
      ├── files
      ├── templates (email · whatsapp · document)
      ├── documents → document_versions
      ├── invoices ─→ payment_requests (Paystack)
      ├── campaigns → sequence_steps → enrollments
      ├── timeline_events (polymorphic)
      ├── ai_memory_facts
      └── workspace_settings

Cross-cutting / org-level:
 ├── org_integration_keys (encrypted Tier 1 secrets)
 ├── user_personal_keys (encrypted Tier 2 secrets)
 ├── ai_models (registry: provider + model_id + capabilities + cost)
 ├── ai_feature_bindings (which model for which feature, per workspace)
 ├── ai_usage_events (token + cost accounting)
 ├── paystack_subaccounts (workspace ↔ Paystack subaccount_code)
 ├── audit_log
 ├── jobs (pg-boss internal)
 └── search_index (FTS + pgvector embeddings)
```

## Auth tables (managed by Better Auth, do not hand-edit)

Better Auth's CLI generates: `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, `apikey`, `two_factor`, `team`.

We treat these as authoritative for identity. All app tables reference `user.id` and `organization.id`.

## Core app tables

### `workspaces`

```ts
workspaces {
  id              uuid pk
  org_id          uuid fk → organization.id on delete cascade
  slug            text          // 'omnix' | 'marketplace' | 'studio'
  name            text          // display name
  description     text null
  type            text          // 'business' — reserved for future variants
  currency        text          // 'KES' | 'USD' | …
  timezone        text          // 'Africa/Nairobi'
  brand_color     text null     // override accent for this workspace (rare)
  is_archived     boolean       // soft archive
  created_at      timestamptz
  updated_at      timestamptz
  deleted_at      timestamptz null

  unique (org_id, slug)
  index idx_workspaces_org on (org_id)
}
```

### `workspace_members`

```ts
workspace_members {
  workspace_id    uuid fk → workspaces.id on delete cascade
  user_id         uuid fk → user.id on delete cascade
  role            text          // 'owner' | 'admin' | 'member' | 'viewer'
  invited_by      uuid null fk → user.id
  joined_at       timestamptz
  pk (workspace_id, user_id)
  index idx_wm_user on (user_id)
}
```

### `companies` + `org_companies`

```ts
companies {
  id              uuid pk
  workspace_id    uuid fk → workspaces.id on delete cascade
  name            text
  domain          text null     // primary website domain, normalized
  industry        text null
  size            text null     // '1-10' | '11-50' | …
  country         text          // ISO-2, default 'KE'
  city            text null
  address         text null
  phone           text null     // E.164
  whatsapp        text null     // E.164, normalized from phone if not set
  email_primary   text null
  google_place_id text null     // for Prospector dedup
  enriched_at     timestamptz null
  enrichment_data jsonb null    // raw Google Places + scraped fields
  source          text          // 'manual' | 'prospector' | 'inbound_email' | 'whatsapp' | 'import'
  fit_score       int null      // AI fit score 0-100 per workspace
  lifecycle_stage text          // 'cold' | 'warm' | 'qualified' | 'customer' | 'lost' | 'archived'
  owner_id        uuid null fk → user.id
  custom_fields   jsonb         // workspace-defined typed fields
  created_at      timestamptz
  updated_at      timestamptz
  deleted_at      timestamptz null

  unique (workspace_id, google_place_id) where google_place_id not null
  unique (workspace_id, domain) where domain not null
  index idx_companies_workspace on (workspace_id)
  index idx_companies_lifecycle on (workspace_id, lifecycle_stage)
  index idx_companies_owner on (owner_id)
}

// Cross-workspace company linking — same business, multiple workspaces' relationships
org_companies {
  id              uuid pk
  org_id          uuid fk → organization.id on delete cascade
  canonical_name  text          // 'Mama Brenda Pharmacy'
  canonical_domain text null
  google_place_id text null
  created_at      timestamptz

  unique (org_id, google_place_id) where not null
  unique (org_id, canonical_domain) where not null
}

company_org_links {
  company_id      uuid fk → companies.id on delete cascade
  org_company_id  uuid fk → org_companies.id on delete cascade
  pk (company_id, org_company_id)
}
```

### `contacts`

```ts
contacts {
  id              uuid pk
  workspace_id    uuid fk → workspaces.id on delete cascade
  company_id      uuid null fk → companies.id on delete set null
  first_name      text
  last_name       text null
  email           text null     // normalized lowercase
  phone           text null     // E.164
  whatsapp        text null     // E.164
  title           text null
  linkedin        text null
  twitter         text null
  source          text
  lifecycle_stage text
  owner_id        uuid null fk → user.id
  custom_fields   jsonb
  created_at      timestamptz
  updated_at      timestamptz
  deleted_at      timestamptz null

  unique (workspace_id, email) where email not null
  index idx_contacts_workspace on (workspace_id)
  index idx_contacts_company on (company_id)
  index idx_contacts_email on (email)
}
```

### `conversations` + `messages`

Polymorphic across channels. Email thread, WhatsApp thread, future SMS thread.

```ts
conversations {
  id              uuid pk
  workspace_id    uuid fk → workspaces.id on delete cascade
  channel         text          // 'email' | 'whatsapp' | 'sms' | 'call'
  external_id     text null     // Gmail thread ID, WhatsApp wa_id, etc.
  subject         text null     // for email
  participant_emails text[] null
  participant_phones text[] null
  company_id      uuid null fk → companies.id on delete set null
  contact_ids     uuid[]        // who's on the thread
  state           text          // 'open' | 'snoozed' | 'archived' | 'pinned'
  snoozed_until   timestamptz null
  last_message_at timestamptz
  unread_count    int default 0
  ai_summary      text null     // AI-generated thread summary
  ai_summary_at   timestamptz null
  created_at      timestamptz
  updated_at      timestamptz

  index idx_conv_workspace_state on (workspace_id, state)
  index idx_conv_last_message on (workspace_id, last_message_at desc)
  index idx_conv_company on (company_id)
  unique (workspace_id, channel, external_id) where external_id not null
}

messages {
  id              uuid pk
  conversation_id uuid fk → conversations.id on delete cascade
  direction       text          // 'inbound' | 'outbound'
  sender_email    text null
  sender_phone    text null
  recipient_emails text[] null
  recipient_phones text[] null
  subject         text null
  body_text       text          // plain-text body
  body_html       text null     // raw HTML for email
  meta            jsonb         // raw provider payload (Resend / Meta) for debugging
  status          text          // 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'received'
  failure_reason  text null
  external_id     text null     // provider message ID
  in_reply_to     text null     // RFC 5322 Message-ID for threading
  ai_drafted      boolean       // true if AI helped draft this
  ai_model        text null     // which model wrote the draft
  sent_at         timestamptz null
  received_at     timestamptz null
  read_at         timestamptz null
  created_at      timestamptz

  index idx_messages_conv on (conversation_id, created_at)
  index idx_messages_external on (external_id)
}

attachments {
  id              uuid pk
  message_id      uuid null fk → messages.id on delete cascade
  document_id     uuid null fk → documents.id on delete set null
  filename        text
  content_type    text
  size_bytes      int
  r2_key          text          // path in R2 bucket
  created_at      timestamptz
}
```

### `pipelines` + `stages` + `deals`

Per-workspace pipelines with custom shapes.

```ts
pipelines {
  id              uuid pk
  workspace_id    uuid fk → workspaces.id on delete cascade
  name            text          // 'License Funnel', 'Project Funnel', 'Creator Onboarding'
  is_default      boolean
  archived        boolean
  created_at      timestamptz
}

stages {
  id              uuid pk
  pipeline_id     uuid fk → pipelines.id on delete cascade
  name            text          // 'Cold', 'Trial', 'Negotiation', 'Won', 'Lost'
  order           int
  stage_type      text          // 'open' | 'won' | 'lost'
  rotting_days    int null      // flag deals with no activity > N days
  automation      jsonb null    // stage automations definition
}

deals {
  id              uuid pk
  workspace_id    uuid fk → workspaces.id on delete cascade
  pipeline_id     uuid fk → pipelines.id
  stage_id        uuid fk → stages.id
  title           text
  amount          numeric(20,4) null
  currency        text          // 'KES'
  company_id      uuid null fk → companies.id on delete set null
  contact_id      uuid null fk → contacts.id on delete set null
  owner_id        uuid null fk → user.id
  source          text null
  expected_close  date null
  closed_at       timestamptz null
  win_loss_reason text null
  notes           text null
  custom_fields   jsonb
  created_at      timestamptz
  updated_at      timestamptz
  deleted_at      timestamptz null

  index idx_deals_workspace_stage on (workspace_id, stage_id)
  index idx_deals_company on (company_id)
  index idx_deals_owner on (owner_id)
}
```

### `tasks`

```ts
tasks {
  id              uuid pk
  workspace_id    uuid fk → workspaces.id on delete cascade
  title           text
  description     text null
  priority        text          // 'low' | 'normal' | 'high' | 'urgent'
  status          text          // 'open' | 'doing' | 'done' | 'cancelled'
  due_at          timestamptz null
  reminder_at     timestamptz null
  recurrence      text null     // cron-like
  assignee_id     uuid null fk → user.id
  related_to_type text null     // 'contact' | 'company' | 'deal' | 'conversation'
  related_to_id   uuid null
  ai_suggested    boolean       // true if AI created this
  created_at      timestamptz
  completed_at    timestamptz null
  deleted_at      timestamptz null

  index idx_tasks_workspace_status on (workspace_id, status)
  index idx_tasks_assignee_due on (assignee_id, due_at)
}
```

### `notes`

```ts
notes {
  id              uuid pk
  workspace_id    uuid fk → workspaces.id on delete cascade
  title           text null
  body            jsonb         // TipTap JSON
  body_text       text          // extracted plain text for FTS
  related_to_type text null
  related_to_id   uuid null
  author_id       uuid fk → user.id
  created_at      timestamptz
  updated_at      timestamptz
}
```

### `files`

```ts
files {
  id              uuid pk
  workspace_id    uuid fk → workspaces.id on delete cascade
  filename        text
  content_type    text
  size_bytes      int
  r2_key          text
  extracted_text  text null     // OCR for PDF/image
  related_to_type text null
  related_to_id   uuid null
  uploaded_by     uuid fk → user.id
  created_at      timestamptz
}
```

### `templates`

```ts
templates {
  id              uuid pk
  workspace_id    uuid fk → workspaces.id on delete cascade
  kind            text          // 'email' | 'whatsapp' | 'document'
  name            text
  subject         text null     // email only
  body            jsonb         // TipTap JSON, with {{variable}} placeholders
  variables       jsonb         // declared variables and their types
  meta_template_id text null    // Meta WhatsApp approved template name + status
  meta_status     text null     // 'pending' | 'approved' | 'rejected'
  created_at      timestamptz
  updated_at      timestamptz
}
```

### `documents` + `document_versions`

```ts
documents {
  id              uuid pk
  workspace_id    uuid fk → workspaces.id on delete cascade
  kind            text          // 'proposal' | 'quote' | 'invoice' | 'contract' | 'brief'
  status          text          // 'draft' | 'sent' | 'viewed' | 'signed' | 'paid' | 'declined' | 'expired'
  title           text
  recipient_contact_id uuid null
  recipient_company_id uuid null
  deal_id         uuid null
  currency        text
  total           numeric(20,4) null
  due_date        date null
  public_share_token text null  // /share/{token} unauth view
  signed_at       timestamptz null
  paid_at         timestamptz null
  created_at      timestamptz
  sent_at         timestamptz null
  current_version_id uuid null

  unique (public_share_token)
  index idx_docs_workspace_status on (workspace_id, status)
}

document_versions {
  id              uuid pk
  document_id     uuid fk → documents.id on delete cascade
  version         int           // 1, 2, 3...
  body            jsonb         // TipTap JSON
  pdf_r2_key      text null     // rendered PDF in R2
  rendered_at     timestamptz null
  author_id       uuid fk → user.id
  created_at      timestamptz
}

invoice_line_items {
  id              uuid pk
  document_id     uuid fk → documents.id on delete cascade
  description     text
  quantity        numeric(20,4)
  unit_price      numeric(20,4)
  tax_rate        numeric(5,4)  // 0.16 for 16% VAT
  amount          numeric(20,4) // qty * unit_price (tax-exclusive)
  order           int
}
```

### `timeline_events` — the spine

```ts
timeline_events {
  id              uuid pk
  workspace_id    uuid fk → workspaces.id on delete cascade
  event_type      text          // see enum below
  actor_id        uuid null fk → user.id   // null = system / inbound
  subject_type    text          // 'contact' | 'company' | 'deal' | 'conversation' | 'document' | 'payment' | …
  subject_id      uuid          // PK of the subject
  related_refs    jsonb         // additional related IDs (e.g. for an email: {conversation_id, message_id})
  payload         jsonb         // event-specific data
  occurred_at     timestamptz
  created_at      timestamptz

  index idx_timeline_workspace_subject on (workspace_id, subject_type, subject_id, occurred_at desc)
  index idx_timeline_workspace_occurred on (workspace_id, occurred_at desc)
}

// event_type enum:
// 'email_received' | 'email_sent' | 'email_opened' | 'email_clicked' |
// 'whatsapp_received' | 'whatsapp_sent' | 'whatsapp_read' |
// 'call_logged' | 'meeting_held' |
// 'note_added' | 'task_created' | 'task_completed' |
// 'deal_created' | 'deal_stage_changed' | 'deal_won' | 'deal_lost' |
// 'document_sent' | 'document_viewed' | 'document_signed' | 'document_declined' |
// 'payment_requested' | 'payment_received' | 'payment_refunded' |
// 'contact_created' | 'contact_enriched' |
// 'prospector_search' | 'prospector_imported' |
// 'campaign_enrolled' | 'campaign_completed' |
// 'ai_action' (generic AI artifact)
```

### `ai_memory_facts`

```ts
ai_memory_facts {
  id              uuid pk
  workspace_id    uuid fk → workspaces.id on delete cascade
  scope_type      text          // 'workspace' | 'company' | 'contact' | 'deal'
  scope_id        uuid null
  fact            text          // "Patricia prefers WhatsApp over email"
  source          text          // 'manual' | 'inferred_from_email' | 'inferred_from_meeting'
  source_event_id uuid null fk → timeline_events.id
  confidence      numeric(3,2)  // 0.00 - 1.00
  superseded_by   uuid null fk → ai_memory_facts.id
  expires_at      timestamptz null
  created_at      timestamptz

  index idx_aimf_scope on (workspace_id, scope_type, scope_id)
}
```

## AI registry + accounting

### `ai_models`

```ts
ai_models {
  id              uuid pk
  provider        text          // 'gemini' | 'groq' | 'openrouter' | …
  model_id        text          // 'gemini-2.5-flash' | 'llama-3.3-70b-versatile'
  display_name    text
  capabilities    text[]        // ['chat', 'tools', 'json_mode', 'long_context', 'vision', 'embedding']
  context_window  int
  input_cost_per_million numeric null    // null = free tier
  output_cost_per_million numeric null
  rate_limit_rpm  int null
  rate_limit_tpd  int null
  enabled         boolean
  is_free_tier    boolean
  created_at      timestamptz
}
```

### `ai_feature_bindings`

```ts
ai_feature_bindings {
  id              uuid pk
  workspace_id    uuid null fk → workspaces.id   // null = org default
  org_id          uuid fk → organization.id
  feature         text          // 'draft_reply' | 'summarize_thread' | 'classify_lead' | …
  primary_model_id uuid fk → ai_models.id
  fallback_chain  uuid[]        // model IDs in order
  daily_budget_kes numeric(10,2) null
  enabled         boolean

  unique (workspace_id, feature) where workspace_id is not null
  unique (org_id, feature) where workspace_id is null
}
```

### `ai_usage_events`

```ts
ai_usage_events {
  id              uuid pk
  workspace_id    uuid null fk → workspaces.id
  org_id          uuid fk → organization.id
  feature         text
  model_id        uuid fk → ai_models.id
  actor_id        uuid null fk → user.id
  input_tokens    int
  output_tokens   int
  cost            numeric(12,6)  // in USD
  latency_ms      int
  status          text          // 'ok' | 'error' | 'rate_limited' | 'budget_exceeded'
  fallback_used   boolean       // true if primary failed and fallback ran
  request_id      text          // for tracing
  created_at      timestamptz

  index idx_aiu_workspace_day on (workspace_id, created_at)
}
```

## Payments

See `10-payments.md` for full Paystack architecture. Sketch:

```ts
paystack_subaccounts {
  id              uuid pk
  workspace_id    uuid fk → workspaces.id on delete cascade
  subaccount_code text          // PSACCT_xxx from Paystack
  bank_code       text
  account_number  text          // last 4 visible in UI
  business_name   text
  percentage_charge numeric(5,2)
  settlement_destination text  // 'bank' | 'mpesa_wallet' | 'mpesa_paybill' | 'mpesa_till'
  created_at      timestamptz

  unique (workspace_id)
}

payment_requests {
  id              uuid pk
  workspace_id    uuid fk → workspaces.id
  document_id     uuid null fk → documents.id  // when linked to an invoice
  paystack_id     text          // Paystack payment request ID
  paystack_code   text          // PRQ_xxx, drives the public URL
  contact_id      uuid null
  amount          numeric(20,4)
  currency        text
  description     text
  due_date        date null
  status          text          // 'pending' | 'paid' | 'expired' | 'cancelled'
  paystack_payment_url text     // hosted by Paystack
  paid_at         timestamptz null
  paid_amount     numeric(20,4) null
  paid_via        text null     // 'card' | 'mpesa' | …
  paystack_webhook_payload jsonb null   // raw payment.success event
  created_at      timestamptz
}

paystack_transfers {
  id              uuid pk
  workspace_id    uuid fk → workspaces.id
  paystack_transfer_code text
  recipient_code  text
  amount          numeric(20,4)
  currency        text
  reason          text null
  status          text          // 'pending' | 'success' | 'failed' | 'reversed'
  paystack_payload jsonb
  created_at      timestamptz
}

paystack_customers {
  id              uuid pk
  org_id          uuid fk → organization.id
  contact_id      uuid fk → contacts.id on delete cascade
  paystack_customer_code text
  created_at      timestamptz
}
```

## Secrets (encrypted at rest)

```ts
org_integration_keys {
  id              uuid pk
  org_id          uuid fk → organization.id on delete cascade
  provider        text          // 'gemini' | 'paystack' | 'resend' | 'meta_whatsapp' | …
  label           text
  encrypted_value bytea         // AES-256-GCM ciphertext + IV(12B) + auth_tag(16B), all stored together
  key_version     int           // for rotation
  last_four       text          // for display
  status          text          // 'active' | 'rotating' | 'revoked'
  meta            jsonb null    // provider-specific extras: { waba_id, phone_number_id } etc.
  created_by      uuid fk → user.id
  created_at      timestamptz
  rotated_at      timestamptz null
  revoked_at      timestamptz null

  unique (org_id, provider, label)
}

user_personal_keys {
  id              uuid pk
  user_id         uuid fk → user.id on delete cascade
  provider        text
  encrypted_value bytea
  key_version     int
  last_four       text
  status          text
  meta            jsonb null
  created_at      timestamptz

  unique (user_id, provider)
}
```

## Audit log

```ts
audit_log {
  id              uuid pk
  org_id          uuid fk → organization.id
  workspace_id    uuid null fk → workspaces.id
  actor_id        uuid null fk → user.id   // null = system
  action          text          // 'created' | 'updated' | 'deleted' | 'decrypted_secret' | 'sent_email' | …
  resource_type   text
  resource_id     uuid
  before          jsonb null
  after           jsonb null
  reason          text null
  ip              inet null
  user_agent      text null
  request_id      text null
  occurred_at     timestamptz

  index idx_audit_org_time on (org_id, occurred_at desc)
  index idx_audit_resource on (resource_type, resource_id)
}
```

## Search index

```ts
search_index {
  id              uuid pk
  org_id          uuid fk → organization.id
  workspace_id    uuid null fk → workspaces.id
  resource_type   text
  resource_id     uuid
  title           text
  body            text
  body_tsv        tsvector       // generated column: to_tsvector('english', title || ' ' || body)
  embedding       vector(768) null   // Gemini text-embedding-004
  metadata        jsonb           // type-specific filters
  updated_at      timestamptz

  index idx_search_tsv using gin (body_tsv)
  index idx_search_embedding using hnsw (embedding vector_cosine_ops)
    with (m = 16, ef_construction = 200)
  unique (resource_type, resource_id)
}
```

## Critical invariants

1. **Every mutation has an audit_log row** — enforced by going through Server Actions or repo functions only.
2. **All money columns are `numeric(20,4)`** — never `real`, never `float`.
3. **Soft-deleted rows are filtered by default** — repo helpers (`whereNotDeleted()`) on every query.
4. **All foreign keys have ON DELETE behavior explicitly chosen** — no defaults.
5. **`workspace_id` is on every workspace-scoped table** — every query is row-level filtered by workspace.
6. **All indexes on `(workspace_id, …)`** for workspace-scoped queries — never table-scan.
7. **`updated_at` auto-updates** via trigger or repo helper.
8. **No raw SQL in routes/components** — go through Drizzle. Exception: complex search queries with FTS + pgvector.

## Migration strategy

- Drizzle Kit `generate` and `migrate`
- One migration per logical change, named with timestamp + slug: `0001_initial.sql`, `0002_add_payments.sql`
- Migrations are gated for production by CI manual approval
- Never edit a committed migration; always add a new one
