# 12 · Performance

Atlas must feel instant. Founders open it 50+ times a day; latency taxes accumulate. Hard budgets below — fail to meet them and the build is not done.

## Targets

| Metric | Budget |
|---|---|
| TTFB (server) | < 200ms p95 |
| First Contentful Paint | < 1.0s p95 |
| Largest Contentful Paint | < 1.8s p95 |
| Total Blocking Time | < 200ms p95 |
| Cumulative Layout Shift | < 0.05 p95 |
| Inbox load (first 50 threads) | < 400ms p95 |
| Universal search (⌘K) keystroke → results | < 150ms p95 |
| Workspace switch | < 250ms p95 |
| AI streaming first token | < 1.2s p95 |
| Kanban board with 200 deals | < 600ms p95 |
| Lighthouse Performance score | ≥ 95 |
| Lighthouse Accessibility | ≥ 95 |
| Lighthouse Best Practices | ≥ 95 |
| Lighthouse SEO (auth pages) | ≥ 90 |
| Initial JS bundle | < 200 KB gzipped |
| Per-route JS chunk | < 80 KB gzipped |

## How we achieve them

### Server-first

- React Server Components are default. Client components only where genuine interactivity is needed (forms, drag/drop, command palette, charts requiring hover).
- Server Actions for all mutations; no client-side fetch pattern for our own API.
- Streaming RSC where the page can begin rendering before all data arrives (inbox list, Today view).

### Database

- Drizzle queries always start with `where(eq(t.workspace_id, ctx.workspace.id))` — indexed
- Composite indexes on every `(workspace_id, …)` access pattern (see `05-data-model.md`)
- Avoid N+1: prefer one query with joins/aggregates over multiple awaits
- Use `LIMIT` on every list query
- Cursor pagination (not OFFSET) for large lists
- `EXPLAIN ANALYZE` reviewed on every list query during build

### Connection pooling

- Neon's PgBouncer-compatible pooler for short queries (RSC reads)
- Direct connection for transactions (so multi-statement transactions work)
- `MAX_CONCURRENCY` env-tuned per environment

### Caching

Three layers:

1. **React `cache()`** — in-RSC dedup for a single render
2. **Next.js `unstable_cache()`** — cross-request cache with revalidation tags
3. **Application cache** (Redis-style via Upstash, optional) — for hot data like model registry, user role lookups

Cache invalidation by tag:

```ts
const getCompany = unstable_cache(
  async (id) => db.companies.findFirst({ where: { id } }),
  ['company'],
  { tags: [`company-${id}`, `workspace-${workspaceId}`], revalidate: 60 }
);

// On mutation:
revalidateTag(`company-${id}`);
revalidateTag(`workspace-${workspaceId}`);
```

### Search performance

- Postgres FTS with GIN index on `tsvector` (generated column)
- pgvector HNSW index, `m=16, ef_construction=200`
- Query time `ef_search=200` (tunable per route)
- Hybrid via RRF (k=60): rank from FTS + rank from vector → combined score
- Cap at 50 results per query; "load more" cursor
- Embeddings are pre-computed in background — search never blocks on embedding

### Asset optimization

- Next.js Image with `priority` only on LCP image
- Images served from R2 with Cloudflare Image Resizing transforms
- Fonts via `next/font/google` (self-hosted at build time, zero render-blocking)
- Inline critical CSS via Next.js automatic optimization
- Lucide icons tree-shaken (named imports only)
- Avoid client-side date-fns full import — use per-function imports

### JS bundle discipline

- Bundle analyzer run after every phase: `npm run analyze`
- Any new dep over 50 KB gzipped requires justification in PR
- Forbidden: lodash (use native), moment (use date-fns), full Material Icons set (Lucide only)
- Code-split heavy routes (PDF editor, document preview, prospector map)
- Dynamic imports for charts (`Recharts`), TipTap, PDF renderer

### Streaming AI

- Vercel AI SDK `streamText()` for all chat-style features
- Server-Sent Events for non-AI streaming (e.g., long enrichment progress)
- Suspense boundaries around AI surfaces so the rest of the page renders instantly

### Background jobs

Any operation expected to take > 2s moves to pg-boss:

- Email send (Resend is fast, but queue to retry on 429)
- WhatsApp send (Meta rate limits make this essential)
- Document PDF generation
- Prospector enrichment
- AI memory extraction
- Embedding generation
- Daily / weekly / monthly digest generation
- Reconciliation crons

pg-boss worker process runs alongside the Next.js app (separate `npm run worker` script).

### Optimistic updates everywhere

- Kanban drag: optimistic move + Undo
- Inbox actions (archive, snooze, mark read): instant UI change, server confirms
- Deal stage change: optimistic + Undo
- Form submits: button state spins for ≤ 200ms; if longer, show skeleton

### Loading + skeleton discipline

- Spinners only for actions < 200ms (rare — most go to skeleton)
- Skeleton mirrors the actual layout (no generic grey blob)
- Above-the-fold skeleton has correct dimensions to prevent CLS
- Skeleton shimmer disabled under `prefers-reduced-motion`

### Mobile-specific

- All interactions touch-friendly (≥ 44px hit area)
- Drawer (Vaul) replaces Sheet on mobile
- Inbox triage works on mobile with gestures (swipe right = archive, left = snooze)
- Heavy desktop UI (Kanban drag, dense tables, document editor) shows "View on desktop" prompt instead of degraded mobile version

## Monitoring

- **Vercel Speed Insights** captures field metrics from real users
- **Sentry Performance** for slow transactions (> 1s server)
- **PostHog** session replay (opt-in) for UX issues
- **Lighthouse CI** gates every PR — fails if score drops > 5 from baseline
- **Custom dashboard** at `/admin/health` (Org Owner only):
  - P50/P95/P99 latency per route
  - DB connection pool saturation
  - pg-boss queue depth
  - AI provider response times
  - Cache hit rates

## Failure modes + degradation

When something is slow, what degrades:

| Failure | Behavior |
|---|---|
| DB slow | Surface a skeleton; never spin > 5s |
| Search service down | Fall back to plain FTS without vector |
| AI provider down | Surface "AI unavailable" banner, allow manual drafts |
| Paystack down | Surface in Payments page, queue webhooks for retry |
| Resend down | Queue email send; retry; surface in compose UI as "Sending…" persistent |
| R2 down | Read-only mode for files; new uploads disabled with banner |
| Neon scaled-to-zero | First request takes ~500ms (cold start) — show skeleton |

## Acceptance — performance gate per phase

- [ ] Lighthouse CI all green per page introduced this phase
- [ ] Bundle analyzer reviewed; no new > 50KB dep without justification
- [ ] Slow query analysis on new queries (EXPLAIN < 50ms p95 on indexed paths)
- [ ] Loading skeleton present for any operation > 200ms
- [ ] AI streaming first-token < 1.2s
- [ ] No new CLS regression (≥ 0.05)
- [ ] Mobile Lighthouse ≥ 85 (relaxed from desktop's 95)
