# 16 · Skills & References

The skills installed in `.kiro/skills/` are not decorative. Each one fires at a specific moment in the build. Skipping them is the #1 reason AI builds turn into Bootstrap-template output.

## Installed skills (active for this repo)

| Skill | Path | When to invoke |
|---|---|---|
| `frontend-design` | `.kiro/skills/frontend-design/SKILL.md` | **Before** drafting ANY new page, component, or screen |
| `hallmark` | `.kiro/skills/hallmark/SKILL.md` | Greenfield pages; redesigns; URL/screenshot studies |
| `emil-design-eng` | `.kiro/skills/emil-design-eng/SKILL.md` | **Before** designing any interactive component (button, drawer, modal, tooltip, popover, tab, dropdown) |
| `anti-slop-writing` | `.kiro/skills/anti-slop-writing/SKILL.md` | Writing any user-facing copy (empty states, error messages, onboarding, marketing) |
| `stop-slop` | `.kiro/skills/stop-slop/SKILL.md` | Editing existing copy to remove AI tells |

## Invocation playbook by phase

### Phase 0 — Foundation

- Invoke `frontend-design` once at start to lock the aesthetic direction
- Invoke `emil-design-eng` when building each base component override (Button, Input, Card, Sheet, Dialog)
- `hallmark` runs on the empty-state screens (Today view shell, empty inbox)

### Phase 1 — The graph

- `frontend-design` before contact list view, before slide-over detail
- `emil-design-eng` for the Sheet entrance + Table interaction + Tabs switcher
- `anti-slop-writing` for all empty states ("No contacts yet — add your first")

### Phase 2 — Email

- `frontend-design` for the 3-pane inbox layout
- `emil-design-eng` for compose drawer, snooze popover, attachment chip
- `anti-slop-writing` for template starter copy

### Phase 3 — Prospector

- `hallmark` for the search results map + table layout (greenfield page)
- `emil-design-eng` for the bulk-select interaction and drafts pane drawer

### Phase 4 — WhatsApp

- `frontend-design` for unified inbox toggle
- `emil-design-eng` for template approval status badges, cost meter
- `anti-slop-writing` for canned WhatsApp template copy

### Phase 5 — AI gateway + workflows

- `frontend-design` for the Settings → AI 4-tab page
- `anti-slop-writing` for digest copy, AI memory descriptions, "AI generated" badge text (which should be minimal)

### Phase 6 — Pipelines

- `frontend-design` for the Kanban board
- `emil-design-eng` for the drag interaction (Emil's drag spec applies directly)

### Phase 7a — Documents

- `hallmark` for the document editor layout + share page layout
- `anti-slop-writing` for all template body copy (proposals, quotes, invoices)

### Phase 7b — Payments

- `frontend-design` for payment pages, invoice PDF layout (PDF is print-style design)
- `emil-design-eng` for status transitions (draft → sent → paid)

### Phase 8 — Campaigns

- `hallmark` for the campaign builder canvas
- `anti-slop-writing` for sequence templates

### Phase 9 — Analytics

- `frontend-design` for dashboards
- `emil-design-eng` for chart hover interactions

### Phase 10 — Calendar

- `hallmark` for the public booking page layout
- `emil-design-eng` for slot picker interactions

### Phase 11 — Polish

- Final `hallmark` audit on every public surface
- Run anti-pattern checklist from `04-ui-direction.md`

## External technical references

### Framework

- Next.js 16 — read `node_modules/next/dist/docs/` (this version has breaking changes vs training data per AGENTS.md)
- React 19 — Server Actions, RSC, `use()` hook, transitions
- TypeScript 5.x strict — exhaustiveness checks, `satisfies`, template literal types

### Auth + DB

- Better Auth v1.7+ — Organization plugin, API Key plugin, Two Factor plugin
- Drizzle ORM — relations, migrations, queries with `cache()`
- pgvector — HNSW index tuning, hybrid retrieval

### UI

- shadcn/ui — components, theming via CSS variables
- Tailwind v4 — `@theme` directive, OKLCH, no PostCSS plugin chain (Tailwind v4 is its own preprocessor via Lightning CSS)
- Motion (formerly Framer Motion) — gestures, layout animations, springs
- TipTap v3 — ProseMirror, custom extensions, server-side rendering of JSON
- TanStack Table v8 — virtualization, column sizing, sorting, filtering
- `@react-pdf/renderer` — React components → PDF, declarative styling

### AI

- Vercel AI SDK v6 — providers list, tool calling, streaming, structured output
- Each provider's own docs for free-tier limits + model IDs

### Communications

- Resend — Send + Inbound + Webhooks
- Meta WhatsApp Cloud API — Cloud API docs, template management, webhook events
- Cloudflare Email Routing + Workers (overflow path)

### Payments

- Paystack — Subaccounts, Payment Pages, Payment Requests, Subscriptions, Transfers, Splits, Webhooks
- DocuSeal — Self-host docs, signing API, webhook events

### Storage + infra

- Cloudflare R2 — S3-compatible API, presigned URLs, public bucket via custom domain
- Neon — Pricing, branches, PITR, pooler
- Vercel — App Router specifics, env management, edge functions

### Observability

- Sentry — Next.js integration, source maps, performance
- PostHog — events, sessions, feature flags

### Maps

- Google Places API (New) — Text Search, FieldMask, pricing
- MapLibre GL — tile sources (OpenFreeMap), layer styling

## Documentation strategy

Atlas's own user-facing docs live at `docs.atlas.blyss.co.ke` (post-launch). For now:

- **`README.md`** at repo root: 1-page setup + dev workflow
- **`/ops/runbook.md`**: operator playbook (incident response, key rotation, backup restore)
- **`/docs/*.md`**: user-facing topic docs (post-launch, written for Org Owners)
- **JSDoc** on all `lib/*` exported functions
- **`plan/`** (this directory): the source of truth specification — kept up-to-date as the build evolves

## When to re-read which file in this plan

| Building this | Re-read |
|---|---|
| Any new page | `04-ui-direction.md` + `14-do-not-do.md` + relevant module section in `07-modules.md` |
| Auth flow | `06-auth-and-permissions.md` |
| Anything touching Tier 1/2 secrets | `06-auth-and-permissions.md` + `11-security.md` |
| Adding an AI feature | `08-ai-gateway.md` |
| Payments code | `10-payments.md` |
| Adding a DB table | `05-data-model.md` invariants + `12-performance.md` index rules |
| Background job | `13-deployment.md` (worker setup) + `12-performance.md` |
| Anything user-facing copy | `anti-slop-writing` skill + `02-product-philosophy.md` |
| Phase boundary | `15-phases.md` acceptance criteria |

## Optional MCPs (install in Kiro config if you want me to query directly)

- **shadcn MCP** — `npx shadcn@latest mcp init --client kiro` (or claude/cursor). Live access to component registry.
- **Context7 MCP** — `npx ctx7 setup` then add API key. Live version-correct docs (helps avoid Tailwind v3 / v4 confusion, etc.)
- **Playwright MCP** — `npx @playwright/mcp@latest`. Browser automation for acceptance testing + visual comparison.
- **Better Auth MCP** (Chonkie) — guided Better Auth config. Useful if we hit edge cases.

These are nice-to-have, not required. The skills above are doing the heavy lift.
