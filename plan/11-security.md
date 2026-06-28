# 11 · Security

## Threat model

Atlas guards against four classes of threat:

1. **External attacker** — internet scans, credential stuffing, session hijacking, webhook forgery
2. **Malicious org member** — a hired team member who tries to exfiltrate the org's payment credentials, AI keys, or contact list
3. **Malicious operator** — out of scope (the operator controls Tier 0 and can in principle decrypt anything; we trust the operator and audit their actions)
4. **AI provider leak** — provider stores prompts and a future breach exposes them; mitigated by PII redaction policy + key rotation

## Encryption at rest

### Secrets (Tier 1 + Tier 2)

- **Algorithm:** AES-256-GCM
- **Master key:** `ATLAS_MASTER_KEY`, 32 bytes, base64-encoded in env
- **Per-row IV:** 12 bytes, random, generated server-side
- **Auth tag:** 16 bytes (GCM mode)
- **Storage format:** `bytea` column containing `IV (12B) || ciphertext || auth_tag (16B)` concatenated
- **Decryption:** server-side only in `lib/secrets/{org,user}.ts`. Audit log records every decrypt.

### Key rotation

Master key rotation requires:

1. Generate new master key
2. Add to env as `ATLAS_MASTER_KEY_NEXT`
3. Run `npm run secrets:rotate-master-key` — re-encrypts every row in `org_integration_keys` and `user_personal_keys` with new key, writes to staging columns
4. Verify all rows
5. Atomic swap: promote `ATLAS_MASTER_KEY_NEXT` to `ATLAS_MASTER_KEY`, demote old to `ATLAS_MASTER_KEY_PREV` (retained for rollback)
6. After 24h of stable operation, delete `ATLAS_MASTER_KEY_PREV`

Tier 1 provider keys rotated by Org Owner in `Settings → Integrations → [Provider] → Rotate`. Old key kept for 24h in `status='rotating'` so in-flight requests don't break, then `revoked`.

### Database encryption

- Neon encrypts at rest by default (AES-256)
- Connection always over TLS
- Sensitive payloads (`encrypted_value`, `audit_log.before/after` with possible PII) are already encrypted or redacted before storage

### Backups

- Neon: native point-in-time recovery, 6-hour window (Free) / 7-day (Launch)
- Weekly logical dump to R2 (encrypted with `R2_BACKUP_KEY`, separate from `ATLAS_MASTER_KEY`)
- Yearly off-site copy

## Encryption in transit

- HTTPS everywhere — strict HSTS with `max-age=31536000; includeSubDomains; preload`
- TLS 1.2+ only, modern ciphers
- Cookies: `Secure; HttpOnly; SameSite=Lax`
- API tokens (future) in headers, never query strings

## Content Security Policy

```
default-src 'self';
script-src 'self' 'unsafe-inline' https://*.paystack.co https://*.posthog.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com data:;
img-src 'self' data: blob: https://*.r2.cloudflarestorage.com https://*.cloudinary.com;
connect-src 'self' https://*.neon.tech https://*.r2.cloudflarestorage.com
            https://*.paystack.co https://api.resend.com https://places.googleapis.com
            https://generativelanguage.googleapis.com https://api.groq.com
            https://openrouter.ai https://api.mistral.ai https://api.cohere.com
            https://api.cerebras.ai wss://*;
frame-src https://*.paystack.co https://*.docuseal.com;
object-src 'none';
base-uri 'self';
form-action 'self' https://*.paystack.co;
upgrade-insecure-requests;
```

CSP is set via `next.config.ts` `headers()`.

## Authentication hardening

- Argon2id for password hashing — `m=64MB, t=3, p=1`
- Common-passwords list block (top 10K HaveIBeenPwned)
- Rate limit on `/login` and `/forgot-password`: 5 attempts per 15 min per IP + per email
- Magic links: 15 min TTL, single-use, JWT signed with `BETTER_AUTH_SECRET`
- OAuth state parameter validated (Better Auth handles)
- 2FA: TOTP, 6-digit, 30-sec window, backup codes generated on enable
- Sessions: 30-day sliding window, revocable per device
- Sign-in from new device → email notification ("Sign-in from Nairobi on Chrome/Mac")

## Webhook security

All inbound webhook endpoints (Paystack, Resend, Meta WhatsApp, DocuSeal) validate signatures before processing:

```ts
function verifyWebhook(provider, rawBody, signature, secret) {
  switch (provider) {
    case 'paystack':
      // HMAC-SHA512 with secret_key
      return constantTimeEquals(
        hmacSHA512(rawBody, secret),
        signature
      );
    case 'resend':
      // Svix signing
      return svix.verify(rawBody, headers, secret);
    case 'meta_whatsapp':
      // HMAC-SHA256 with app_secret, prefix 'sha256='
      return constantTimeEquals(
        'sha256=' + hmacSHA256(rawBody, secret),
        signature
      );
    case 'docuseal':
      // HMAC-SHA256 with shared token
      return constantTimeEquals(
        hmacSHA256(rawBody, secret),
        signature
      );
  }
}
```

Webhook events stored in `webhook_events` with `external_id` for idempotency. Replay-safe.

## Rate limiting

Per-route + per-user + per-IP limits. Implementation: in-process LRU with periodic Postgres-backed reset, or Upstash Redis if traffic grows.

| Surface | Limit |
|---|---|
| `/login` | 5/15min per IP+email |
| `/forgot-password` | 3/h per email |
| `/api/webhooks/*` | 1000/min per IP (Paystack signs anyway) |
| Server Actions (per user) | 60/min default; tighter on key save / member changes |
| Prospector search | per-org daily quota (default 200, configurable) |
| Bulk send (email, WhatsApp) | per-tier Meta rate limit, Resend allows per-IP |
| AI calls | per-feature daily KES budget (see 08) |

