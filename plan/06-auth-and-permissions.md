# 06 · Auth & Permissions

Identity, the multi-tenant model, the role matrix, the four-tier secrets architecture, and the invitation/onboarding flow.

## The model in one paragraph

Atlas is built on **`@convex-dev/auth`** with Password + magic-link OTP providers from day 1. One auth identity (a row in `users`, plus an `authAccounts` row per credential) belongs to **N organizations** via the `members` table. Each organization has **N workspaces** (Omnix, Marketplace, Studio, …) and **N members** (users with an org-level role). Each member has a **per-workspace role** (Owner / Admin / Member / Viewer) — so one user can be Org Owner but Member-only of one workspace. **Secrets live in four tiers** (system / org / user / workspace) with strict access rules; a team member cannot exfiltrate the org's Paystack key even with full account compromise because the decrypted value never reaches the browser.

## Identity (`@convex-dev/auth`)

### Providers

1. **`Password`** — email + 12-char password. Reset via OTP email (`password-reset-otp` Email provider).
2. **`Email` (magic link OTP)** — 6-digit code emailed; user enters it to sign in. Separate provider id (`magic-link-otp`) so tokens don't collide.
3. *(future)* Google OAuth via Convex Auth's Google provider once we wire it.

### Convex Auth env vars (set inside Convex, not `.env.local`)

| Var | What |
|---|---|
| `SITE_URL` | The Next.js app URL — used in email links and OAuth callbacks |
| `JWT_PRIVATE_KEY` | RS256 PKCS#8 PEM — signs session tokens |
| `JWKS` | Public key set for verification |
| `CONFIG_ENCRYPTION_KEY` | 32-byte base64 — wraps all Tier-1/2 secrets via AES-GCM |

Set on local backend via `npx convex env set` with `CONVEX_SELF_HOSTED_URL` + admin key in env. On production via the same command pointed at `https://api.atlas.blyss.co.ke`.

### Session model

- HTTP-only `__atlasAuthJWT` cookie + companion `__atlasAuthRefreshToken`
- 30-day refresh, sliding
- Convex Auth verifies on every query/mutation/action call
- Device list visible at `/settings/security` (Phase 1)
- Sign out: server invalidates refresh token; client clears cookies

## The org / workspace / user model

```
users (authTables)
  └── userProfiles  (Atlas extension: timezone, last active org/workspace)
  │
  ├── member of org-A  (members.role: 'owner')
  │     └── workspaceMembers ↔ workspace-1 (role: 'owner')
  │     └── workspaceMembers ↔ workspace-2 (role: 'owner')
  │     └── workspaceMembers ↔ workspace-3 (role: 'owner')
  │
  ├── member of org-B  (members.role: 'member')
  │     └── workspaceMembers ↔ workspace-4 (role: 'admin')
  │     └── workspaceMembers ↔ workspace-5 (role: 'viewer')
  │
  └── invitations[org-C, status='pending']
```

A user always operates in the context of *one* active org and *one* active workspace. `userProfiles.lastActiveOrgId` + `.lastActiveWorkspaceId` persist across sessions. The topbar shows:

```
[ Blyss ▼ ]  [ Studio ▼ ]   …rest of topbar
   org switcher   workspace switcher (within active org)
```

Switching fires `setActiveOrganization` / `setActiveWorkspace` mutations. The `currentBootstrap` query supplies the app shell with: user, profile, all orgs the user belongs to, the active org, the visible workspaces in the active org, and the active workspace.

## Role matrix

### Org-level

| Role | Manage members | Manage Tier-1 integrations | Manage workspaces | Delete org |
|---|---|---|---|---|
| **Owner** | ✓ | ✓ | ✓ | ✓ |
| **Admin** | ✓ (except other admins/owners) | ✓ | ✓ | ✗ |
| **Member** | ✗ | ✗ (use only) | ✗ (use only) | ✗ |

Org Member is the baseline; effective permissions come from workspace roles.

### Workspace-level

| Role | Read | Create/edit | Send messages | Manage settings | Manage members |
|---|---|---|---|---|---|
| **Owner** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Admin** | ✓ | ✓ | ✓ | ✓ | ✓ (except owners) |
| **Member** | ✓ | ✓ | ✓ | ✗ | ✗ |
| **Viewer** | ✓ | ✗ | ✗ | ✗ | ✗ |

### Default assignment

Org creator → org Owner + Workspace Owner of every workspace they create. New workspaces start with the creator as Workspace Owner. Other org members get **no workspace access** by default — must be invited explicitly.

## The four-tier secrets architecture

### Tier 0 — System secrets (operator-controlled, in Convex env or Next.js env, NEVER editable in admin UI)

