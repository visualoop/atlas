# 03 · Tech Stack

Exact versions. Do not substitute. If a choice here turns out wrong during build, update this file first, justify in a comment, then change the code.

## The stack in one paragraph

**Self-hosted Convex** is the entire backend — database, real-time sync, auth, file storage, full-text search, vector search, scheduled functions, webhooks, encrypted secrets storage. **Next.js 16 (App Router)** is the frontend, deployed to Vercel via `visualoop` GitHub. The Convex backend image (`ghcr.io/get-convex/convex-backend`) runs in Docker locally for development and in a **k3s namespace on the Oracle Cloud cluster** for production, alongside `blyss`, `olestones`, `chapaswali`, and `monitoring`. Same binary, dev = prod.

## Runtime + framework

| Layer | Choice | Version |
|---|---|---|
| Runtime | Node.js | 20 LTS (host) |
| Framework | Next.js | 16.2.9 (already installed) |
| Language | TypeScript | 5.x strict, no `any` |
| Package manager | npm | bundled with Node 20 |

**Why Next.js 16 specifically:** the project is already on 16.2.9. AGENTS.md warns this is a non-standard fork — we read `node_modules/next/dist/docs/` for the actual API surface of *this* version before writing each major piece. We do not assume Next 14 conventions. Important rename in 16: `middleware.ts` → `proxy.ts`.

## Backend — Convex

| Concern | Choice | Notes |
|---|---|---|
| Database + real-time sync + cron + HTTP | **Convex** | Open source, self-hosted; `ghcr.io/get-convex/convex-backend:latest` |
| Auth | **`@convex-dev/auth`** | Password + magic-link OTP providers; JWT keys live in Convex env |
| Email send/inbound wrapper | **`@convex-dev/resend`** | Wraps the org's encrypted Resend key from Tier-1 secrets |
| File storage | Convex built-in `ctx.storage` | No R2/S3/MinIO. Encrypted at rest, signed URLs free. |
| Full-text search | Convex `searchIndex` | One declarative index per searchable field |
| Vector search | Convex `vectorIndex` | For AI memory + semantic search |
| Background jobs / cron | `crons.interval`, `crons.cron` | Never use `crons.daily`/`crons.weekly` — they do not exist |
| Webhooks (inbound) | `httpAction` in `convex/http.ts` | Paystack, Resend inbound, Meta WhatsApp, etc. |
| Encrypted secrets | `convex/lib/secrets.ts` | AES-GCM via Web Crypto, single env-stored master key |
| Local dev backend | Docker via `docker-compose.yml` | Same image as prod |
| Production backend | k3s `atlas` namespace | Same image, same env shape |

**Money invariant:** `v.int64()` cents. **Never** float / number. The Omnix audit report taught the cost of float for money — Atlas inherits that lesson via Convex's typed validators.

## Frontend deploy

| Layer | Choice |
|---|---|
| Host | **Vercel** (via `visualoop` GitHub account, Vercel CLI already logged in) |
| Team slug | `daily-cutlines-projects` |
| Cloudflare in front | DNS proxied for the production domain |
| Local preview | Code-server + Cloudflare tunnel: `<port>.blyss.co.ke` |

## Auth

| Layer | Choice |
|---|---|
| Auth library | **`@convex-dev/auth`** with `Password` + `Email` (OTP) providers |
| Sign-in modes | Email + 12-char password, magic-link 6-digit OTP, future Google OAuth via Convex Auth |
| 2FA | TOTP via Convex Auth (Phase 1+) |
| Org / workspace model | Atlas-managed `organizations` + `workspaces` + `members` + `workspaceMembers` tables (see 06) |
| Invitation flow | `invitations` table + email via Tier-1 Resend; invitee can create own org first |
| Encrypted Tier-1/2 secrets | `orgIntegrationKeys` + `userPersonalKeys` Convex tables, AES-GCM |

## UI

| Layer | Choice |
|---|---|
| Component library | shadcn/ui (full registry, theme-modified — see 17) |
| Underlying primitives | `@base-ui/react` (shadcn Nova preset) |
| Styling | Tailwind CSS v4 — CSS variables, OKLCH color |
| Theme switching | `next-themes` |
| Icons | Lucide React (thin line, never emoji) |
| Rich text | TipTap v3 (ProseMirror, headless) |
| Tables | TanStack Table v8 |
| Command palette | cmdk via shadcn `Command` component |
| Drawers / sheets | Vaul via shadcn `Drawer`; shadcn `Sheet` for slide-overs |
| Toasts | Sonner via shadcn `Sonner` |
| Charts | Recharts via shadcn `Chart` |
| Date / time | `date-fns` (lighter than dayjs/moment) |
| Forms | React Hook Form + Zod resolver |
| PDF generation | `@react-pdf/renderer` (server-side, no Puppeteer) |
| PDF viewer | `react-pdf` (PDF.js wrapper) |
| Carousel | embla-carousel-react |
| Drag & drop | `@dnd-kit/core` (Kanban board) |