429 responses include `Retry-After` and a friendly message.

## Audit log

Every mutation through a Server Action records `audit_log`:

```ts
{
  org_id, workspace_id (if applicable),
  actor_id (null for system),
  action,           // 'created' | 'updated' | 'deleted' | 'sent_email' | 'decrypted_secret' | …
  resource_type, resource_id,
  before, after,    // JSON diffs (PII redacted per policy)
  reason,           // for sensitive actions
  ip, user_agent, request_id,
  occurred_at
}
```

Retention: 1 year by default, longer for financial mutations (7 years for KRA compliance via Omnix workspaces).

Org Owner can view in `Settings → Audit Log`. Filterable by actor, action, resource, time range. Exportable.

## PII handling

- Email addresses + phone numbers stored normalized
- Mask in logs by default (`patric***@example.com`, `+254712***678`)
- AI calls follow workspace PII policy (see 08 — None / Mask emails-phones / Mask names / Strict)
- GDPR-style data export: Org Owner → `Settings → Data → Export` → encrypted ZIP with all org data → emailed link, 7-day TTL
- Data deletion: Org Owner → "Delete org" → soft-archive immediately, hard-delete after 30-day grace; per-contact "Forget this contact" → strips PII fields, retains aggregate stats

## Input validation

- Every Server Action input validated via Zod
- File uploads: type allowlist (PDF, DOCX, JPG, PNG, MP4, etc.), max size enforced server-side, content-type sniffed (not just trusted from client), optional ClamAV scan (post-launch)
- HTML in email bodies: sanitized via DOMPurify server-side before storage and on render
- Search queries: parameterized FTS (never raw SQL concatenation)
- Webhook payloads: JSON validated against Zod schema before processing

## Output encoding

- React's default escaping for all user content
- `dangerouslySetInnerHTML` only on sanitized email HTML (DOMPurify pass)
- Markdown rendered via `react-markdown` with plugin allowlist (no `rehype-raw`)

## Session + CSRF

- Better Auth handles session cookie + CSRF token rotation
- All mutating endpoints require valid CSRF token (Better Auth middleware)
- Cross-origin requests blocked except Paystack iframe (frame-src allow)

## Secret access policy

In code, Tier 1 / Tier 2 secret reads:

```ts
// ✓ allowed in server-only code paths
import { getOrgKey } from '@/lib/secrets/org';
const key = await getOrgKey(orgId, 'paystack');

// ✗ banned: leaking into client
'use client';
import { getOrgKey } from '@/lib/secrets/org'; // build fails: server-only module
```

`lib/secrets/*` is marked `'server-only'`. Next.js build fails if accidentally imported into a client component.

## Dependency safety

- Lockfile committed (`package-lock.json` already present)
- Renovate / Dependabot weekly PRs, auto-merge patch + minor for non-critical
- `npm audit` in CI, fail on high/critical
- Pinned exact versions for security-sensitive deps (Better Auth, Drizzle, Paystack SDK)
- Reviewed every new dep before adding (no typo-squat-look-alikes)

## Logging hygiene

- Never log full request bodies
- Never log Tier 1/2 secrets, raw user passwords, session cookies, OAuth tokens
- Sentry beforeSend hook strips known sensitive fields
- Structured logs go to stdout (picked up by Vercel) — JSON format, query-friendly

## Headers

Set globally via Next.js middleware:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp     # only on app surface, relaxed on public share pages
```

## Public share pages

`/share/{token}` for documents, `/book/{ws}/{type}` for bookings, `/pay/{short}` for payment links.

- Tokens are 128-bit URL-safe random, never sequential
- Tokens are single-purpose (a share token cannot be used to access another document)
- Soft expiry (configurable, default 90 days)
- Rate limited per token (100 views/24h to discourage scraping)
- No PII beyond what the document/booking page chooses to display
- Indexable: `noindex, nofollow` meta tag, robots.txt deny on `/share/*` and `/pay/*`

## Incident response

When something goes wrong:

1. **Sentry alert** fires → operator notified (email + on-call channel)
2. **Audit log query** → who did what when
3. **Master key compromise** → trigger rotation procedure above
4. **Provider key leak (Tier 1)** → Org Owner rotates in Settings → revoke old via Paystack/Resend/etc. dashboard
5. **Data breach** → GDPR-style notification within 72 hours (org admin contact + affected end-users where applicable)

## Specific Kenyan compliance notes

- Data Protection Act 2019 — Atlas is a data controller for Blyss's org data; Org Owners are data controllers for their contacts. Atlas provides export/delete tooling for compliance.
- KRA: for invoices issued via Atlas, the `eTIMS_reference` field is optional metadata — Omnix's desktop app does the actual eTIMS signing in v1. Future: Atlas as eTIMS issuer requires registration with KRA.
- M-PESA / Paystack: PCI-DSS scoping minimized because card data never touches Atlas servers (Paystack hosted checkout handles all card capture).

## Acceptance — security gate before each phase ships

- [ ] CSP headers in place and passing
- [ ] All forms have CSRF tokens
- [ ] All Server Actions validate Zod input
- [ ] All mutations write audit_log
- [ ] No Tier 1/2 secret in client bundle (verified via build artifact grep)
- [ ] Rate limits enforced on auth surfaces
- [ ] Sentry redaction working (test with planted fake PII)
- [ ] HSTS + secure cookies set
- [ ] `npm audit` clean (no high/critical)