| Secret | Lives in | Used for |
|---|---|---|
| `JWT_PRIVATE_KEY` | Convex env | Session signing |
| `JWKS` | Convex env | Session verification |
| `SITE_URL` | Convex env | Email links + callback URLs |
| `CONFIG_ENCRYPTION_KEY` | Convex env | Wraps Tier-1/2 secrets at rest |
| `CONVEX_INSTANCE_SECRET` | Backend container env | Identifies the Convex deployment |
| `CONVEX_SELF_HOSTED_ADMIN_KEY` | Operator's hands (GitHub Secret for CI) | Admin pushes to backend |
| `NEXT_PUBLIC_CONVEX_PUBLIC_URL` | Next.js env | Browser WebSocket target |

Rotated only by the operator with a planned outage. Master key rotation cascades a re-encryption pass across all Tier-1/2 rows.

### Tier 1 — Org integration secrets (Owner/Admin sets, encrypted at rest, used by all org members via server)

Stored in `orgIntegrationKeys` with `encryptedValue: v.string()` (base64 of `iv ‖ ciphertext-with-tag`).

Providers supported at launch:

```
AI:           gemini, groq, openrouter, mistral, cohere, cerebras,
              github_models, together, openai, anthropic
Email:        resend (org's own outbound + inbound),
              cloudflare_email_routing
WhatsApp:     meta_whatsapp (app_id, app_secret, waba_id, phone_number_ids)
Maps:         google_maps_places
Payments:     paystack (secret_key + public_key + mode)
E-signature:  docuseal (base_url + api_token)
```

**Access (Tier 1):**

| Role | Can save/rotate | Can read decrypted | Can use via server | Can see "Configured ✓" |
|---|---|---|---|---|
| Org Owner | ✓ | ✓ (once on creation, then masked) | ✓ | ✓ |
| Org Admin | ✓ | ✗ | ✓ | ✓ |
| Org Member | ✗ | ✗ | ✓ (key never leaves server) | ✓ |
| Org Viewer | ✗ | ✗ | ✗ | ✓ |

**Storage details:**

- Schema in `05-data-model.md` (`orgIntegrationKeys`)
- Encryption: AES-256-GCM, Web Crypto, 12-byte IV, 16-byte auth tag, `CONFIG_ENCRYPTION_KEY` (32 bytes base64)
- Per-row random IV; `iv ‖ ciphertext ‖ tag` base64-encoded into one column
- Decryption only in `convex/lib/secrets.ts`, called from internal queries / actions
- Every decryption logs to `auditLog` with `action='decrypted_secret'`, reason, and resource
- Settings UI shows `••••••••8h2` only

### Tier 2 — Member personal secrets

Each user controls their own. Examples:

- Google Calendar OAuth tokens (refresh + access)
- Microsoft Calendar OAuth tokens (future)
- Personal Atlas API tokens (future)

**Access (Tier 2):**

| Actor | Can read/edit |
|---|---|
| The user themselves | ✓ |
| Org Owner / Admin | ✗ |
| Atlas system (in trusted internal* code only) | ✓ — for the calendar sync background job |

Stored in `userPersonalKeys`, encrypted identically to Tier 1.

### Tier 3 — Workspace config (non-secret)

Lives inline on `workspaces` and in associated tables:

- Sender identity per workspace (email from-address, WhatsApp phone number ID)
- Paystack subaccount mapping (`paystackSubaccounts.workspaceId → subaccount_code`)
- Default currency, timezone, brand color override
- Per-workspace templates, automations, pipeline shape, custom fields

**Access:** Workspace Owner / Admin edits. Inherits Tier-1 integrations from the org.

### The "what you can break" matrix

| Actor | System | Org money | Another user's calendar | Use Atlas for work |
|---|---|---|---|---|
| Org Owner of *their* org | ✗ (Tier 0 isolated) | Only their own org's | ✗ (Tier 2 isolated per user) | ✓ in their org |
| Org Member in Blyss | ✗ | ✗ (Paystack key not in browser) | ✗ | ✓ within assigned workspaces |
| Stolen Org Member session | ✗ | ✗ | Only their calendar | ✓ limited by role |
| Atlas operator | ✓ (controls Tier 0 → master key → everything) | ✓ | ✓ | ✓ |

This is the right shape: **operators trust users with their own data; users do not need to trust other users.**

## Invitation + onboarding flow

The invitee should never be forced straight into the inviter's org. They get a choice.

### The flow