## Type system

| Role | Family | Weight | Style | Use |
|---|---|---|---|---|
| Display serif | **Instrument Serif** | 400 | Roman + Italic | Section headings, one italic keyword per heading |
| UI sans | **Geist** | 400, 500, 600 | Roman | All body, UI controls |
| Mono | **Geist Mono** | 400 | Roman | Numbers, codes, IDs, keyboard shortcuts |

All via `next/font/google` with `display: 'swap'`. No Inter, no Roboto, no Arial, no Space Grotesk. Forbidden.

## AI

| Layer | Choice |
|---|---|
| SDK | Vercel AI SDK v6 — invoked inside Convex `action`s |
| Providers (free-tier first) | Gemini · Groq · OpenRouter · Mistral · Cohere · Cerebras · GitHub Models · Together · Anthropic · OpenAI (paid) |
| Embeddings | Gemini text-embedding-004 (free), Cohere embed-v3 (fallback) |
| Pattern | Provider abstraction + per-feature binding + fallback chain (see 08) |
| Secret storage | `orgIntegrationKeys` table, AES-GCM encrypted, decrypted server-side only |

## Communications

| Channel | Provider |
|---|---|
| Email outbound | Resend (via `@convex-dev/resend`, using the org's Tier-1 key) |
| Email inbound | Resend Inbound webhook (Phase 2) → `httpAction` in `convex/http.ts` |
| Email inbound overflow | Cloudflare Email Routing → Worker → Atlas `httpAction` (free fallback) |
| WhatsApp | Meta WhatsApp Cloud API direct (Phase 4) |
| SMS (future) | Africa's Talking |

## Payments

All payments go through **Paystack**. M-PESA paths are Paystack-only — no direct Daraja integration (see plan `10-payments.md` for the full mapping). Webhook receiver lives in `convex/http.ts` and verifies HMAC-SHA512 of the raw body against the org's secret key.

| Capability | Provider |
|---|---|
| All payment in | Paystack (cards, M-PESA, paybill, till, Pesalink) |
| Recurring (card) | Paystack Subscriptions |
| Recurring (M-PESA) | Atlas-managed reminder loop (Paystack does not auto-charge M-PESA) |
| Payouts out | Paystack Transfers (KE bank, M-PESA wallet/paybill/till) |
| Marketplace splits | Paystack Transaction Splits |
| Per-workspace settlement | Paystack Subaccounts (1:1 with Atlas workspace) |
| E-signature | DocuSeal self-host on the same k3s cluster (Phase 7a) |

## Storage

| Use | Provider |
|---|---|
| All files (PDFs, attachments, images, prospector cache) | **Convex `ctx.storage`** — built into the backend, encrypted at rest |
| Backups | Daily `convex export` → backup PVC in k3s (kept 14 days) |
| Off-site backup (future) | Optional `rclone` to R2 from a cron job — same key recovery story |

## Background jobs + cron

| Need | Tool |
|---|---|
| Scheduled work | `crons.interval` / `crons.cron` |
| One-off async | `internalAction` + `scheduler.runAfter` |
| Long-running with retries | `@convex-dev/workflow` (when needed, Phase 4+) |
| Rate limiting | `@convex-dev/rate-limiter` |

## Observability

| Concern | Tool |
|---|---|
| Errors (client + server) | Sentry (5K errors/mo free) |
| Product analytics | PostHog (1M events/mo free) |
| Convex function logs | Convex dashboard at `https://convex.atlas.blyss.co.ke` (k3s) or `https://6791.blyss.co.ke` (local) |
| Cluster monitoring | Existing Prometheus + Grafana at `grafana.blyss.co.ke` |
| Uptime checks | BetterStack or cron-job.org (both free) |

## Maps + lead gen

| Need | Tool |
|---|---|
| Business search | Google Places API (New) Text Search via Convex `action` |
| Cost control | `FieldMask` header, free $200/mo Google Cloud credit |
| Geocoding | Google Geocoding API |
| Map render | MapLibre GL or Leaflet (free, no Mapbox key needed) |

## Testing

| Layer | Tool |
|---|---|
| Unit + integration (Convex) | `convex-test` + Vitest |
| Unit (Next.js components) | Vitest + `@testing-library/react` |
| E2E | Playwright |
| A11y | axe-core via Playwright |
| Performance | `@lhci/cli` (Lighthouse CI) |

## CI/CD

| Stage | Tool |
|---|---|
| CI (lint, type-check, test, build) | GitHub Actions in this repo |
| Frontend preview | Vercel preview deploys per PR (auto-linked via `visualoop`) |
| Frontend production | Vercel production from `main` |
| Convex backend (k3s) | GitHub Actions deploys via SSH to Oracle Cloud k3s — see 13 |
| Convex functions push | `npx convex deploy` with `CONVEX_SELF_HOSTED_URL` + admin key |

## Cluster context (Oracle Cloud, k3s)

Atlas joins an existing k3s cluster on Oracle Cloud at `130.162.184.133`:

| Namespace | RAM | Storage |
|---|---|---|
| blyss | 10.5 GB | 82 GB |
| olestones | 3 GB | 38 GB |
| chapaswali | 4.5 GB | 20 GB |
| monitoring | 2 GB | 28 GB |
| **atlas** (new) | **2.5 GB** | **15 GB** |
| System reserve | 1.5 GB | 12 GB |
| **Total** | **24 GB** ✓ | **195 GB** ✓ |

See `13-deployment.md` for the full deploy story.

## Forbidden choices

- Postgres / Drizzle / Better Auth / pg-boss / R2 / Supabase (Convex covers all of it)
- Electron (PWA install instead)
- Apollo / GraphQL client (Convex queries are typed RPC)
- Redux / Zustand for *server* state (Convex `useQuery` covers it)
- MUI / Chakra / Ant Design / Mantine (shadcn only, theme-modified)
- jQuery
- `crons.daily` / `crons.weekly` (they do not exist in Convex)
- `any` in TypeScript (use `unknown` and narrow)
- Default exports for Convex functions (named only)
- Mixing JS and TS (TS strict throughout)
- Direct Daraja integration (Paystack only)
- Pure black `#000000` or pure white `#FFFFFF` in UI (use the palette — see 04)
- Floats for money (always `v.int64()` cents)

## Local dev environment

The dev environment runs in code-server (cloud) with Cloudflare tunnel exposing the dev port at `<port>.blyss.co.ke`:

- `3010` → Next.js dev server → `https://3010.blyss.co.ke`
- `3220` → Convex API + WebSocket → `https://3220.blyss.co.ke`
- `3221` → Convex HTTP actions → `https://3221.blyss.co.ke`
- `6791` → Convex local dashboard → `https://6791.blyss.co.ke`

`docker-compose.yml` runs the Convex backend + dashboard locally. `.env.local` carries:

- `CONVEX_INSTANCE_SECRET` (the local backend identity)
- `CONVEX_SELF_HOSTED_URL` / `CONVEX_SELF_HOSTED_ADMIN_KEY` (for `npx convex deploy`)
- `NEXT_PUBLIC_CONVEX_PUBLIC_URL` (the browser-reachable URL)

The frontend connects via `NEXT_PUBLIC_CONVEX_PUBLIC_URL` so the rewrite to `127.0.0.1:3220` that `convex dev` does doesn't break the browser path.

## What lives where

```
atlas/
├── app/                              Next.js routes (frontend, deployed to Vercel)
├── components/                       React components
├── convex/                           ALL backend code
│   ├── schema.ts                     Tables, indexes, search/vector indexes
│   ├── auth.ts                       @convex-dev/auth setup
│   ├── auth.config.ts                JWKS pointer
│   ├── http.ts                       Webhook handlers (Paystack, Resend in, Meta)
│   ├── crons.ts                      Scheduled work
│   ├── lib/
│   │   ├── secrets.ts                AES-GCM encrypt/decrypt
│   │   └── authHelpers.ts            requireUser, requireOrgRole, …
│   ├── organizations.ts              Org + workspace CRUD
│   ├── members.ts                    (Phase 0 follow-up) invite, role change
│   ├── workspaces.ts                 (Phase 1+)
│   ├── companies.ts                  (Phase 1)
│   ├── conversations.ts              (Phase 2)
│   ├── ai/                           (Phase 4) provider gateway, workflows
│   ├── payments/                     (Phase 7b) Paystack integration
│   ├── prospector/                   (Phase 3) Google Maps + enrichment
│   └── _generated/                   Auto-generated types (gitignored)
├── docker-compose.yml                Local Convex backend + dashboard
├── infra/atlas/                      k3s manifests (production)
├── .github/workflows/                CI + deploy
└── plan/                             This documentation
```
