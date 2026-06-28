# 03 · Tech Stack

Exact versions. Do not substitute. If a choice here turns out wrong during build, update this file first, justify in a comment, then change the code.

## Runtime + framework

| Layer | Choice | Version |
|---|---|---|
| Runtime | Node.js | 20 LTS |
| Framework | Next.js | 16.2.9 (already installed) |
| Language | TypeScript | 5.x strict, no `any` |
| Package manager | npm | bundled with Node 20 |

**Why Next.js 16 specifically:** the project is already on 16.2.9. AGENTS.md warns this is a non-standard fork — we read `node_modules/next/dist/docs/` for the actual API surface of *this* version before writing each major piece. We do not assume Next 14 conventions.

## Database + ORM

| Layer | Choice | Notes |
|---|---|---|
| Database | PostgreSQL 16 | Hosted on Neon free tier (0.5 GB/project, 100 CU-hr/mo, scale-to-zero after 5 min idle) |
| ORM | Drizzle | Schema as code, migrations, RSC-safe, no second ORM allowed |
| Vector | pgvector with HNSW | In the same Neon DB. `ef_search=200`, `ef_construction=200`, dim 768 (Gemini embedding-004) |
| Full-text | Postgres FTS (`tsvector` + `tsquery`) with GIN indexes | Hybrid retrieval via RRF (k=60) |
| Connection pool | Neon's serverless pooler (PgBouncer-compatible) | Use `DATABASE_URL` for transactions; pooled URL for RSC reads |
| Jobs | pg-boss | In the same DB, no Redis required |

**Money column convention:** `numeric(20, 4)` for all monetary amounts. Currency in a parallel `text` column (`KES` / `USD` / `ZAR` etc., ISO 4217). Tax math is integer cents in code; we store the rounded result.

## Auth

| Layer | Choice |
|---|---|
| Auth library | Better Auth |
| Plugins enabled | Organization, API Key, Two Factor (TOTP), Passkey (future) |
| Methods | Email + password, magic link, Google OAuth |
| Session | JWT in HTTP-only cookies, 30-day refresh |
| Org model | Single Org → many Workspaces → workspace-level RBAC (see 06) |

## UI

| Layer | Choice |
|---|---|
| Component library | shadcn/ui (full registry, theme-modified — see 17) |
| Styling | Tailwind CSS v4 (already installed) — CSS variables, OKLCH color |
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

| Family | Family member | Where |
|---|---|---|
| Display serif | **Instrument Serif** (300, 400, italic + roman) | Section headings, one italic keyword for emphasis |
| UI sans | **Geist** (400, 500, 600) | All body, UI controls |
| Mono | **Geist Mono** (400) | Numbers, codes, IDs, keyboard shortcuts |

All via `next/font/google` with `display: 'swap'`. No Inter, no Roboto, no Arial, no Space Grotesk. Forbidden.

## AI

| Layer | Choice |
|---|---|
| SDK | Vercel AI SDK v6 |
| Providers (free-tier first) | Gemini · Groq · OpenRouter · Mistral · Cohere · Cerebras · GitHub Models · Together · Anthropic · OpenAI (paid) |
| Embeddings | Gemini text-embedding-004 (free), Cohere embed-v3 (fallback) |
| Pattern | Provider abstraction + per-feature binding + fallback chain (see 08) |
| Secret storage | AES-256-GCM at rest, master key in env (Tier 0 — see 06) |

## Communications

| Channel | Provider |
|---|---|
| Email outbound | Resend |
| Email inbound | Resend Inbound webhook (primary, 3K/mo free including inbound) |
| Email inbound overflow | Cloudflare Email Routing → Worker → Atlas webhook (free fallback) |
| WhatsApp | Meta WhatsApp Cloud API direct (1K service convos/mo free) |
| SMS (future) | Africa's Talking |

## Payments

| Capability | Provider |
|---|---|
| All payment in | Paystack (cards, M-PESA, paybill, till, Pesalink) |
| Recurring (card) | Paystack Subscriptions |
| Recurring (M-PESA) | Atlas-managed reminder loop (Paystack doesn't auto-charge M-PESA) |
| Payouts out | Paystack Transfers (KE bank, M-PESA wallet/paybill/till) |
| Marketplace splits | Paystack Transaction Splits |
| Per-workspace settlement | Paystack Subaccounts (1:1 with Atlas workspace) |
| E-signature | DocuSeal self-host on Hetzner VPS (~$5/mo) |

See `10-payments.md` for the full Paystack architecture.

## Storage

| Use | Provider |
|---|---|
| Object storage (files, attachments, PDFs, images) | Cloudflare R2 (10 GB free, zero egress) |
| Presigned upload URLs | `@aws-sdk/client-s3` (R2 is S3-compatible) |
| Image transforms | Cloudflare Image Resizing (R2 + Workers) |

## Background jobs + cron

| Need | Tool |
|---|---|
| Job queue | pg-boss in the same Neon DB |
| Recurring (cron) | pg-boss `schedule()` |
| Long-running (> 30s) | pg-boss worker process (separate Node process or Vercel Background Function) |
| Webhook delivery | pg-boss with dead-letter queue |

## Observability

| Concern | Tool |
|---|---|
| Errors | Sentry (5K errors/mo free) |
| Product analytics | PostHog (1M events/mo free) |
| Structured logs | Pino → stdout (picked up by Vercel logs or `journalctl` if self-hosted) |
| Tracing | OpenTelemetry (optional, post-launch) |
| Uptime | BetterStack or cron-job.org (both free) |

## Maps + lead gen

| Need | Tool |
|---|---|
| Business search | Google Places API (New) Text Search |
| Cost control | `FieldMask` header, free $200/mo Google Cloud credit |
| Geocoding | Google Geocoding API |
| Map render | MapLibre GL or Leaflet (free, no Mapbox key needed) |

## Testing

| Layer | Tool |
|---|---|
| Unit + integration | Vitest |
| E2E | Playwright |
| A11y | axe-core via Playwright |
| Visual regression | Playwright screenshots |
| Performance | `@lhci/cli` (Lighthouse CI) |

## CI/CD

| Stage | Tool |
|---|---|
| CI | GitHub Actions |
| Preview | Vercel preview deploys per PR |
| Production | Vercel production from `main` branch (or Hetzner VPS if we move) |
| Migrations | Drizzle Kit, gated by manual approval for production |

## Forbidden choices

- Electron (we have no native desktop need)
- Prisma (Drizzle was specified, do not switch)
- Mongo, Supabase, Firebase (we use Neon + Drizzle directly)
- Redux, Zustand for global server state (RSC + Server Actions covers it)
- Apollo / GraphQL (Server Actions + tRPC-style typed RPC is enough)
- MUI, Chakra, Ant Design, Mantine (shadcn only)
- Inter, Roboto, Arial, Space Grotesk, system fonts (use the locked type system)
- Pure black `#000000` or pure white `#FFFFFF` (use the palette — see 04)
- Any color outside the locked palette (no green/blue/purple/teal, except semantic colors)
- jQuery (truly, no)
- Lodash (use native + small focused libs)
- `any` in TypeScript (use `unknown` and narrow)

## Local dev environment

The dev environment runs in code-server (cloud) with Cloudflare tunnel exposing the dev port at `<port>.blyss.co.ke`. See `13-deployment.md` for the full setup including envs and Cloudflare configuration.
