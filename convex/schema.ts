/**
 * Atlas Convex schema — Phase 0 foundation.
 *
 * Conventions (per plan/05-data-model.md):
 *   - All money is `v.int64()` cents. Never floats. (KES × 100)
 *   - Timestamps are `v.number()` (epoch ms). `_creationTime` covers
 *     "row appeared"; we only add explicit ts fields when we need a
 *     separate semantic time (e.g. occurredAt for audit_log).
 *   - Every query path needs an index. No `.filter()` in hot paths.
 *   - Tier-1 secrets (`orgIntegrationKeys`) and Tier-2 (`userPersonalKeys`)
 *     store ciphertext as a base64 string, encrypted by lib/secrets.ts
 *     using CONFIG_ENCRYPTION_KEY (the only env-stored secret).
 *   - File storage = Convex's built-in `_storage` (`v.id("_storage")`).
 *     No R2, no MinIO, no S3.
 *   - Soft-delete: rows that need it carry `archivedAt: v.optional(v.number())`.
 */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

/* ------------------------------------------------------------------ */
/* Reusable validators                                                 */
/* ------------------------------------------------------------------ */

const orgRole = v.union(v.literal("owner"), v.literal("admin"), v.literal("member"));
const workspaceRole = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("member"),
  v.literal("viewer"),
);
const invitationStatus = v.union(
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("declined"),
  v.literal("revoked"),
  v.literal("expired"),
);
const keyStatus = v.union(
  v.literal("active"),
  v.literal("rotating"),
  v.literal("revoked"),
);

/* ------------------------------------------------------------------ */
/* Tier-1 integration providers — the bindable list                    */
/* ------------------------------------------------------------------ */
const integrationProvider = v.union(
  // AI
  v.literal("gemini"),
  v.literal("groq"),
  v.literal("openrouter"),
  v.literal("mistral"),
  v.literal("cohere"),
  v.literal("cerebras"),
  v.literal("github_models"),
  v.literal("openai"),
  v.literal("anthropic"),
  v.literal("together"),
  // Communications
  v.literal("resend"),
  v.literal("meta_whatsapp"),
  v.literal("cloudflare_email_routing"),
  // Maps + lead gen
  v.literal("google_maps_places"),
  // Payments
  v.literal("paystack"),
  // Documents
  v.literal("docuseal"),
);

/* ------------------------------------------------------------------ */
/* Audit log — every mutation lands here                               */
/* ------------------------------------------------------------------ */
const auditAction = v.union(
  v.literal("created"),
  v.literal("updated"),
  v.literal("deleted"),
  v.literal("archived"),
  v.literal("restored"),
  v.literal("created_secret"),
  v.literal("rotated_secret"),
  v.literal("revoked_secret"),
  v.literal("decrypted_secret"),
  v.literal("invited_member"),
  v.literal("accepted_invitation"),
  v.literal("revoked_invitation"),
  v.literal("changed_role"),
  v.literal("sent_email"),
  v.literal("sent_whatsapp"),
  v.literal("ai_call"),
);

