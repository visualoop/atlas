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
  v.literal("deepseek"),
  v.literal("xai"),
  v.literal("perplexity"),
  v.literal("google_vertex"),
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
  // Automation hub
  v.literal("composio"),
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
  v.literal("revoked_session"),
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
    // Referral program
    referralCode: v.optional(v.string()),          // unique 8-char code for this user
    referredByUserId: v.optional(v.id("users")),   // who invited me
    referralCreditsCents: v.optional(v.int64()),   // accumulated credits (money)
    referralCurrency: v.optional(v.string()),      // 'KES' default
  })
    .index("by_userId", ["userId"])
    .index("by_referral_code", ["referralCode"]),

  // TOTP-based 2FA for user accounts. The secret is AES-GCM encrypted
  // with the platform CONFIG_ENCRYPTION_KEY before storage.
  userTwoFactor: defineTable({
    userId: v.id("users"),
    encryptedSecret: v.string(),
    enabledAt: v.number(),
    lastVerifiedAt: v.optional(v.number()),
    // Recovery — 8 one-shot codes if the user loses their device
    recoveryCodesHash: v.optional(v.array(v.string())),
  })
    .index("by_userId", ["userId"]),

  // One row per successful referral. Idempotent by (referredUserId).
  referralClaims: defineTable({
    referrerUserId: v.id("users"),                 // who gets the credit
    referredUserId: v.id("users"),                 // the new signup
    referralCode: v.string(),                       // snapshot of the code used
    creditedAmountCents: v.int64(),                 // how much the referrer earned
    currency: v.string(),                            // 'KES'
    status: v.union(
      v.literal("credited"),                          // credit applied
      v.literal("pending_verification"),              // maybe: hold until referred user does X
      v.literal("reversed"),                          // fraud / cancellation
    ),
    claimedAt: v.number(),
    reversedAt: v.optional(v.number()),
    reversedReason: v.optional(v.string()),
  })
    .index("by_referrer_time", ["referrerUserId", "claimedAt"])
    .index("by_referred", ["referredUserId"])
    .index("by_status", ["status"]),

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
    // Brand + context for every AI feature. If populated, threaded into
    // every prompt (Copilot, campaign runner, meeting brief, trends, etc).
    website: v.optional(v.string()),
    oneLiner: v.optional(v.string()),        // 'M-PESA POS for salons + spas'
    elevatorPitch: v.optional(v.string()),   // 2-3 sentence value prop
    offerings: v.optional(v.string()),       // markdown list of products / services
    targetMarket: v.optional(v.string()),    // ICP description
    brandVoice: v.optional(v.string()),      // 'confident + direct, Kenyan English, no marketing fluff'
    coreValues: v.optional(v.string()),
    pricingSummary: v.optional(v.string()),
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

  /* ============================================================ */
  /* Phase 7a — Documents (proposals, quotes, invoices, contracts)  */
  /* ============================================================ */

  documents: defineTable({
    workspaceId: v.id("workspaces"),
    kind: v.union(
      v.literal("proposal"),
      v.literal("quote"),
      v.literal("invoice"),
      v.literal("contract"),
      v.literal("brief"),
      v.literal("statement_of_work"),
    ),
    // Human-readable serial per workspace + kind, e.g. INV-2026-0042.
    number: v.optional(v.string()),
    title: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("viewed"),
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("paid"),
      v.literal("partially_paid"),
      v.literal("overdue"),
      v.literal("cancelled"),
      v.literal("void"),
    ),
    // TipTap JSON body — content between locked sections.
    body: v.any(),
    bodyText: v.string(),                                   // plaintext extract for FTS
    // Money — always cents. Line items sum to subtotalCents.
    currency: v.string(),                                   // 'KES' default
    subtotalCents: v.int64(),
    taxCents: v.int64(),                                    // VAT etc.
    discountCents: v.int64(),
    totalCents: v.int64(),
    // Tax config
    taxRate: v.optional(v.number()),                        // e.g. 0.16 for 16% VAT
    taxLabel: v.optional(v.string()),                        // 'VAT' | 'GST' | ''
    // eTIMS + M-PESA for Kenyan invoices
    etimsReference: v.optional(v.string()),                 // KRA eTIMS control code
    mpesaPaybill: v.optional(v.string()),
    mpesaTill: v.optional(v.string()),
    mpesaAccountRef: v.optional(v.string()),                // e.g. deal id or invoice number
    // Links
    dealId: v.optional(v.id("deals")),
    contactId: v.optional(v.id("contacts")),
    companyId: v.optional(v.id("companies")),
    templateId: v.optional(v.id("documentTemplates")),
    ownerId: v.optional(v.id("users")),
    // Dates
    issueDate: v.optional(v.number()),
    dueDate: v.optional(v.number()),                        // invoice due
    validUntil: v.optional(v.number()),                     // quote expiry
    sentAt: v.optional(v.number()),
    viewedAt: v.optional(v.number()),
    acceptedAt: v.optional(v.number()),
    // Rendered PDF cache
    pdfStorageId: v.optional(v.id("_storage")),
    pdfRenderedAt: v.optional(v.number()),
    // Notes visible to recipient
    footerNote: v.optional(v.string()),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_kind", ["workspaceId", "kind"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_workspace_deal", ["workspaceId", "dealId"])
    .index("by_workspace_company", ["workspaceId", "companyId"])
    .index("by_workspace_contact", ["workspaceId", "contactId"])
    .index("by_workspace_number", ["workspaceId", "kind", "number"])
    .searchIndex("search_body", {
      searchField: "bodyText",
      filterFields: ["workspaceId", "kind", "archivedAt"],
    }),

  documentLineItems: defineTable({
    workspaceId: v.id("workspaces"),
    documentId: v.id("documents"),
    order: v.number(),
    description: v.string(),
    quantity: v.number(),                                   // 1, 1.5, etc.
    unit: v.optional(v.string()),                            // 'hour' | 'day' | 'item' | 'month'
    unitPriceCents: v.int64(),
    discountCents: v.int64(),
    taxable: v.boolean(),
    lineTotalCents: v.int64(),                              // qty * unit - discount
  })
    .index("by_document_order", ["documentId", "order"]),

  documentTemplates: defineTable({
    workspaceId: v.id("workspaces"),
    kind: v.string(),                                        // matches documents.kind
    name: v.string(),
    description: v.optional(v.string()),
    // TipTap JSON with special "locked" nodes for pricing / terms
    body: v.any(),
    // Default fields to seed a doc created from this template
    defaults: v.optional(v.any()),                           // { validityDays, taxRate, footerNote, … }
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_kind", ["workspaceId", "kind"]),

  // Public shareable link for a document — recipient views without login.
  documentShares: defineTable({
    workspaceId: v.id("workspaces"),
    documentId: v.id("documents"),
    token: v.string(),                                       // random 32-char, url-safe
    createdBy: v.id("users"),
    accessCount: v.number(),
    lastAccessedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    // Track recipient actions taken via the share link
    acceptedAt: v.optional(v.number()),
    acceptedByEmail: v.optional(v.string()),
    acceptedByName: v.optional(v.string()),
    acceptedSignatureData: v.optional(v.string()),          // base64 PNG for click-signature
  })
    .index("by_token", ["token"])
    .index("by_document", ["documentId"])
    .index("by_workspace", ["workspaceId"]),

  // DocuSeal integration — one row per submitted signature request
  documentSignatures: defineTable({
    workspaceId: v.id("workspaces"),
    documentId: v.id("documents"),
    provider: v.union(v.literal("docuseal"), v.literal("internal")),
    externalId: v.optional(v.string()),                     // DocuSeal submission id
    signerEmail: v.string(),
    signerName: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("viewed"),
      v.literal("signed"),
      v.literal("declined"),
      v.literal("expired"),
    ),
    signedAt: v.optional(v.number()),
    signedPdfStorageId: v.optional(v.id("_storage")),
    auditTrail: v.optional(v.any()),                        // provider audit log
  })
    .index("by_document", ["documentId"])
    .index("by_external", ["externalId"])
    .index("by_workspace", ["workspaceId"]),

  /* ============================================================ */
  /* Phase 7a — Sales Enablement Vault                              */
  /* ============================================================ */

  salesAssets: defineTable({
    workspaceId: v.id("workspaces"),
    kind: v.union(
      v.literal("playbook"),
      v.literal("battlecard"),
      v.literal("testimonial"),
      v.literal("case_study"),
      v.literal("one_pager"),
      v.literal("demo_script"),
      v.literal("objection"),
    ),
    title: v.string(),
    // TipTap JSON body
    body: v.any(),
    bodyText: v.string(),
    // Metadata for filtering / retrieval
    tags: v.array(v.string()),
    productId: v.optional(v.string()),                       // 'omnix' | 'blyss_studio' | 'marketplace'
    persona: v.optional(v.string()),                         // 'retailer' | 'agency' | 'creator'
    stage: v.optional(v.string()),                           // 'discovery' | 'demo' | 'proposal' | …
    // For testimonials/case studies — the source contact/company
    contactId: v.optional(v.id("contacts")),
    companyId: v.optional(v.id("companies")),
    // Optional attached file (case-study PDF)
    fileId: v.optional(v.id("files")),
    // Usage stats — how often was this pulled into a conversation
    usageCount: v.number(),
    lastUsedAt: v.optional(v.number()),
    authorId: v.id("users"),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_kind", ["workspaceId", "kind"])
    .index("by_workspace_product", ["workspaceId", "productId"])
    .searchIndex("search_body", {
      searchField: "bodyText",
      filterFields: ["workspaceId", "kind", "productId", "archivedAt"],
    }),

  /* ============================================================ */
  /* Phase 7b — Payments (Paystack full-stack)                       */
  /* ============================================================ */

  // A Paystack customer, keyed by our contact id. One customer_code
  // per (workspace, contact) so historic payments accumulate.
  paystackCustomers: defineTable({
    workspaceId: v.id("workspaces"),
    contactId: v.id("contacts"),
    paystackCustomerCode: v.string(),                        // 'CUS_xxx'
    email: v.string(),
    firstSyncAt: v.number(),
    lastSyncAt: v.optional(v.number()),
  })
    .index("by_workspace_contact", ["workspaceId", "contactId"])
    .index("by_customer_code", ["paystackCustomerCode"]),

  // A specific request-to-pay tied to an invoice or ad-hoc amount.
  // Reference is unique and used by Paystack to correlate.
  paymentRequests: defineTable({
    workspaceId: v.id("workspaces"),
    organizationId: v.id("organizations"),
    // Reference sent to Paystack — must be unique per Paystack account
    reference: v.string(),
    amountCents: v.int64(),                                  // in currency subunits
    currency: v.string(),                                     // 'KES' | 'USD' | 'NGN' etc.
    description: v.string(),
    // Links
    documentId: v.optional(v.id("documents")),              // invoice being paid
    contactId: v.optional(v.id("contacts")),
    dealId: v.optional(v.id("deals")),
    // Paystack response
    accessCode: v.optional(v.string()),                     // for embed
    authorizationUrl: v.optional(v.string()),               // hosted checkout URL
    // State
    status: v.union(
      v.literal("initialized"),
      v.literal("pending"),
      v.literal("success"),
      v.literal("failed"),
      v.literal("abandoned"),
      v.literal("cancelled"),
    ),
    // Verification payload from Paystack (after charge.success)
    channel: v.optional(v.string()),                        // 'card' | 'mobile_money' | 'bank_transfer'
    paidAt: v.optional(v.number()),
    feeCents: v.optional(v.int64()),                        // Paystack's fee
    verifiedPayload: v.optional(v.any()),
    // Who initiated it
    createdBy: v.optional(v.id("users")),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_workspace_document", ["workspaceId", "documentId"])
    .index("by_reference", ["reference"]),

  // Full webhook payloads — kept for audit + replay.
  paystackTransactions: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    organizationId: v.optional(v.id("organizations")),
    reference: v.string(),
    event: v.string(),                                       // 'charge.success' | 'transfer.success' | …
    externalId: v.optional(v.string()),                      // paystack tx id
    amountCents: v.optional(v.int64()),
    currency: v.optional(v.string()),
    channel: v.optional(v.string()),
    status: v.optional(v.string()),
    payload: v.any(),
    receivedAt: v.number(),
    processed: v.boolean(),
    processingError: v.optional(v.string()),
  })
    .index("by_reference", ["reference"])
    .index("by_workspace_time", ["workspaceId", "receivedAt"])
    .index("by_event_time", ["event", "receivedAt"]),

  // Outbound transfers (payouts to bank accounts or M-PESA).
  paystackTransfers: defineTable({
    workspaceId: v.id("workspaces"),
    organizationId: v.id("organizations"),
    reference: v.string(),
    recipientCode: v.string(),                              // Paystack RCP_xxx
    recipientLabel: v.string(),                             // human-readable name
    amountCents: v.int64(),
    currency: v.string(),
    reason: v.optional(v.string()),
    externalId: v.optional(v.string()),                     // paystack transfer id
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("success"),
      v.literal("failed"),
      v.literal("reversed"),
      v.literal("otp_required"),
    ),
    failureReason: v.optional(v.string()),
    transferredAt: v.optional(v.number()),
    createdBy: v.id("users"),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_reference", ["reference"])
    .index("by_workspace_status", ["workspaceId", "status"]),

  /* ============================================================ */
  /* Phase 8 — Campaigns + drip sequences                           */
  /* ============================================================ */

  campaigns: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    description: v.optional(v.string()),
    channel: v.union(
      v.literal("email"),
      v.literal("whatsapp"),
      v.literal("multi"),
    ),
    status: v.union(
      v.literal("draft"),
      v.literal("scheduled"),
      v.literal("running"),
      v.literal("paused"),
      v.literal("complete"),
      v.literal("cancelled"),
    ),
    // Audience — a simple filter shape resolved at launch time.
    // { lifecycleStage: string[], tags: string[], companyId?, ownerId? }
    audienceFilter: v.optional(v.any()),
    // How many messages / day per recipient? Global daily throttle
    // to avoid provider rate limits and human overload.
    dailyThrottle: v.optional(v.number()),                  // messages per hour across all recipients
    // Stop rules — pause on reply, stop on conversion.
    stopOnReply: v.boolean(),
    stopOnConversion: v.boolean(),
    // Scheduling
    scheduledStartAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    // Ownership
    ownerId: v.optional(v.id("users")),
    // Aggregates — updated on send/reply/convert (avoids fanout)
    recipientCount: v.number(),
    sentCount: v.number(),
    openCount: v.number(),
    replyCount: v.number(),
    conversionCount: v.number(),
    optOutCount: v.number(),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_workspace_owner", ["workspaceId", "ownerId"]),

  campaignSteps: defineTable({
    campaignId: v.id("campaigns"),
    workspaceId: v.id("workspaces"),
    order: v.number(),
    // Delay in hours from previous step (or from launch for step 0).
    delayHours: v.number(),
    channel: v.union(v.literal("email"), v.literal("whatsapp")),
    // Email-specific
    subject: v.optional(v.string()),
    bodyHtml: v.optional(v.string()),
    bodyText: v.optional(v.string()),
    // WhatsApp-specific
    templateName: v.optional(v.string()),
    templateLanguage: v.optional(v.string()),
    templateVariables: v.optional(v.array(v.string())),     // positional
    // Sender identity override for this step
    senderIdentityId: v.optional(v.id("senderIdentities")),
    // A/B — coalesce later, MVP just runs one variant
    variantLabel: v.optional(v.string()),
  })
    .index("by_campaign_order", ["campaignId", "order"])
    .index("by_workspace", ["workspaceId"]),

  campaignRecipients: defineTable({
    campaignId: v.id("campaigns"),
    workspaceId: v.id("workspaces"),
    contactId: v.id("contacts"),
    state: v.union(
      v.literal("pending"),
      v.literal("sending"),
      v.literal("sent"),
      v.literal("replied"),
      v.literal("converted"),
      v.literal("opted_out"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("paused"),
    ),
    // Where we are in the step sequence — 0 = first step queued.
    currentStepIndex: v.number(),
    nextSendAt: v.optional(v.number()),                     // when the cron should try this recipient next
    lastSentAt: v.optional(v.number()),
    // Correlation ids for tracking replies/conversions back to this row
    lastConversationId: v.optional(v.id("conversations")),
    dealId: v.optional(v.id("deals")),                      // set when a deal is linked
    failureReason: v.optional(v.string()),
  })
    .index("by_campaign_state", ["campaignId", "state"])
    .index("by_workspace", ["workspaceId"])
    .index("by_campaign_next", ["campaignId", "state", "nextSendAt"])
    .index("by_contact", ["contactId"]),

  campaignEvents: defineTable({
    campaignId: v.id("campaigns"),
    workspaceId: v.id("workspaces"),
    recipientId: v.id("campaignRecipients"),
    stepIndex: v.optional(v.number()),
    eventType: v.union(
      v.literal("sent"),
      v.literal("opened"),
      v.literal("clicked"),
      v.literal("replied"),
      v.literal("converted"),
      v.literal("opted_out"),
      v.literal("bounced"),
      v.literal("failed"),
    ),
    messageId: v.optional(v.id("messages")),
    dealId: v.optional(v.id("deals")),
    payload: v.optional(v.any()),
    occurredAt: v.number(),
  })
    .index("by_campaign_time", ["campaignId", "occurredAt"])
    .index("by_recipient_time", ["recipientId", "occurredAt"])
    .index("by_workspace_type", ["workspaceId", "eventType"]),

  broadcastEvents: defineTable({
    broadcastId: v.id("broadcasts"),
    workspaceId: v.id("workspaces"),
    audienceMemberId: v.id("audienceMembers"),
    eventType: v.union(
      v.literal("sent"),
      v.literal("failed"),
      v.literal("opened"),
      v.literal("clicked"),
      v.literal("unsubscribed"),
    ),
    messageId: v.optional(v.id("messages")),
    occurredAt: v.number(),
    payload: v.optional(v.any()),
  })
    .index("by_broadcast_member", ["broadcastId", "audienceMemberId"])
    .index("by_broadcast_time", ["broadcastId", "occurredAt"])
    .index("by_workspace_time", ["workspaceId", "occurredAt"]),

  /* ============================================================ */
  /* Phase 8a — Social Publishing (FB / IG / LinkedIn)              */
  /* ============================================================ */

  socialConnections: defineTable({
    workspaceId: v.id("workspaces"),
    platform: v.union(
      v.literal("facebook_page"),                            // FB Business Page
      v.literal("instagram_business"),                       // IG Business account
      v.literal("linkedin_personal"),                        // LinkedIn personal profile
      v.literal("linkedin_company"),                         // LinkedIn company page
    ),
    externalId: v.string(),                                  // Meta Page ID / IG account ID / LI URN
    displayName: v.string(),                                  // "Blyss" / "Justine Gichana"
    avatarUrl: v.optional(v.string()),
    // Token metadata — actual encrypted values live in orgIntegrationKeys
    // (per-platform provider labels like 'meta_page_<id>'). We keep the
    // expiry hint here so the UI can flag stale tokens.
    tokenExpiresAt: v.optional(v.number()),
    scopes: v.optional(v.array(v.string())),
    status: v.union(
      v.literal("connected"),
      v.literal("token_expired"),
      v.literal("revoked"),
      v.literal("error"),
    ),
    connectedBy: v.id("users"),
    lastSyncAt: v.optional(v.number()),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_platform", ["workspaceId", "platform"])
    .index("by_external_id", ["externalId"]),

  socialPosts: defineTable({
    workspaceId: v.id("workspaces"),
    // A single "post" can go out to multiple connections (cross-post).
    connectionIds: v.array(v.id("socialConnections")),
    // Content — shared across platforms but variants can be per-platform
    caption: v.string(),                                     // primary body
    perPlatformOverrides: v.optional(v.any()),               // { [connectionId]: { caption?, mediaIds? } }
    mediaFileIds: v.array(v.id("files")),                    // uploaded to Convex storage
    firstLink: v.optional(v.string()),                        // for LI/FB link preview
    status: v.union(
      v.literal("draft"),
      v.literal("scheduled"),
      v.literal("publishing"),
      v.literal("published"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    scheduledFor: v.optional(v.number()),
    publishedAt: v.optional(v.number()),
    // Per-connection publish state — updated as each platform completes
    // { [connectionId]: { status, externalPostId, externalUrl, publishedAt, error } }
    publishResults: v.optional(v.any()),
    // Engagement aggregates — refreshed by cron
    likeCount: v.optional(v.number()),
    commentCount: v.optional(v.number()),
    shareCount: v.optional(v.number()),
    impressionCount: v.optional(v.number()),
    reachCount: v.optional(v.number()),
    lastInsightsAt: v.optional(v.number()),
    // Ownership
    ownerId: v.id("users"),
    // Optional link to a campaign or content piece
    campaignId: v.optional(v.id("campaigns")),
    contentPieceId: v.optional(v.string()),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace_time", ["workspaceId"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_workspace_scheduled", ["workspaceId", "status", "scheduledFor"])
    .searchIndex("search_caption", {
      searchField: "caption",
      filterFields: ["workspaceId", "status", "archivedAt"],
    }),

  socialComments: defineTable({
    workspaceId: v.id("workspaces"),
    postId: v.id("socialPosts"),
    connectionId: v.id("socialConnections"),
    platform: v.string(),
    externalCommentId: v.string(),
    externalAuthorId: v.optional(v.string()),
    authorName: v.string(),
    authorAvatarUrl: v.optional(v.string()),
    text: v.string(),
    sentiment: v.optional(v.string()),                       // 'positive' | 'neutral' | 'negative'
    // Reply state — Atlas replies land as conversations for unified inbox
    conversationId: v.optional(v.id("conversations")),
    receivedAt: v.number(),
    hidden: v.boolean(),
  })
    .index("by_post_time", ["postId", "receivedAt"])
    .index("by_workspace_time", ["workspaceId", "receivedAt"])
    .index("by_external", ["externalCommentId"]),

  /* ============================================================ */
  /* Phase 8b — Content & Marketing Hub                             */
  /* ============================================================ */

  // Newsletter audiences — a saved list of email subscribers with tags.
  // Different from campaignRecipients: audiences persist across broadcasts.
  audiences: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),                                        // 'Weekly newsletter' | 'Product updates'
    description: v.optional(v.string()),
    // Optional external mirror (Resend Audience id) — one-way sync when set
    resendAudienceId: v.optional(v.string()),
    memberCount: v.number(),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_resend", ["workspaceId", "resendAudienceId"]),

  audienceMembers: defineTable({
    workspaceId: v.id("workspaces"),
    audienceId: v.id("audiences"),
    email: v.string(),                                       // normalized lowercase
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    // Source contact if this member is also in the CRM
    contactId: v.optional(v.id("contacts")),
    subscribedAt: v.number(),
    unsubscribedAt: v.optional(v.number()),
    // For double opt-in
    confirmedAt: v.optional(v.number()),
    tags: v.array(v.string()),
    // Freeform metadata from signup form
    meta: v.optional(v.any()),
  })
    .index("by_audience", ["audienceId"])
    .index("by_audience_email", ["audienceId", "email"])
    .index("by_workspace_email", ["workspaceId", "email"])
    .index("by_workspace_contact", ["workspaceId", "contactId"]),

  // Broadcasts — one-off newsletter sends to an audience (vs. campaigns
  // which drip through steps).
  broadcasts: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),                                        // internal label
    audienceId: v.id("audiences"),
    fromIdentityId: v.optional(v.id("senderIdentities")),
    subject: v.string(),
    // React Email JSX rendered to HTML — for MVP we store TipTap JSON
    // + rendered HTML side by side (like documents).
    body: v.any(),
    bodyHtml: v.optional(v.string()),
    bodyText: v.optional(v.string()),
    // Preheader text — appears in the inbox preview after the subject
    preheader: v.optional(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("scheduled"),
      v.literal("sending"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    scheduledFor: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    // Aggregate stats
    recipientCount: v.number(),
    sentCount: v.number(),
    openCount: v.number(),
    clickCount: v.number(),
    unsubscribeCount: v.number(),
    // External Resend id
    resendBroadcastId: v.optional(v.string()),
    ownerId: v.id("users"),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace_time", ["workspaceId"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_workspace_scheduled", ["workspaceId", "status", "scheduledFor"])
    .searchIndex("search_subject", {
      searchField: "subject",
      filterFields: ["workspaceId", "status", "archivedAt"],
    }),

  // Landing pages — public, workspace-scoped, slug-addressed.
  // Rendered at /p/<workspaceSlug>/<pageSlug>. Kinds: product-launch,
  // waitlist, event, lead-magnet, custom.
  landingPages: defineTable({
    workspaceId: v.id("workspaces"),
    slug: v.string(),                                        // 'omnix-launch' — unique per workspace
    kind: v.union(
      v.literal("product_launch"),
      v.literal("waitlist"),
      v.literal("event"),
      v.literal("lead_magnet"),
      v.literal("custom"),
    ),
    title: v.string(),
    subtitle: v.optional(v.string()),
    // TipTap JSON for the body
    body: v.any(),
    bodyText: v.string(),
    // Hero image + optional social preview
    heroFileId: v.optional(v.id("files")),
    ogImageFileId: v.optional(v.id("files")),
    // Form config — what fields to capture on signup
    formFields: v.optional(v.array(v.string())),             // ['email','firstName','lastName','company']
    // Optional lead-magnet: file to deliver after signup
    leadMagnetFileId: v.optional(v.id("files")),
    // Optional linked audience — signups get added here
    audienceId: v.optional(v.id("audiences")),
    // Default tags applied to created contacts
    defaultTags: v.optional(v.array(v.string())),
    // SEO
    metaDescription: v.optional(v.string()),
    // Visitor + signup aggregates
    viewCount: v.number(),
    signupCount: v.number(),
    // Publication
    status: v.union(
      v.literal("draft"),
      v.literal("published"),
      v.literal("archived"),
    ),
    publishedAt: v.optional(v.number()),
    // Ownership
    ownerId: v.id("users"),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_slug", ["workspaceId", "slug"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_workspace_kind", ["workspaceId", "kind"]),

  // Signup events — one row per submission on a landing page.
  // Distinct from audienceMembers so we can debug abuse.
  landingSignups: defineTable({
    workspaceId: v.id("workspaces"),
    pageId: v.id("landingPages"),
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    company: v.optional(v.string()),
    meta: v.optional(v.any()),
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    // Was a contact created / found?
    contactId: v.optional(v.id("contacts")),
    // Was an audience member row created?
    audienceMemberId: v.optional(v.id("audienceMembers")),
    // Did the lead-magnet email fire?
    leadMagnetDelivered: v.boolean(),
    receivedAt: v.number(),
  })
    .index("by_page_time", ["pageId", "receivedAt"])
    .index("by_workspace_time", ["workspaceId", "receivedAt"])
    .index("by_workspace_email", ["workspaceId", "email"]),

  // SEO idea backlog — generated by Groq Compound daily; founder
  // triages into content pieces.
  seoIdeas: defineTable({
    workspaceId: v.id("workspaces"),
    title: v.string(),                                       // headline candidate
    angle: v.string(),                                       // 1-line pitch
    keywords: v.array(v.string()),
    competitorRefs: v.optional(v.array(v.string())),         // urls that inspired this
    productId: v.optional(v.string()),                       // 'omnix' | 'blyss_studio' | 'marketplace'
    priority: v.optional(v.number()),                        // 0-100 AI-assigned
    status: v.union(
      v.literal("new"),
      v.literal("shortlisted"),
      v.literal("drafting"),
      v.literal("published"),
      v.literal("dismissed"),
    ),
    source: v.string(),                                       // 'ai_daily' | 'manual'
    generatedAt: v.number(),
    // If founder acted on it — link to the resulting doc/broadcast/post
    linkedDocumentId: v.optional(v.id("documents")),
    linkedBroadcastId: v.optional(v.id("broadcasts")),
    linkedSocialPostId: v.optional(v.id("socialPosts")),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_workspace_time", ["workspaceId", "generatedAt"])
    .index("by_workspace_priority", ["workspaceId", "priority"]),

  /* ============================================================ */
  /* Phase 8c — Trend & Brand Intelligence                          */
  /* ============================================================ */

  brandWatches: defineTable({
    workspaceId: v.id("workspaces"),
    label: v.string(),                                       // 'Omnix POS' | 'Blyss' | 'competitor: Kwesibook'
    kind: v.union(
      v.literal("brand"),                                     // your own name/product
      v.literal("competitor"),
      v.literal("topic"),                                     // industry keyword like 'Kenya retail tech'
    ),
    // Multi-string query — matched with OR
    queries: v.array(v.string()),
    // Optional constraints
    languageHint: v.optional(v.string()),                    // 'en' | 'sw'
    regionHint: v.optional(v.string()),                      // 'KE' | 'EA' | 'global'
    // Cron controls
    active: v.boolean(),
    lastScanAt: v.optional(v.number()),
    // Aggregate — how many mentions so far
    mentionCount: v.number(),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_active", ["workspaceId", "active"])
    .index("by_workspace_kind", ["workspaceId", "kind"]),

  trendMentions: defineTable({
    workspaceId: v.id("workspaces"),
    watchId: v.id("brandWatches"),
    // Source
    sourceType: v.string(),                                   // 'web' | 'twitter' | 'reddit' | 'news' | 'review'
    url: v.string(),                                          // canonical link, unique per workspace
    title: v.string(),
    excerpt: v.string(),                                      // AI-summarized snippet
    authorName: v.optional(v.string()),
    authorHandle: v.optional(v.string()),
    // AI classifications
    sentiment: v.optional(v.string()),                        // 'positive' | 'neutral' | 'negative'
    relevanceScore: v.optional(v.number()),                  // 0-100
    topics: v.optional(v.array(v.string())),
    // Actionable state
    status: v.union(
      v.literal("new"),
      v.literal("triaged"),
      v.literal("responded"),
      v.literal("posted"),
      v.literal("dismissed"),
    ),
    // Where it points if founder acted
    linkedConversationId: v.optional(v.id("conversations")),
    linkedSocialPostId: v.optional(v.id("socialPosts")),
    linkedSeoIdeaId: v.optional(v.id("seoIdeas")),
    publishedAt: v.optional(v.number()),                     // when the source was published
    discoveredAt: v.number(),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_workspace_watch_time", ["workspaceId", "watchId", "discoveredAt"])
    .index("by_workspace_url", ["workspaceId", "url"])
    .index("by_workspace_time", ["workspaceId", "discoveredAt"])
    .index("by_workspace_relevance", ["workspaceId", "relevanceScore"]),

  /* ============================================================ */
  /* Phase 9 — Analytics + Attribution + Cash flow                  */
  /* ============================================================ */

  utmLinks: defineTable({
    workspaceId: v.id("workspaces"),
    // Short code appearing at /go/<shortCode> — 6-8 chars
    shortCode: v.string(),
    // Destination URL after the redirect
    destination: v.string(),
    // Label for the founder
    label: v.string(),
    // UTM parameters
    utmSource: v.optional(v.string()),                       // 'newsletter' | 'linkedin' | …
    utmMedium: v.optional(v.string()),                       // 'email' | 'social' | 'cpc'
    utmCampaign: v.optional(v.string()),                     // campaign name/slug
    utmContent: v.optional(v.string()),                      // creative variant
    utmTerm: v.optional(v.string()),                         // keyword
    // Optional links to source records
    campaignId: v.optional(v.id("campaigns")),
    broadcastId: v.optional(v.id("broadcasts")),
    socialPostId: v.optional(v.id("socialPosts")),
    // Counters
    clickCount: v.number(),
    lastClickAt: v.optional(v.number()),
    createdBy: v.id("users"),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_short_code", ["shortCode"])
    .index("by_workspace_campaign", ["workspaceId", "utmCampaign"]),

  // Every attribution touchpoint — a click, an inbound email, a
  // signup, etc. Reconstructing multi-touch attribution walks this.
  attributionTouches: defineTable({
    workspaceId: v.id("workspaces"),
    contactId: v.optional(v.id("contacts")),
    // Anonymous sessions — before we know the contact
    sessionId: v.optional(v.string()),
    touchType: v.union(
      v.literal("utm_click"),
      v.literal("landing_view"),
      v.literal("landing_signup"),
      v.literal("email_click"),
      v.literal("email_reply"),
      v.literal("social_click"),
      v.literal("first_response"),
      v.literal("meeting_booked"),
      v.literal("deal_created"),
      v.literal("deal_won"),
    ),
    source: v.optional(v.string()),
    medium: v.optional(v.string()),
    campaign: v.optional(v.string()),
    // Links back to the record that generated the touch
    utmLinkId: v.optional(v.id("utmLinks")),
    landingPageId: v.optional(v.id("landingPages")),
    campaignId: v.optional(v.id("campaigns")),
    broadcastId: v.optional(v.id("broadcasts")),
    socialPostId: v.optional(v.id("socialPosts")),
    dealId: v.optional(v.id("deals")),
    // Metadata
    referrer: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    ip: v.optional(v.string()),
    occurredAt: v.number(),
  })
    .index("by_workspace_contact_time", ["workspaceId", "contactId", "occurredAt"])
    .index("by_workspace_time", ["workspaceId", "occurredAt"])
    .index("by_workspace_type", ["workspaceId", "touchType", "occurredAt"])
    .index("by_session", ["sessionId"]),

  // Daily aggregated snapshots — cron computes each night for fast
  // Today-view KPI reads. Rolling 90-day retention.
  analyticsSnapshots: defineTable({
    workspaceId: v.id("workspaces"),
    // 'YYYY-MM-DD' key for uniqueness + range queries
    day: v.string(),
    // Sales
    newContacts: v.number(),
    newDeals: v.number(),
    dealsWon: v.number(),
    dealsLost: v.number(),
    wonRevenueCents: v.int64(),
    lostRevenueCents: v.int64(),
    pipelineValueCents: v.int64(),                           // total open pipeline
    // Money
    invoicesIssuedCents: v.int64(),
    invoicesPaidCents: v.int64(),
    // Engagement
    emailsSent: v.number(),
    emailsReceived: v.number(),
    whatsappSent: v.number(),
    whatsappReceived: v.number(),
    // Growth
    landingViews: v.number(),
    landingSignups: v.number(),
    utmClicks: v.number(),
    generatedAt: v.number(),
  })
    .index("by_workspace_day", ["workspaceId", "day"])
    .index("by_workspace_time", ["workspaceId", "generatedAt"]),

  // Fixed expenses — used by cash-flow projection view. Manual entry
  // for now; connect to expense tracking in Phase 10+.
  businessExpenses: defineTable({
    workspaceId: v.id("workspaces"),
    label: v.string(),                                       // 'Office rent' | 'Domain'
    amountCents: v.int64(),
    currency: v.string(),
    cadence: v.union(
      v.literal("one_time"),
      v.literal("weekly"),
      v.literal("monthly"),
      v.literal("quarterly"),
      v.literal("yearly"),
    ),
    nextDueDate: v.optional(v.number()),
    category: v.optional(v.string()),                        // 'infra' | 'people' | 'ops'
    active: v.boolean(),
    createdBy: v.id("users"),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_active", ["workspaceId", "active"]),

  /* ============================================================ */
  /* Phase 10 — Calendar + Meetings + Demo Ops                      */
  /* ============================================================ */

  calendarEvents: defineTable({
    workspaceId: v.id("workspaces"),
    ownerId: v.id("users"),                                  // whose calendar this belongs to
    kind: v.union(
      v.literal("meeting"),
      v.literal("reminder"),
      v.literal("blocked"),                                    // time-off / focus block
      v.literal("deadline"),
    ),
    title: v.string(),
    description: v.optional(v.string()),
    location: v.optional(v.string()),                        // Zoom URL / physical location
    conferenceUrl: v.optional(v.string()),                   // separate from location for click
    // Time — always UTC ms; UI localizes
    startAt: v.number(),
    endAt: v.number(),
    allDay: v.boolean(),
    // Attendees — participant emails as tokens; contact links per row in a separate table would be ideal but for MVP we inline
    attendeeEmails: v.optional(v.array(v.string())),
    // Related records
    dealId: v.optional(v.id("deals")),
    contactId: v.optional(v.id("contacts")),
    companyId: v.optional(v.id("companies")),
    // If this event came from a booking link
    bookingId: v.optional(v.id("meetingBookings")),
    // External sync — Google Calendar event id after OAuth is wired
    externalCalendarId: v.optional(v.string()),
    externalEventId: v.optional(v.string()),
    lastSyncedAt: v.optional(v.number()),
    // Reminders
    reminderMinutesBefore: v.optional(v.array(v.number())),
    reminderSentAt: v.optional(v.number()),                  // cron marker so we don't re-send
    // AI-generated pre-meeting brief
    aiBriefText: v.optional(v.string()),
    aiBriefAt: v.optional(v.number()),
    // AI post-meeting summary
    aiSummaryText: v.optional(v.string()),
    aiActionItems: v.optional(v.array(v.string())),
    aiSummaryAt: v.optional(v.number()),
    status: v.union(
      v.literal("scheduled"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("cancelled"),
      v.literal("no_show"),
    ),
    createdAt: v.number(),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace_start", ["workspaceId", "startAt"])
    .index("by_workspace_owner_start", ["workspaceId", "ownerId", "startAt"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_contact", ["contactId"])
    .index("by_deal", ["dealId"])
    .index("by_external_event", ["externalCalendarId", "externalEventId"]),

  // Public booking page config — one per unique meeting kind.
  meetingLinks: defineTable({
    workspaceId: v.id("workspaces"),
    ownerId: v.id("users"),
    slug: v.string(),                                        // 'omnix-demo' — unique per workspace
    title: v.string(),                                        // 'Omnix 30-minute demo'
    description: v.optional(v.string()),
    durationMinutes: v.number(),                             // 15 / 30 / 45 / 60
    // Availability rules — an array of { weekday: 0-6, startMin: 480, endMin: 1020 }
    availability: v.array(v.any()),
    bufferMinutesBefore: v.number(),
    bufferMinutesAfter: v.number(),
    // Booking window
    minLeadHours: v.number(),                                 // can't book less than N hours ahead
    maxLeadDays: v.number(),                                  // can't book further than N days out
    // Timezone the availability rules live in (Africa/Nairobi default)
    timezone: v.string(),
    // Optional fields to collect on booking
    formFields: v.optional(v.array(v.string())),             // ['note', 'company', 'phone']
    // Redirect after successful booking
    confirmationUrl: v.optional(v.string()),
    // Meeting shape
    location: v.optional(v.string()),
    conferenceUrl: v.optional(v.string()),
    // Publication
    active: v.boolean(),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace_slug", ["workspaceId", "slug"])
    .index("by_workspace_active", ["workspaceId", "active"]),

  meetingBookings: defineTable({
    workspaceId: v.id("workspaces"),
    linkId: v.id("meetingLinks"),
    // Who booked
    bookerEmail: v.string(),
    bookerName: v.optional(v.string()),
    bookerPhone: v.optional(v.string()),
    bookerCompany: v.optional(v.string()),
    note: v.optional(v.string()),
    // Slot
    startAt: v.number(),
    endAt: v.number(),
    timezone: v.string(),                                     // booker's chosen TZ
    // Contact/deal linkage — set post-creation as follow-ups happen
    contactId: v.optional(v.id("contacts")),
    dealId: v.optional(v.id("deals")),
    // State
    status: v.union(
      v.literal("confirmed"),
      v.literal("cancelled_by_host"),
      v.literal("cancelled_by_booker"),
      v.literal("no_show"),
      v.literal("completed"),
    ),
    cancellationReason: v.optional(v.string()),
    // Correlation with calendarEvents (created on confirmation)
    eventId: v.optional(v.id("calendarEvents")),
    // Reminder tracking
    reminderSentAt: v.optional(v.number()),
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    receivedAt: v.number(),
  })
    .index("by_workspace_start", ["workspaceId", "startAt"])
    .index("by_link_start", ["linkId", "startAt"])
    .index("by_link", ["linkId"])
    .index("by_booker_email", ["workspaceId", "bookerEmail"]),

  // Async demo recordings — founder uploads a demo video, AI extracts
  // questions/topics/next steps for later playback + shareable link.
  demoRecordings: defineTable({
    workspaceId: v.id("workspaces"),
    title: v.string(),
    description: v.optional(v.string()),
    // Recording file
    videoFileId: v.optional(v.id("files")),
    videoUrl: v.optional(v.string()),                        // external URL for now
    durationSeconds: v.optional(v.number()),
    // AI-extracted content
    transcriptText: v.optional(v.string()),
    transcriptedAt: v.optional(v.number()),
    aiSummary: v.optional(v.string()),
    aiQuestions: v.optional(v.array(v.string())),            // questions asked
    aiActionItems: v.optional(v.array(v.string())),
    // Sharing
    shareToken: v.optional(v.string()),                      // if public shared
    viewCount: v.number(),
    // Correlation
    dealId: v.optional(v.id("deals")),
    contactId: v.optional(v.id("contacts")),
    linkedEventId: v.optional(v.id("calendarEvents")),
    ownerId: v.id("users"),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_deal", ["workspaceId", "dealId"])
    .index("by_share_token", ["shareToken"]),

  // Trial licenses — Omnix product-specific but reusable pattern.
  trialLicenses: defineTable({
    workspaceId: v.id("workspaces"),
    contactId: v.optional(v.id("contacts")),
    companyId: v.optional(v.id("companies")),
    productSlug: v.string(),                                 // 'omnix' | 'blyss_studio'
    licenseKey: v.string(),                                  // human-readable code
    trialStartAt: v.number(),
    trialEndAt: v.number(),
    // Feature flags per trial
    features: v.optional(v.any()),
    seatCap: v.optional(v.number()),
    status: v.union(
      v.literal("active"),
      v.literal("expired"),
      v.literal("converted"),                                 // upgraded to paid
      v.literal("cancelled"),
    ),
    activatedAt: v.optional(v.number()),
    lastActiveAt: v.optional(v.number()),
    convertedAt: v.optional(v.number()),
    dealId: v.optional(v.id("deals")),
    ownerId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_license_key", ["licenseKey"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_workspace_end", ["workspaceId", "trialEndAt"]),

  /* ============================================================ */
  /* Phase 12 — Composio + Automation Builder + Public API          */
  /* ============================================================ */

  // Org-level Composio config — one row per organization once the
  // Composio account is linked. Encrypted API key lives under
  // orgIntegrationKeys with provider='composio'.
  composioConfig: defineTable({
    organizationId: v.id("organizations"),
    // Composio project id (workspace on Composio's side)
    composioProjectId: v.optional(v.string()),
    // Cache of installed app slugs — refreshed on Composio API calls.
    installedApps: v.optional(v.array(v.string())),
    lastSyncAt: v.optional(v.number()),
  })
    .index("by_org", ["organizationId"]),

  // Per-user OAuth connection to a Composio-managed app (Slack, Notion,
  // GitHub, HubSpot, Airtable, X, TikTok, etc.). Tier-2 secret pattern —
  // the actual token lives on Composio's side; we just track which
  // (user, app) pairs are linked.
  composioConnections: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    appSlug: v.string(),                                     // 'slack' | 'notion' | 'github' | …
    composioConnectionId: v.string(),                        // Composio's id
    accountLabel: v.optional(v.string()),                    // "justine@blyss.co.ke"
    status: v.union(
      v.literal("active"),
      v.literal("disconnected"),
      v.literal("error"),
    ),
    connectedAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_workspace_user", ["workspaceId", "userId"])
    .index("by_workspace_app", ["workspaceId", "appSlug"])
    .index("by_composio_connection", ["composioConnectionId"]),

  // Native automation builder — node-based flows.
  automations: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    description: v.optional(v.string()),
    // Trigger — what starts the flow
    triggerType: v.union(
      v.literal("timeline_event"),                           // e.g. deal_won, email_received
      v.literal("scheduler"),                                 // cron-like
      v.literal("webhook"),                                   // POST from external
      v.literal("manual"),                                    // one-off
    ),
    triggerConfig: v.any(),                                  // {eventType, cron, path, …}
    // Ordered graph of steps — { id, kind: 'native'|'composio'|'ai', args, next }
    nodes: v.array(v.any()),
    // Enablement
    active: v.boolean(),
    lastRunAt: v.optional(v.number()),
    runCount: v.number(),
    ownerId: v.id("users"),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_active", ["workspaceId", "active"])
    .index("by_trigger_type", ["workspaceId", "triggerType"]),

  // Per-run audit log — inputs, outputs, node-by-node results.
  automationRuns: defineTable({
    automationId: v.id("automations"),
    workspaceId: v.id("workspaces"),
    triggeredBy: v.optional(v.id("users")),
    triggerPayload: v.optional(v.any()),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("success"),
      v.literal("failed"),
      v.literal("partial"),                                    // some steps failed
    ),
    nodeResults: v.optional(v.array(v.any())),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_automation_time", ["automationId", "startedAt"])
    .index("by_workspace_time", ["workspaceId", "startedAt"])
    .index("by_workspace_status", ["workspaceId", "status"]),

  // Public REST API keys — for external systems calling into Atlas.
  publicApiKeys: defineTable({
    workspaceId: v.id("workspaces"),
    organizationId: v.id("organizations"),
    label: v.string(),                                       // 'Zapier zap for X' | 'Omnix admin'
    // We store the SHA-256 hash of the token, never the token itself.
    // The token is shown once at creation time.
    tokenHash: v.string(),
    tokenLastFour: v.string(),                               // for display
    // Scopes — what this key can do.
    scopes: v.array(v.string()),                             // ['contacts:read', 'deals:write', …]
    // Rate limits + expiry
    requestsPerMinute: v.number(),
    expiresAt: v.optional(v.number()),
    createdBy: v.id("users"),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    usageCount: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_token_hash", ["tokenHash"])
    .index("by_workspace_active", ["workspaceId", "revokedAt"]),

  // Webhook subscriptions — external URLs Atlas POSTs to on events.
  webhookSubscriptions: defineTable({
    workspaceId: v.id("workspaces"),
    label: v.string(),
    targetUrl: v.string(),
    events: v.array(v.string()),                             // ['deal.won', 'payment.received', …]
    // Shared secret for HMAC signing of outbound payloads.
    signingSecret: v.string(),
    active: v.boolean(),
    lastSuccessAt: v.optional(v.number()),
    lastFailureAt: v.optional(v.number()),
    lastDeliveredEventOccurredAt: v.optional(v.number()),    // watermark for cron scan
    consecutiveFailures: v.number(),
    createdBy: v.id("users"),
    archivedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_active", ["workspaceId", "active"]),
});