```
1. Org Owner / Admin invites user@example.com via Settings → Members → Invite
   → Atlas inserts `invitations` row with status='pending', token, 7-day expiry
2. Atlas sends invitation email via the org's Tier-1 Resend key,
   from the org's verified domain (or Tier-0 fallback if no Resend yet).
   Subject: "Justine Gichana invited you to join Blyss on Atlas"
   Link: https://atlas.blyss.co.ke/invite/<token>
3. Invitee clicks → /invite/<token>
4. If not signed in:
     Sign up screen (or sign in if existing user) → /invite/<token>
5. /invite/<token> page:
     ┌──────────────────────────────────────────────────┐
     │ You're invited to join "Blyss" as Member         │
     │                                                   │
     │ [ Accept invitation ]                             │
     │                                                   │
     │ Or, set up your own first:                        │
     │ [ Create your own organization ]                  │
     │                                                   │
     │ [ Decline invitation ]                            │
     └──────────────────────────────────────────────────┘
6a. "Create your own org first":
     Wizard → org name → slug → first workspace name → done.
     Lands in own org as Owner.
     Persistent banner: "Accept Blyss invitation"
6b. "Accept":
     Mutation: acceptInvitation(token)
       → status='accepted', creates members row,
         optionally creates workspaceMembers rows from
         workspaceAssignments
     Default workspace access: per assignments, else NONE.
     Owner sees notification: "Amina accepted — assign workspaces"
6c. "Decline":
     status='declined', revoke link.
7. Org switcher in topbar reflects all orgs they belong to.
8. Default landing: most recently used org + workspace.
```

### Invitation email — sent via Tier-1 Resend

The first invitation an org sends is gated on the org having configured Resend in Settings → Integrations. Until then, the invitation flow surfaces "Add Resend to invite team members." If we want frictionless first-invite even before Resend is set up, we can ship a Tier-0 system Resend key wired into the operator's env (the same way ChapaSwali uses `AUTH_RESEND_KEY` as a fallback).

### Workspace access on accept

After accepting, the new member has **no workspace access** unless `workspaceAssignments` was specified in the invitation. The Owner gets a notification + can assign in `Settings → Members → [user] → Workspace access`.

## Permission enforcement (server-side, the only place that matters)

Every Convex query/mutation/action runs through one of the helpers in `convex/lib/authHelpers.ts`:

```ts
// In any function:
const user = await requireUser(ctx);
const orgMembership = await requireOrgRole(ctx, organizationId, "admin");
const wsMembership = await requireWorkspaceRole(ctx, workspaceId, "member");
```

Helpers throw `ConvexError` with stable codes:

```
UNAUTHENTICATED              → not signed in
NOT_IN_ORG                   → not a member
INSUFFICIENT_ORG_ROLE        → role too low
NOT_IN_WORKSPACE             → no workspace access
INSUFFICIENT_WORKSPACE_ROLE  → role too low
```

The frontend translates these codes to UI (`/login` redirect, banner, modal). Client components do not enforce permissions — they only *hide* affordances. Server is the final word.

## RLS-style defaults

Every workspace-scoped query starts with `.withIndex("by_workspace_…", (q) => q.eq("workspaceId", ctx.workspace.id))`. Helper wrapper coming in Phase 1.

## Audit triggers

Every mutation calls `recordAudit(ctx, { ...args })` with `actor`, `action`, `resourceType`, `resourceId`, `before`, `after`, `reason`. Secret decryption is audited specifically with `action='decrypted_secret'` and `payload={ provider, label, reason }`.

## 2FA policy

- Org Owners: **required** within 7 days of org creation; nag banner until enabled (Phase 1)
- Org Admins: **strongly recommended** (banner, dismissible weekly)
- Org Members: optional
- 2FA enforcement on:
  - Sign-in from new device
  - Tier-1 secret save / rotate
  - Member role changes
  - Account-level changes (email, password)

## Phase 0 acceptance (status: done ✓)

- [x] `@convex-dev/auth` configured with Password + magic-link OTP providers
- [x] JWT keys + JWKS + CONFIG_ENCRYPTION_KEY set in local Convex env
- [x] Convex Auth HTTP routes registered via `convex/http.ts`
- [x] Sign-up / sign-in / magic-link OTP all wired in the login form
- [x] Bootstrap query returns user + active org + active workspace + visible workspaces
- [x] First-run wizard creates Blyss org + first workspace, marks Justine as Owner
- [x] App shell shows org/workspace switchers fed by `currentBootstrap`
- [x] Settings shell pages exist (profile, security, integrations, members)
- [x] Audit log records mutations (test pending verification at first dev session)
- [ ] Invitation flow scaffolded end-to-end (next sprint: `convex/invitations.ts`)
- [ ] 2FA enrollment UI (Phase 1)
