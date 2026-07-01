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
});
