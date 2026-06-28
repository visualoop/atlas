# 11 · Security

## Threat model

Atlas guards against four classes:

1. **External attacker** — internet scans, credential stuffing, session hijacking, webhook forgery
2. **Malicious org member** — hired team member tries to exfiltrate Paystack/AI keys or contact data
3. **Malicious operator** — out of scope; operator controls Tier-0 and can decrypt anything. We trust + audit operator actions.
4. **AI provider leak** — provider stores prompts; mitigated by PII redaction policy + key rotation.

## Encryption at rest

### Tier-1 / Tier-2 secrets

- **Algorithm:** AES-256-GCM via Web Crypto (runs in Convex's V8 runtime, no `"use node"` needed)
- **Master key:** `CONFIG_ENCRYPTION_KEY` — 32 bytes base64, set in Convex env via `npx convex env set`
- **Per-row IV:** 12 bytes random
- **Auth tag:** 16 bytes (GCM)
- **Storage:** `encryptedValue: v.string()` holding `base64(iv ‖ ciphertext-with-tag)`
- **Decryption:** server-side only in `convex/lib/secrets.ts`. Every decrypt logs to `auditLog`.

### Master-key rotation procedure

1. Generate new key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
2. Set on backend: `npx convex env set CONFIG_ENCRYPTION_KEY_NEXT <new>`
3. Run `internalMutation` that re-encrypts every `orgIntegrationKeys` + `userPersonalKeys` row with the new key into staging columns
4. Verify counts match
5. Atomic swap: promote `…_NEXT` → `CONFIG_ENCRYPTION_KEY`, demote old to `…_PREV`
6. After 24h stable, delete `…_PREV`

Tier-1 provider key rotation: Org Owner clicks "Rotate" in Settings → Integrations. Old row kept 24h with `status='rotating'` so in-flight requests don't break, then `revoked`.

### Convex managed encryption

- Convex's SQLite-backed PVC is on a Persistent Volume with disk-level encryption (depends on storage class; Oracle Cloud uses encrypted block storage)
- Convex's transport (WebSocket + HTTPS) is TLS 1.2+
- Built-in `ctx.storage` files are encrypted; signed URLs are short-lived (~1h)

### Backups

- Daily `convex export` → backup PVC (kept 14)
- Backup files contain everything: data + storage. **They contain ciphertext for Tier-1/2 secrets** — useless without `CONFIG_ENCRYPTION_KEY`.
- For off-site safety, periodically copy snapshots off the PVC (rclone to R2, encrypted with a separate key)

## Encryption in transit

- HTTPS everywhere, strict HSTS: `max-age=31536000; includeSubDomains; preload`
- TLS 1.2+, modern ciphers (Traefik default)
- Cookies: `Secure`, `HttpOnly`, `SameSite=Lax`
- Convex WebSocket upgrades to WSS

## CSP (Content Security Policy)

Set via Next.js `next.config.ts` `headers()`:

```
default-src 'self';
script-src 'self' 'unsafe-inline' https://*.paystack.co https://*.posthog.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com data:;
img-src 'self' data: blob:
        https://*.atlas.blyss.co.ke
        https://*.cloudinary.com;
connect-src 'self'
            https://*.atlas.blyss.co.ke
            wss://*.atlas.blyss.co.ke
            https://*.paystack.co
            https://api.resend.com
            https://places.googleapis.com
            https://generativelanguage.googleapis.com
            https://api.groq.com
            https://openrouter.ai
            https://api.mistral.ai
            https://api.cohere.com
            https://api.cerebras.ai;
frame-src https://*.paystack.co https://*.docuseal.com;
object-src 'none';
base-uri 'self';
form-action 'self' https://*.paystack.co;
upgrade-insecure-requests;
```

## Authentication hardening

- Convex Auth handles password hashing (industry-standard)
- Password min 12 chars (enforced in `convex/auth.ts`'s `validatePasswordRequirements`)
- Common-passwords list block (top 10K HaveIBeenPwned) — Phase 1 addition
- Rate limit on sign-in via `@convex-dev/rate-limiter` (Phase 1)
- Magic-link OTP: 15-min TTL, single-use, 6 digits
- 2FA TOTP: enroll via Convex Auth (Phase 1)
- Sign-in from new device → notification email

## Webhook security

All inbound webhook endpoints (Paystack, Resend, Meta WhatsApp, DocuSeal) verify signatures before processing in `convex/http.ts`:

```ts
// Paystack: HMAC-SHA512 of raw body with secret_key
// Resend: Svix signature verification
// Meta WhatsApp: HMAC-SHA256 of raw body with app_secret, prefix 'sha256='
// DocuSeal: HMAC-SHA256 with shared token
```

`webhookEvents` table stores `externalId` for idempotency. Replay-safe.

## Rate limiting

Per-route + per-user + per-IP. Implementation: `@convex-dev/rate-limiter` (Phase 1):

| Surface | Limit |
|---|---|
| Sign-in | 5 / 15min per IP+email |
| Forgot-password | 3 / hour per email |
| `httpAction` webhooks | provider-trusted (Paystack signs anyway) |
| Mutations per user | 60 / min default; tighter on secret save / member changes |
| Prospector search | per-org daily quota (default 200) |
| Bulk send (email/WA) | Meta-tier + Resend IP respect |
| AI calls | per-feature daily KES budget |

## Audit log

`auditLog` records every mutation:

```
{ organizationId, workspaceId?, actorId?,
  action, resourceType, resourceId,
  before, after, reason,
  ip, userAgent, requestId, payload,
  occurredAt }
```

Retention: 1 year default; 7 years for financial mutations (KRA via Omnix workspace context).

Org Owner views at `/settings/audit-log` — filterable by actor/action/resource/time, exportable.

## PII handling

- Email + phone stored normalized
- Mask in logs by default (`patric***@example.com`, `+254712***678`)
- AI calls follow workspace PII policy (none / mask_contacts / mask_names / strict)
- GDPR-style data export: Org Owner → Settings → Data → Export → encrypted ZIP → emailed link (7-day TTL)
- Data deletion: "Delete org" → soft-archive immediately, hard-delete after 30-day grace; per-contact "Forget" strips PII fields

## Input validation

- Every Convex mutation/action arg validated via the schema's `v.…` validators (automatic)
- File uploads via `ctx.storage.generateUploadUrl()` — content type sniffed, max size enforced server-side
- HTML in email bodies: sanitized via DOMPurify before storage + on render
- Webhook payloads: parsed via Zod schemas

## Output encoding

- React default escaping for all user content
- `dangerouslySetInnerHTML` only on sanitized email HTML
- Markdown rendered via `react-markdown` (no `rehype-raw`)

## Session + CSRF

- Convex Auth uses `SameSite=Lax` cookies + JWT verification
- Mutations require valid session — verified in every call
- Cross-origin requests blocked except Paystack iframe (CSP `frame-src`)

## Secret access policy

```ts
// ✓ allowed in server-only Convex code (action / internalAction / mutation / query)
import { decrypt } from "@/convex/lib/secrets";
const key = await decrypt(row.encryptedValue);

// ✗ banned: leaking into client. Convex's separation enforces this:
//   - lib/secrets.ts is only callable from within convex/ functions
//   - client components only see what the server returns
//   - decrypted values are never part of a return shape from a public function
```

## Dependency safety

- `package-lock.json` committed
- Renovate / Dependabot weekly PRs
- `npm audit` in CI, fail on high/critical
- Pinned exact versions for security-sensitive deps (Convex, `@convex-dev/auth`)
- Manual review before adding new deps (no typo-squat-look-alikes)

## Logging hygiene

- Never log full request bodies, Tier-1/2 secrets, raw passwords, session cookies, OAuth tokens
- Sentry `beforeSend` hook strips known sensitive fields
- Convex function logs go to the Convex dashboard (`/convex.atlas.blyss.co.ke`) — operator-only

## Security headers (Next.js)

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Cross-Origin-Opener-Policy: same-origin
```

## Public share pages

`/share/{token}` for documents, `/book/{ws}/{type}` for bookings, `pay.atlas.blyss.co.ke/{slug}` for payment links.

- Tokens: 128-bit URL-safe random
- Single-purpose (a share token cannot access another resource)
- Soft expiry (default 90 days)
- Rate limited per token (100 views / 24h)
- `noindex, nofollow` meta + robots.txt deny on `/share/*` and `pay.*`

## Incident response

1. **Sentry alert** → operator notified
2. **Audit log query** → who did what when
3. **Master key compromise** → trigger rotation procedure above
4. **Tier-1 leak** → Org Owner rotates in Settings; revoke on Paystack/Resend/etc. dashboard
5. **Data breach** → GDPR notification within 72h (org admin contact + affected end-users)

## Kenyan compliance notes

- **Data Protection Act 2019** — Atlas is the data controller for Blyss's org data; Org Owners are controllers for their contacts. Export/delete tooling provided.
- **KRA**: invoices issued via Atlas can carry an `etimsReference` field (Omnix's desktop app handles eTIMS signing in v1). Future: Atlas as eTIMS issuer requires KRA registration.
- **PCI-DSS scoping minimized** because card data never touches Atlas servers — Paystack hosts the checkout iframe.

## Per-phase security gate

- [ ] CSP headers in place
- [ ] All mutations validate Zod input (automatic via Convex validators)
- [ ] All mutations write `auditLog`
- [ ] No Tier-1/2 secret in client bundle (verified via build artifact grep)
- [ ] Rate limits on auth surfaces
- [ ] Sentry redaction working (test with planted fake PII)
- [ ] HSTS + secure cookies set
- [ ] `npm audit` clean (no high/critical)