export default defineSchema({
  /* ============================================================ */
  /* Convex Auth tables (users, authSessions, etc.)                */
  /* ============================================================ */
  ...authTables,

  /* ============================================================ */
  /* Atlas user profile — extends `users` with role + onboarding   */
  /* ============================================================ */
  userProfiles: defineTable({
    userId: v.id("users"),
    fullName: v.optional(v.string()),
    avatarStorageId: v.optional(v.id("_storage")),
    timezone: v.string(),                    // 'Africa/Nairobi'
    locale: v.string(),                      // 'en'
    onboardedAt: v.optional(v.number()),
    // The org+workspace this user was last in — for fast re-entry.
    lastActiveOrgId: v.optional(v.id("organizations")),
    lastActiveWorkspaceId: v.optional(v.id("workspaces")),
  }).index("by_userId", ["userId"]),

  /* ============================================================ */
  /* Organizations + members + invitations                          */
  /* ============================================================ */
  organizations: defineTable({
    name: v.string(),
    slug: v.string(),                        // 'blyss'
    logoStorageId: v.optional(v.id("_storage")),
    metadata: v.optional(v.any()),
    archivedAt: v.optional(v.number()),
  }).index("by_slug", ["slug"]),

  members: defineTable({
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    role: orgRole,
    invitedBy: v.optional(v.id("users")),
    joinedAt: v.number(),
  })
    .index("by_org", ["organizationId"])
    .index("by_user", ["userId"])
    .index("by_org_user", ["organizationId", "userId"]),

  invitations: defineTable({
    organizationId: v.id("organizations"),
    email: v.string(),                       // lowercase
    role: orgRole,
    // Optional pre-assigned workspace memberships on accept.
    workspaceAssignments: v.optional(
      v.array(v.object({ workspaceId: v.id("workspaces"), role: workspaceRole })),
    ),
    inviterId: v.id("users"),
    token: v.string(),                       // URL-safe random
    status: invitationStatus,
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_org_email", ["organizationId", "email"])
    .index("by_email_status", ["email", "status"]),

  /* ============================================================ */
  /* Workspaces — one org has many; pre-seeded with Omnix, Marketplace, Studio */
  /* ============================================================ */
  workspaces: defineTable({
    organizationId: v.id("organizations"),
    slug: v.string(),                        // 'omnix' | 'marketplace' | 'studio'
    name: v.string(),
    description: v.optional(v.string()),
    currency: v.string(),                    // 'KES' default
    timezone: v.string(),                    // 'Africa/Nairobi'
    brandColor: v.optional(v.string()),      // override accent (rare)
    archivedAt: v.optional(v.number()),
  })
    .index("by_org", ["organizationId"])
    .index("by_org_slug", ["organizationId", "slug"]),

  workspaceMembers: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    role: workspaceRole,
    invitedBy: v.optional(v.id("users")),
    joinedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_user", ["userId"])
    .index("by_workspace_user", ["workspaceId", "userId"]),

  /* ============================================================ */
  /* Tier-1 secrets — org-level integration keys (encrypted)        */
  /* ============================================================ */
  orgIntegrationKeys: defineTable({
    organizationId: v.id("organizations"),
    provider: integrationProvider,
    label: v.string(),                       // 'Primary'
    encryptedValue: v.string(),              // base64(iv ‖ ct)
    keyVersion: v.number(),
    lastFour: v.string(),                    // for display: '•••8h2'
    status: keyStatus,
    // Provider-specific extras, also encrypted only when sensitive.
    // e.g. meta_whatsapp: { wabaId, phoneNumberIds }, paystack: { mode, publicKey, encryptedSecretKey }
    meta: v.optional(v.any()),
    createdBy: v.optional(v.id("users")),
    rotatedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_org", ["organizationId"])
    .index("by_org_provider", ["organizationId", "provider"])
    .index("by_org_provider_label", ["organizationId", "provider", "label"]),

  /* ============================================================ */
  /* Tier-2 secrets — per-user personal integrations                */
  /* ============================================================ */
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
    status: keyStatus,
    meta: v.optional(v.any()),
  })
    .index("by_user", ["userId"])
    .index("by_user_provider", ["userId", "provider"]),

  /* ============================================================ */
  /* Audit log — every mutation                                     */
  /* ============================================================ */
  auditLog: defineTable({
    organizationId: v.id("organizations"),
    workspaceId: v.optional(v.id("workspaces")),
    actorId: v.optional(v.id("users")),      // null = system
    action: auditAction,
    resourceType: v.string(),                // 'organization' | 'workspace' | 'integration_key' | …
    resourceId: v.string(),                  // id of subject (any table)
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
    .index("by_actor", ["actorId"]),

  /* ============================================================ */
  /* Phase 1 — The graph                                            */
  /* ============================================================ */

  // Companies — businesses/orgs Atlas tracks. Scoped to a workspace.
  companies: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    domain: v.optional(v.string()),           // normalized lowercase, no protocol
    industry: v.optional(v.string()),
    size: v.optional(v.string()),             // '1-10' | '11-50' | …
    country: v.string(),                       // ISO-2, default 'KE'
    city: v.optional(v.string()),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),             // E.164
    whatsapp: v.optional(v.string()),          // E.164
    emailPrimary: v.optional(v.string()),
    website: v.optional(v.string()),
    description: v.optional(v.string()),
    googlePlaceId: v.optional(v.string()),     // for Prospector dedup
    enrichedAt: v.optional(v.number()),
    enrichmentData: v.optional(v.any()),       // raw Places + scraped fields
    source: v.string(),                        // 'manual' | 'prospector' | 'inbound_email' | …
    fitScore: v.optional(v.number()),          // AI fit 0-100
    lifecycleStage: v.string(),                // 'cold' | 'warm' | 'qualified' | 'customer' | 'lost' | 'archived'
    ownerId: v.optional(v.id("users")),
    tags: v.array(v.string()),                 // tag names (denormalized for speed)
    customFields: v.optional(v.any()),         // jsonb-shaped
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_lifecycle", ["workspaceId", "lifecycleStage"])
    .index("by_workspace_owner", ["workspaceId", "ownerId"])
    .index("by_workspace_place", ["workspaceId", "googlePlaceId"])
    .index("by_workspace_domain", ["workspaceId", "domain"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["workspaceId", "lifecycleStage", "archivedAt"],
    }),

  // Contacts — people inside companies (or independent freelancers).
  contacts: defineTable({
    workspaceId: v.id("workspaces"),
    companyId: v.optional(v.id("companies")),
    firstName: v.string(),
    lastName: v.optional(v.string()),
    email: v.optional(v.string()),             // normalized lowercase
    phone: v.optional(v.string()),             // E.164
    whatsapp: v.optional(v.string()),          // E.164
    title: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    twitter: v.optional(v.string()),
    avatarStorageId: v.optional(v.id("_storage")),
    source: v.string(),
    lifecycleStage: v.string(),
    ownerId: v.optional(v.id("users")),
    tags: v.array(v.string()),
    customFields: v.optional(v.any()),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_company", ["workspaceId", "companyId"])
    .index("by_workspace_email", ["workspaceId", "email"])
    .index("by_workspace_owner", ["workspaceId", "ownerId"])
    .searchIndex("search_name", {
      searchField: "firstName",
      filterFields: ["workspaceId", "lifecycleStage", "archivedAt"],
    }),

  // Tags — workspace-scoped, drives the global tag picker.
  // tags array on companies/contacts is denormalized for speed;
  // this table is the canonical name + color registry.
  tags: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),                          // canonical lowercase
    label: v.string(),                         // display case
    color: v.optional(v.string()),             // oklch / hex
    description: v.optional(v.string()),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_name", ["workspaceId", "name"]),

  /* ============================================================ */
  /* Timeline — every action lands here                             */
  /* ============================================================ */
  timelineEvents: defineTable({
    workspaceId: v.id("workspaces"),
    eventType: v.string(),
    // 'contact_created' | 'company_created' | 'note_added' |
    // 'task_created' | 'task_completed' | 'email_sent' | 'email_received' |
    // 'whatsapp_sent' | 'whatsapp_received' | 'deal_stage_changed' |
    // 'document_sent' | 'payment_received' | 'meeting_held' | …
    actorId: v.optional(v.id("users")),         // null = system / inbound
    subjectType: v.string(),                    // 'contact' | 'company' | 'deal' | …
    subjectId: v.string(),                      // PK of subject (any table)
    relatedRefs: v.optional(v.any()),           // { conversationId, messageId, … }
    payload: v.optional(v.any()),               // event-specific data
    occurredAt: v.number(),
  })
    .index("by_workspace_subject", ["workspaceId", "subjectType", "subjectId", "occurredAt"])
    .index("by_workspace_occurred", ["workspaceId", "occurredAt"])
    .index("by_workspace_type", ["workspaceId", "eventType", "occurredAt"]),

  /* ============================================================ */
  /* Notes — rich text via TipTap (stored as JSON)                  */
  /* ============================================================ */
  notes: defineTable({
    workspaceId: v.id("workspaces"),
    title: v.optional(v.string()),
    body: v.any(),                              // TipTap JSON
    bodyText: v.string(),                       // plain-text extract for FTS
    relatedToType: v.optional(v.string()),      // 'contact' | 'company' | 'deal' | …
    relatedToId: v.optional(v.string()),
    authorId: v.id("users"),
    pinned: v.boolean(),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_related", ["relatedToType", "relatedToId"])
    .index("by_author", ["authorId"])
    .searchIndex("search_body", {
      searchField: "bodyText",
      filterFields: ["workspaceId", "relatedToType", "relatedToId", "archivedAt"],
    }),

  /* ============================================================ */
  /* Tasks — outcome-anchored                                       */
  /* ============================================================ */
  tasks: defineTable({
    workspaceId: v.id("workspaces"),
    title: v.string(),
    description: v.optional(v.string()),
    priority: v.union(
      v.literal("low"),
      v.literal("normal"),
      v.literal("high"),
      v.literal("urgent"),
    ),
    status: v.union(
      v.literal("open"),
      v.literal("doing"),
      v.literal("done"),
      v.literal("cancelled"),
    ),
    dueAt: v.optional(v.number()),
    reminderAt: v.optional(v.number()),
    recurrence: v.optional(v.string()),         // cron-like, future
    assigneeId: v.optional(v.id("users")),
    relatedToType: v.optional(v.string()),
    relatedToId: v.optional(v.string()),
    aiSuggested: v.boolean(),
    completedAt: v.optional(v.number()),
    completedBy: v.optional(v.id("users")),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_workspace_assignee_due", ["workspaceId", "assigneeId", "dueAt"])
    .index("by_related", ["relatedToType", "relatedToId"])
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["workspaceId", "status", "archivedAt"],
    }),

  /* ============================================================ */
  /* Files — Convex storage Ids + metadata                          */
  /* ============================================================ */
  files: defineTable({
    workspaceId: v.id("workspaces"),
    filename: v.string(),
    contentType: v.string(),
    sizeBytes: v.number(),
    storageId: v.id("_storage"),
    extractedText: v.optional(v.string()),      // for PDF/image OCR (Phase 2+)
    relatedToType: v.optional(v.string()),
    relatedToId: v.optional(v.string()),
    uploadedBy: v.id("users"),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_related", ["relatedToType", "relatedToId"])
    .index("by_uploader", ["uploadedBy"]),

  /* ============================================================ */
  /* Phase 2 — Email + unified conversations                        */
  /* ============================================================ */

  // Sender identities per workspace. Each workspace can have multiple
  // "from" addresses (e.g. justine@blyss.co.ke, sales@omnix.co.ke).
  senderIdentities: defineTable({
    workspaceId: v.id("workspaces"),
    channel: v.union(v.literal("email"), v.literal("whatsapp")),
    // Email: 'justine@blyss.co.ke'; WhatsApp: Meta phone_number_id
    address: v.string(),
    displayName: v.optional(v.string()),          // "Justine Gichana"
    signature: v.optional(v.any()),               // TipTap JSON, email only
    dkimVerified: v.optional(v.boolean()),        // From Resend domain check
    spfVerified: v.optional(v.boolean()),
    isDefault: v.boolean(),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_channel", ["workspaceId", "channel"])
    .index("by_workspace_address", ["workspaceId", "address"]),

  // Conversations — polymorphic across channels. One row per thread.
  conversations: defineTable({
    workspaceId: v.id("workspaces"),
    channel: v.union(
      v.literal("email"),
      v.literal("whatsapp"),
      v.literal("sms"),
      v.literal("call"),
      v.literal("social_comment"),
    ),
    // Provider thread identifier (Gmail thread ID, WhatsApp wa_id,
    // Resend message_id for the first message, etc.). Nullable
    // because we start threading before knowing external IDs.
    externalId: v.optional(v.string()),
    // Email: canonical subject (from the first message). Empty for WA.
    subject: v.optional(v.string()),
    participantEmails: v.optional(v.array(v.string())),
    participantPhones: v.optional(v.array(v.string())),
    companyId: v.optional(v.id("companies")),
    contactIds: v.array(v.id("contacts")),
    state: v.union(
      v.literal("open"),
      v.literal("snoozed"),
      v.literal("archived"),
      v.literal("pinned"),
      v.literal("spam"),
    ),
    snoozedUntil: v.optional(v.number()),
    lastMessageAt: v.number(),
    lastInboundAt: v.optional(v.number()),
    lastOutboundAt: v.optional(v.number()),
    unreadCount: v.number(),
    messageCount: v.number(),
    aiSummary: v.optional(v.string()),
    aiSummaryAt: v.optional(v.number()),
    // Threading key for email: normalized References chain, so replies
    // that arrive without our internal externalId still find home.
    threadingKey: v.optional(v.string()),
    // Sender identity used for outbound in this thread (defaults to
    // workspace default if null).
    senderIdentityId: v.optional(v.id("senderIdentities")),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace_state_time", ["workspaceId", "state", "lastMessageAt"])
    .index("by_workspace_channel_time", ["workspaceId", "channel", "lastMessageAt"])
    .index("by_workspace_external", ["workspaceId", "channel", "externalId"])
    .index("by_workspace_threading_key", ["workspaceId", "threadingKey"])
    .index("by_company", ["companyId"])
    .searchIndex("search_subject", {
      searchField: "subject",
      filterFields: ["workspaceId", "state", "archivedAt"],
    }),

  // Messages — individual emails / WA messages / comments.
  messages: defineTable({
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    senderEmail: v.optional(v.string()),
    senderPhone: v.optional(v.string()),
    senderName: v.optional(v.string()),
    recipientEmails: v.optional(v.array(v.string())),      // To
    recipientCcEmails: v.optional(v.array(v.string())),    // Cc
    recipientBccEmails: v.optional(v.array(v.string())),   // Bcc, outbound only
    recipientPhones: v.optional(v.array(v.string())),
    subject: v.optional(v.string()),
    bodyText: v.string(),                                   // plaintext
    bodyHtml: v.optional(v.string()),                       // sanitized HTML for email
    // Raw provider payload for debugging / re-parsing later.
    providerPayload: v.optional(v.any()),
    status: v.union(
      v.literal("draft"),
      v.literal("queued"),
      v.literal("scheduled"),
      v.literal("sending"),
      v.literal("sent"),
      v.literal("delivered"),
      v.literal("read"),
      v.literal("failed"),
      v.literal("received"),
    ),
    failureReason: v.optional(v.string()),
    externalId: v.optional(v.string()),                     // provider message id
    // RFC 5322 Message-ID for email threading.
    messageId: v.optional(v.string()),
    // Reply-to chain — for threading.
    inReplyTo: v.optional(v.string()),
    referencesChain: v.optional(v.array(v.string())),
    aiDrafted: v.boolean(),
    aiModel: v.optional(v.string()),
    scheduledFor: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    receivedAt: v.optional(v.number()),
    readAt: v.optional(v.number()),
    senderIdentityId: v.optional(v.id("senderIdentities")),
    // WhatsApp-specific
    messageType: v.optional(v.string()),                     // 'text' | 'template' | 'image' | …
    templateName: v.optional(v.string()),
    templateLanguage: v.optional(v.string()),
    templateVariables: v.optional(v.any()),
  })
    .index("by_conversation_time", ["conversationId"])
    .index("by_workspace_time", ["workspaceId"])
    .index("by_external", ["externalId"])
    .index("by_message_id", ["messageId"])
    .searchIndex("search_body", {
      searchField: "bodyText",
      filterFields: ["workspaceId", "conversationId"],
    }),

  // Attachments — link a Convex _storage id to a message.
  messageAttachments: defineTable({
    messageId: v.id("messages"),
    filename: v.string(),
    contentType: v.string(),
    sizeBytes: v.number(),
    storageId: v.id("_storage"),
    inline: v.boolean(),                                    // inline images vs true attachments
    contentId: v.optional(v.string()),                      // for inline <img src="cid:...">
  })
    .index("by_message", ["messageId"]),

  // Suppression list — bounces, complaints, hard-unsubscribes.
  emailSuppressions: defineTable({
    workspaceId: v.id("workspaces"),
    email: v.string(),                                       // normalized lowercase
    reason: v.union(
      v.literal("bounce_hard"),
      v.literal("bounce_soft"),
      v.literal("complaint"),
      v.literal("unsubscribe"),
      v.literal("manual"),
    ),
    source: v.optional(v.string()),                          // 'resend_webhook' | 'operator' | …
    addedBy: v.optional(v.id("users")),
  })
    .index("by_workspace_email", ["workspaceId", "email"])
    .index("by_workspace", ["workspaceId"]),

  // Idempotent webhook event log — used by inbound Resend + Paystack + Meta.
  webhookEvents: defineTable({
    provider: v.string(),                                    // 'resend' | 'paystack' | 'meta_whatsapp' | 'docuseal'
    externalId: v.string(),                                  // provider event id
    organizationId: v.optional(v.id("organizations")),
    eventType: v.string(),
    rawPayload: v.any(),
    receivedAt: v.number(),
    processedAt: v.optional(v.number()),
    processingError: v.optional(v.string()),
  })
    .index("by_provider_external", ["provider", "externalId"])
    .index("by_provider_received", ["provider", "receivedAt"]),

  /* ============================================================ */
  /* Phase 3 — Prospector (Google Maps lead generation)             */
  /* ============================================================ */

  // A saved search — the query itself plus the last-run metadata.
  // Justine types "Boutiques in Westlands, Nairobi", we save it, and
  // she can re-run/expand later without retyping.
  prospectorSearches: defineTable({
    workspaceId: v.id("workspaces"),
    query: v.string(),                                        // free-form text
    location: v.optional(v.string()),                         // "Nairobi, KE"
    locationBias: v.optional(v.any()),                        // Google circle/rectangle
    resultCount: v.number(),
    importedCount: v.number(),                                // how many actually became companies
    lastRunAt: v.optional(v.number()),
    lastRunBy: v.optional(v.id("users")),
    nextPageToken: v.optional(v.string()),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_time", ["workspaceId", "lastRunAt"]),

  // A single result from a search — cached so we don't re-query.
  // These are transient (until imported), but keep the raw record
  // for scoring and enrichment.
  prospectorResults: defineTable({
    workspaceId: v.id("workspaces"),
    searchId: v.id("prospectorSearches"),
    googlePlaceId: v.string(),                                // unique per Google
    name: v.string(),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    country: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    phone: v.optional(v.string()),                            // E.164 if we can normalize
    phoneRaw: v.optional(v.string()),                         // original from Google
    website: v.optional(v.string()),
    email: v.optional(v.string()),                            // populated by enrichment
    googleMapsUri: v.optional(v.string()),
    types: v.optional(v.array(v.string())),                   // ['cafe', 'restaurant']
    rating: v.optional(v.number()),
    ratingCount: v.optional(v.number()),
    businessStatus: v.optional(v.string()),
    rawPlaceData: v.optional(v.any()),
    // Import state
    importedAt: v.optional(v.number()),
    importedCompanyId: v.optional(v.id("companies")),
    // Enrichment
    enrichedAt: v.optional(v.number()),
    enrichmentStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("in_progress"),
        v.literal("done"),
        v.literal("failed"),
        v.literal("no_website"),
      ),
    ),
    enrichmentError: v.optional(v.string()),
    // Fit score — populated by AI later
    fitScore: v.optional(v.number()),
    fitReasoning: v.optional(v.string()),
    // Suppression — set when the founder rejects, so re-runs skip it
    rejectedAt: v.optional(v.number()),
    rejectedReason: v.optional(v.string()),
  })
    .index("by_search", ["searchId"])
    .index("by_workspace_place", ["workspaceId", "googlePlaceId"])
    .index("by_workspace_search_imported", ["workspaceId", "searchId", "importedAt"]),

  // Workspace-scoped suppression — Google Place IDs that should
  // never appear in results again (e.g., competitors, dead leads).
  prospectorSuppressions: defineTable({
    workspaceId: v.id("workspaces"),
    googlePlaceId: v.string(),
    reason: v.optional(v.string()),
    addedBy: v.optional(v.id("users")),
  })
    .index("by_workspace_place", ["workspaceId", "googlePlaceId"])
    .index("by_workspace", ["workspaceId"]),

  /* ============================================================ */
  /* Phase 4 — WhatsApp (Meta Cloud API)                            */
  /* ============================================================ */

  // Per-workspace WhatsApp connection. Multiple phone numbers may
  // belong to one WABA, so we key by phoneNumberId. The access token
  // and app secret live encrypted under orgIntegrationKeys
  // (provider='meta_whatsapp'); this table stores the non-secret ids
  // and status so we can validate webhooks without decrypting.
  whatsappConnections: defineTable({
    workspaceId: v.id("workspaces"),
    wabaId: v.string(),                                       // Meta WhatsApp Business Account ID
    phoneNumberId: v.string(),                                // Meta Phone Number ID (unique across Meta)
    displayPhoneNumber: v.string(),                           // "+254 700 000 000"
    verifiedName: v.optional(v.string()),
    webhookVerifyToken: v.string(),                           // shared secret set on Meta side
    qualityRating: v.optional(v.string()),                    // GREEN|YELLOW|RED from Meta
    messagingLimitTier: v.optional(v.string()),               // TIER_1K|TIER_10K|TIER_100K|UNLIMITED
    status: v.union(
      v.literal("connected"),
      v.literal("disconnected"),
      v.literal("banned"),
      v.literal("pending"),
    ),
    lastSyncAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_phone_number_id", ["phoneNumberId"])
    .index("by_waba", ["wabaId"]),

  // Approved templates (cache) — fetched from Meta on connect + refresh
  // via cron. Templates are how you initiate conversations outside the
  // 24-hour customer service window.
  whatsappTemplates: defineTable({
    workspaceId: v.id("workspaces"),
    wabaId: v.string(),
    externalTemplateId: v.optional(v.string()),               // Meta's template ID
    name: v.string(),
    language: v.string(),                                      // 'en' | 'en_US' | 'sw'
    category: v.string(),                                      // MARKETING | UTILITY | AUTHENTICATION
    status: v.string(),                                        // APPROVED | PENDING | REJECTED | DISABLED
    components: v.any(),                                       // full structure
    lastSyncAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_workspace_name", ["workspaceId", "name"]),

  // Media cache — Meta uses opaque media_id references. We download
  // once, store in Convex _storage, and reuse.
  whatsappMedia: defineTable({
    workspaceId: v.id("workspaces"),
    metaMediaId: v.string(),                                   // Meta media id
    storageId: v.optional(v.id("_storage")),                  // set after download
    filename: v.optional(v.string()),
    contentType: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    downloadedAt: v.optional(v.number()),
    downloadError: v.optional(v.string()),
  })
    .index("by_workspace_media", ["workspaceId", "metaMediaId"]),

  // Opt-outs — anyone who replies "STOP" or requests removal.
  whatsappOptOuts: defineTable({
    workspaceId: v.id("workspaces"),
    phone: v.string(),                                         // E.164
    reason: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_workspace_phone", ["workspaceId", "phone"])
    .index("by_workspace", ["workspaceId"]),

  /* ============================================================ */
  /* Phase 5 — AI gateway                                           */
  /* ============================================================ */

  // Per-workspace feature → model chain override. If a row exists,
  // its chain is used. Otherwise the gateway falls back to the
  // hard-coded default chain from `convex/ai/registry.ts`.
  aiFeatureBindings: defineTable({
    workspaceId: v.id("workspaces"),
    featureId: v.string(),                                    // 'draft_email_reply' | 'fit_score_lead' | …
    chain: v.array(
      v.object({
        provider: v.string(),                                  // 'groq' | 'gemini' | …
        model: v.string(),                                     // 'llama-3.3-70b-versatile' | …
        maxTokens: v.optional(v.number()),
        temperature: v.optional(v.number()),
        // Optional per-step tools (Composio + Groq Compound autonomous)
        tools: v.optional(v.array(v.string())),
      }),
    ),
    updatedBy: v.optional(v.id("users")),
  })
    .index("by_workspace_feature", ["workspaceId", "featureId"]),

  // Every AI call — for cost accounting, debugging, and rate-limit
  // enforcement.
  aiCallLog: defineTable({
    workspaceId: v.id("workspaces"),
    organizationId: v.id("organizations"),
    actorId: v.optional(v.id("users")),
    featureId: v.string(),
    provider: v.string(),
    model: v.string(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    status: v.union(
      v.literal("success"),
      v.literal("fallback"),
      v.literal("failed"),
    ),
    error: v.optional(v.string()),
    // Correlation ids to link back to the record we were acting on
    resourceType: v.optional(v.string()),
    resourceId: v.optional(v.string()),
    // Cost in USD micro-units (int64 for precision — no floats)
    costMicroUsd: v.optional(v.int64()),
    // Truncated prompt/response — for debugging; full payload is
    // typically re-derivable from the resource
    promptPreview: v.optional(v.string()),
    responsePreview: v.optional(v.string()),
  })
    .index("by_workspace_time", ["workspaceId"])
    .index("by_workspace_feature_time", ["workspaceId", "featureId"])
    .index("by_org_time", ["organizationId"])
    .index("by_resource", ["resourceType", "resourceId"]),

  /* ============================================================ */
  /* Phase 6 — Pipelines + deals                                    */
  /* ============================================================ */

  pipelines: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    description: v.optional(v.string()),
    kind: v.string(),                                          // 'omnix_license' | 'studio_project' | 'marketplace_creator' | 'custom'
    order: v.number(),
    defaultCurrency: v.string(),                               // 'KES' default
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_order", ["workspaceId", "order"]),

  pipelineStages: defineTable({
    workspaceId: v.id("workspaces"),
    pipelineId: v.id("pipelines"),
    name: v.string(),
    order: v.number(),
    // Terminal states — a deal in a won stage counts toward revenue,
    // a lost stage counts toward win-rate denominator.
    isWon: v.boolean(),
    isLost: v.boolean(),
    // Rotting detection — flag deals in this stage older than N days
    rotDays: v.optional(v.number()),
    color: v.optional(v.string()),                              // hex/oklch for the column header
  })
    .index("by_pipeline_order", ["pipelineId", "order"])
    .index("by_workspace", ["workspaceId"]),

  deals: defineTable({
    workspaceId: v.id("workspaces"),
    pipelineId: v.id("pipelines"),
    stageId: v.id("pipelineStages"),
    name: v.string(),
    amountCents: v.int64(),                                     // always in cents (never floats)
    currency: v.string(),                                        // 'KES' | 'USD'
    contactId: v.optional(v.id("contacts")),
    companyId: v.optional(v.id("companies")),
    ownerId: v.optional(v.id("users")),
    // Where this deal came from — keeps attribution honest for Phase 9.
    source: v.optional(v.string()),                              // 'prospector' | 'inbound_email' | 'whatsapp' | 'manual' | …
    sourceRefType: v.optional(v.string()),
    sourceRefId: v.optional(v.string()),
    expectedCloseDate: v.optional(v.number()),
    actualCloseDate: v.optional(v.number()),
    wonAt: v.optional(v.number()),
    lostAt: v.optional(v.number()),
    winReason: v.optional(v.string()),
    lossReason: v.optional(v.string()),
    // AI health tracking (Phase 5 feature classify_deal_health, wired lazily)
    healthScore: v.optional(v.number()),                        // 0-100
    healthNotes: v.optional(v.string()),
    healthCheckedAt: v.optional(v.number()),
    lastActivityAt: v.number(),                                  // touched on any related timeline event
    tags: v.array(v.string()),
    customFields: v.optional(v.any()),
    // Ordering within a stage — allows manual reorder without
    // recomputing all others. New deals get max+1.
    stageOrder: v.number(),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_pipeline", ["workspaceId", "pipelineId"])
    .index("by_pipeline_stage_order", ["pipelineId", "stageId", "stageOrder"])
    .index("by_workspace_stage", ["workspaceId", "stageId"])
    .index("by_workspace_owner", ["workspaceId", "ownerId"])
    .index("by_workspace_contact", ["workspaceId", "contactId"])
    .index("by_workspace_company", ["workspaceId", "companyId"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["workspaceId", "archivedAt"],
    }),
});
