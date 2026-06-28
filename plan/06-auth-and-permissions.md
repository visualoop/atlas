# 06 · Auth & Permissions

This file specifies identity, the multi-tenant model, the role matrix, the four-tier secrets architecture, and the invitation/onboarding flow. Read it end-to-end before writing any auth code.

## The model in one paragraph

Atlas is built on **Better Auth** with the Organization plugin enabled from day 1. One auth identity (a `user`) can belong to **N organizations** simultaneously. Each organization has **N workspaces** (Omnix, Marketplace, Studio, …) and **N members** (users with an org-level role). Each member has a **per-workspace role** (Owner / Admin / Member / Viewer) — so a user can be Org Owner but Member-only of one workspace. **Secrets live in four tiers** (system / org / user / workspace) with strict access rules, so a team member cannot exfiltrate the org's Paystack key even if they compromise their own account.

## Identity (Better Auth)

### Plugins enabled

1. **Organization plugin** — orgs, members, invitations, teams (we don't use teams in v1; org membership + workspace roles cover it)
2. **API Key plugin** — for future programmatic access; not exposed to end users in v1
3. **Two Factor plugin (TOTP)** — required for Org Owners, optional for everyone else
4. **Passkey plugin** — post-launch enhancement

### Authentication methods (Phase 0)

- **Email + password** (Argon2id hash, 12+ char min, common-passwords list block)
- **Magic link** (email-based passwordless)
- **Google OAuth** (also unlocks Gmail import + Calendar sync later)

Email + password is allowed but magic link is preferred for new accounts (avoids forgotten passwords for solo founders).

### Session model

- Cookie: HTTP-only, `Secure`, `SameSite=Lax`
- Session lifetime: 30 days (sliding)
- Refresh: on every request via Better Auth's session middleware
- Device list: visible at `/settings/security`; user can revoke any session
- Sign-out: clears session cookie + invalidates server-side

### `BETTER_AUTH_SECRET`

Tier 0 env var. 32+ char random string generated via `openssl rand -base64 32`. Used by Better Auth internally for session encryption and CSRF tokens. **Operator-controlled.** Rotated only via planned outage.

## The org / workspace / user model

```
user (Better Auth)
  │
  ├── member of org-A  (org role: owner)
  │     └── workspace-1 (workspace role: owner)
  │     └── workspace-2 (workspace role: owner)
  │     └── workspace-3 (workspace role: owner)
  │
  ├── member of org-B  (org role: member)
  │     └── workspace-4 (workspace role: admin)
  │     └── workspace-5 (workspace role: viewer)
  │
  └── pending invitation to org-C
```

A user always operates in the context of *one* active org and *one* active workspace at a time. The topbar shows:

```
[ Blyss ▼ ]  [ Studio ▼ ]   …rest of topbar
   ^             ^
   |             |
   org switcher  workspace switcher (within the active org)
```

Active org + workspace are persisted in:
- `session.active_organization_id` (Better Auth field)
- A signed cookie `atlas-active-workspace` per org

Switching org or workspace fires a server redirect to refresh RSC tree.

## Role matrix

### Org-level roles

| Role | Manage members | Manage integrations (Tier 1) | Manage workspaces | Manage billing | Delete org |
|---|---|---|---|---|---|
| **Owner** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Admin** | ✓ (except other admins/owners) | ✓ | ✓ | ✗ | ✗ |
| **Member** | ✗ | ✗ (use only) | ✗ (use only) | ✗ | ✗ |

Note: Org Member is the *baseline* role for everyone in the org. Their effective permissions are determined by their workspace roles.

### Workspace-level roles

| Role | Read data | Create/edit records | Send messages | Manage workspace settings | Manage workspace members |
|---|---|---|---|---|---|
| **Owner** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Admin** | ✓ | ✓ | ✓ | ✓ | ✓ (except owners) |
| **Member** | ✓ | ✓ | ✓ | ✗ | ✗ |
| **Viewer** | ✓ | ✗ | ✗ | ✗ | ✗ |

### Default assignment

When an org is created, the creator becomes:
- Org Owner
- Workspace Owner of every workspace they create

When a new workspace is created, the creator is Workspace Owner. Other org members get **no workspace access by default** (security default = least privilege). They must be invited specifically.

## The four-tier secrets architecture

The most important section in this file. Read carefully.

### Tier 0 — System secrets (Atlas operator only, in env, NEVER in admin UI)

| Secret | Use | Who controls |
|---|---|---|
| `BETTER_AUTH_SECRET` | Session encryption | Operator (env var) |
| `ATLAS_MASTER_KEY` | AES-256-GCM master key wrapping all Tier 1/2 secrets at rest | Operator (env var) |
| `DATABASE_URL` (+ `DATABASE_URL_UNPOOLED`) | Direct Neon connection | Operator |
| `SENTRY_DSN` | Atlas's own error tracking | Operator |
| `POSTHOG_API_KEY` (+ `POSTHOG_HOST`) | Atlas's own product analytics | Operator |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT` | Atlas's own storage | Operator |
| `RESEND_SYSTEM_KEY` | Atlas's own outbound for invitations / password resets — **separate from any org's Resend** | Operator |
| `RESEND_SYSTEM_FROM` | Atlas's system from-address e.g. `atlas-noreply@blyss.co.ke` | Operator |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Sign-in with Google | Operator |
| `NEXT_PUBLIC_APP_URL` | Canonical app URL | Operator |

**Properties:**
- Defined in `.env.local` (dev), Vercel env vars (staging + prod), and `.env.example` (committed, with placeholder values)
- Never editable through the admin UI
- Validated at app boot via Zod (`lib/env.ts`) — app refuses to start if missing/invalid
- Rotated only by the operator with a planned outage (master key rotation cascades a re-encryption pass; see 11-security.md)

### Tier 1 — Org integration secrets

Things like AI provider keys, Resend, Paystack, Meta WhatsApp, Google Maps. **Each org sets its own.** Encrypted with `ATLAS_MASTER_KEY`. Stored in `org_integration_keys` table.

Providers supported at launch:

```
AI:           gemini, groq, openrouter, mistral, cohere, cerebras,
              github_models, together, openai, anthropic
Email:        resend (org's own), cloudflare_email_routing
WhatsApp:     meta_whatsapp (App ID + App Secret + WABA ID + Phone Number ID(s))
Maps:         google_maps_places
Payments:     paystack (secret_key + public_key)
E-signature:  docuseal (base_url + api_token)
Storage:      (Atlas uses operator's R2 — orgs do not BYO storage in v1)
```

**Access control (Tier 1):**

| Role | Can save/rotate key | Can read decrypted value | Can use via Atlas server | Can see "Configured ✓" |
|---|---|---|---|---|
| Org Owner | ✓ | ✓ (once on creation, then masked) | ✓ | ✓ |
| Org Admin | ✓ | ✗ | ✓ | ✓ |
| Org Member | ✗ | ✗ | ✓ (via Atlas server, key never in browser) | ✓ |
| Org Viewer | ✗ | ✗ | ✗ | ✓ |

**Storage details:**

- Row schema in `05-data-model.md` (`org_integration_keys` table)
- Encryption: AES-256-GCM with 12-byte IV, 16-byte auth tag, `ATLAS_MASTER_KEY` (32 bytes)
- Per-row IV (random); IV + ciphertext + auth tag stored as a single `bytea`
- Decryption only happens server-side, in trusted code paths (`lib/secrets/org.ts`)
- Every decryption logs to `audit_log` with actor, reason, and resource
- Frontend never receives the decrypted value — settings UI shows `••••••••8h2` after save

### Tier 2 — Member personal secrets

Each user controls their own. Examples:

- Google Calendar OAuth tokens (each member syncs their personal calendar)
- Microsoft Calendar OAuth tokens (future)
- Personal email signature
- Personal Atlas API tokens (future, for personal CLI use)

**Access control (Tier 2):**

| Actor | Can read/edit |
|---|---|
| The user themselves | ✓ |
| Org Owner | ✗ (cannot see another user's calendar tokens) |
| Atlas system (in trusted server code) | ✓ (for calendar sync background job) |

Stored in `user_personal_keys` table, encrypted identically to Tier 1.

### Tier 3 — Workspace-specific config (non-secret)

Not encrypted; just per-workspace config:

- Sender identity per workspace (`sales@omnix.co.ke`, `justine@blyss.co.ke`)
- WhatsApp phone number ID per workspace
- Paystack subaccount mapping per workspace
- Pipeline shape per workspace
- Email templates per workspace
- Default currency, timezone

Stored in `workspace_settings` table or denormalized onto `workspaces` itself.

**Access control:** Workspace Owner / Admin can edit. Inherits Tier 1 integrations from the org.

### The "what you can break" matrix

| Actor | Can break Atlas system | Can drain org money | Can read another user's calendar | Can use Atlas for work |
|---|---|---|---|---|
| Org Owner of *their* org | ✗ (Tier 0 isolated) | Only their org's money | ✗ (Tier 2 isolated per user) | ✓ within their org |
| Org Member in Blyss | ✗ | ✗ (can't see Paystack key) | ✗ | ✓ within assigned workspaces |
| Malicious member with stolen session | ✗ | ✗ (keys never in browser) | Only that user's calendar | ✓ limited by role |
| Atlas operator (you) | ✓ (controls Tier 0 → master key → all Tier 1/2) | ✓ | ✓ | ✓ |

This is the right shape: **operators trust users with their own data; users do not need to trust other users.**

## Invitation + onboarding flow

The invitee should never be forced straight into the inviter's org. They get a choice.

### The flow

```
1. Org Owner / Admin invites user@example.com via Settings → Members → Invite
2. Atlas sends invitation email (via Tier 0 RESEND_SYSTEM_KEY, from RESEND_SYSTEM_FROM)
   Subject: "Justine Gichana invited you to join Blyss on Atlas"
   Link: https://atlas.blyss.co.ke/invite/<token>
3. Invitee clicks link → /invite/<token>
4. If not signed in:
     → Sign up screen (or sign in if existing user)
     → After auth, redirected back to /invite/<token>
5. Invitation screen:
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
6a. If they "Create your own org first":
     Wizard: org name → first workspace name → done
     → Lands in own org as Owner
     → Persistent banner in topbar: "Accept Blyss invitation"
     → They can accept whenever
6b. If they "Accept":
     → Better Auth `acceptInvitation` → membership row created
     → Default workspace access: NONE (Owner must assign in next step)
     → Owner sees notification: "Amina accepted — assign workspace access"
6c. If they "Decline":
     → Better Auth `declineInvitation` → invitation revoked
7. Org switcher in topbar reflects all orgs the user belongs to
8. Default landing: most recently used org + workspace
```

### Invitation email — system-tier

```
From: Atlas <atlas-noreply@blyss.co.ke>
Subject: Justine Gichana invited you to join Blyss on Atlas

Justine Gichana has invited you to join their organization on Atlas as a Member.

Atlas is the operating system for a founder — replaces Gmail, WhatsApp Business,
spreadsheets, and a CRM.

[ Accept invitation ]   https://atlas.blyss.co.ke/invite/<token>

This invitation expires in 7 days.

If you didn't expect this, you can safely ignore this email.
```

Sent via Tier 0 Resend system key — not the inviter's org Resend.

### Workspace access on accept

After accepting, the new member has **no workspace access** until the Org Owner / Admin assigns at least one workspace. Until then, they see an empty state: *"You're a member of Blyss. Ask the org owner for workspace access to get started."*

The Owner gets a server-action notification + can assign in `Settings → Members → [user] → Workspace access` with a multi-select.

## Permission enforcement

### Server-side (the only place that matters)

Every Server Action and route handler runs through a middleware that:

1. Validates the session
2. Extracts active org + workspace from session/cookies
3. Looks up the user's org role and workspace role
4. Provides a typed `ctx` object to the action:
   ```ts
   interface AuthCtx {
     user: User;
     org: { id: string; role: 'owner' | 'admin' | 'member' };
     workspace?: { id: string; role: 'owner' | 'admin' | 'member' | 'viewer' };
   }
   ```
5. Action then enforces specific role requirements via guards:
   ```ts
   requireOrgRole(ctx, ['owner', 'admin']);
   requireWorkspaceRole(ctx, ['owner', 'admin', 'member']);
   ```

### RLS-style defaults in queries

Every Drizzle query for workspace-scoped data starts with `where(eq(table.workspace_id, ctx.workspace.id))`. Helper wrapper:

```ts
const repo = workspaceScopedRepo(ctx.workspace.id);
await repo.companies.list(filters);  // automatically filtered
```

### Client-side (UX only)

Client components do not enforce permissions — they only *hide* affordances. Server enforces every action.

## Audit triggers

Every mutation through a Server Action records an `audit_log` row with:
- `actor_id`, `org_id`, `workspace_id`, `action`, `resource_type`, `resource_id`
- `before` and `after` snapshots
- `ip`, `user_agent`, `request_id` from the request context

Secret access (decryption) is audited specifically with `action='decrypted_secret'` and `payload={ provider, key_id, reason }`.

## 2FA policy

- Org Owners: **required** to enable 2FA (TOTP) within 7 days of org creation; nag banner until enabled
- Org Admins: **strongly recommended** (banner, dismissible weekly)
- Org Members: optional
- 2FA enforcement on:
  - Sign-in from new device
  - Tier 1 secret save / rotate
  - Member role changes
  - Account-level changes (email, password)

## Session timeout

- Idle timeout: none by default (long sessions for founders)
- Per-org override: org Owner can set "Require sign-in every N hours of idle"
- Sensitive actions (key save, member role change, billing) require fresh authentication (within last 15 min) — re-auth prompt if stale

## Phase 0 acceptance criteria

By end of Phase 0:

- [ ] Better Auth + Organization + API Key + Two Factor plugins installed
- [ ] Email + password + magic link + Google OAuth all working
- [ ] Blyss org created at first run, Justine as Owner
- [ ] 3 workspaces (Omnix, Marketplace, Studio) pre-seeded with Justine as Workspace Owner each
- [ ] Sign-in flow: redirects to last-used workspace
- [ ] Topbar shows org switcher + workspace switcher; works
- [ ] `/settings/members` lists members (just Justine), shows "Invite member" button
- [ ] Invite flow scaffolded end-to-end: send → email → accept-or-create-own-org → assign workspaces
- [ ] `/settings/integrations` shows Tier 1 providers list, all unset, with "Add key" buttons (stubs in Phase 0, fully wired in Phase 5)
- [ ] Settings pages gated by org role
- [ ] Audit log records every mutation
- [ ] 2FA setup flow exists in `/settings/security`
