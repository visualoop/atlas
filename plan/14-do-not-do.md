# 14 · Do Not Do

Hard rules. Each one was hard-won from the brief above. Anything in this file is a build defect if it appears in shipped Atlas.

## Visual / UX bans

- ❌ Section titled "Features", "Services", "Why Choose Us", "What we offer", "How it works" (for marketing copy on internal app surfaces — internal product names are OK)
- ❌ Drop-shadow cards (`box-shadow` on surface elements)
- ❌ `rounded-xl` or anything more than `4px` border-radius (except dense input chips)
- ❌ Gradient buttons or backgrounds on UI surfaces (chart series gradients OK)
- ❌ Emoji icons in UI (use Lucide thin line)
- ❌ Three-column emoji feature grid
- ❌ "Trusted by N companies" / logo strip
- ❌ Star-and-avatar testimonial slider
- ❌ Animated counter / odometer
- ❌ Spinner over 200ms (use skeleton)
- ❌ Modal dialog for data entry (use Sheet / Drawer)
- ❌ Hover-zoom on images
- ❌ Carousel auto-rotation under 8 seconds
- ❌ Auto-play video with sound
- ❌ Pure `#000000` or pure `#FFFFFF`
- ❌ Any color outside the locked palette (no blue/green/purple/teal except semantic muted variants)
- ❌ System fonts, Inter, Roboto, Arial, Space Grotesk (use Geist + Instrument Serif + Geist Mono)
- ❌ Two italic words per heading (only one; the rest is roman)

## Motion bans

- ❌ `transition: all`
- ❌ Animating `width` / `height` / `padding` / `margin` (only `transform` + `opacity`)
- ❌ `scale(0)` entry (start from `scale(0.95)` minimum)
- ❌ `ease-in` on UI interactions
- ❌ CSS browser default `ease` (use locked custom curves)
- ❌ Animation on focus ring appearance (must be instant)
- ❌ Animation on keyboard-initiated action (palette open, j/k nav, ⌘1 switch)
- ❌ Bounce / overshoot on UI state transitions
- ❌ Spring config without `mass`/`stiffness`/`damping` reasoning
- ❌ Ignoring `prefers-reduced-motion`

## Architecture bans

- ❌ Prisma (we use Drizzle) — obsolete (we now use Convex). Do not add Prisma.
- ❌ MongoDB / Firebase / Supabase auth (we use Convex)
- ❌ Electron (PWA install instead)
- ❌ Apollo / GraphQL client (Convex queries are typed RPC)
- ❌ Redux / Zustand for *server* state (Convex `useQuery` covers it)
- ❌ MUI / Chakra / Ant Design / Mantine (shadcn only, theme-modified)
- ❌ jQuery
- ❌ Raw SQL — no SQL layer, Convex is the DB
- ❌ `any` in TypeScript (use `unknown` + narrow)
- ❌ Default exports for Convex functions (named exports only)
- ❌ Mixing JS and TS (TS strict throughout)
- ❌ Client-side fetch to our own API (use Convex mutations/queries)
- ❌ Long-running synchronous work in mutations (≥ 2s → `internalAction` + `scheduler.runAfter`)
- ❌ **Zapier** — Atlas uses Composio for third-party integrations. Zapier is 2010s no-code and does not fit the AI-agent-native architecture. See `plan/19-integrations.md`.
- ❌ **Building per-app OAuth flows for long-tail SaaS** — Composio handles GitHub / Slack / HubSpot / Notion / etc. Native OAuth is reserved for the platforms core to Atlas (Meta, LinkedIn, Google, Resend, Paystack, Meta WhatsApp).

## Data integrity bans

- ❌ `real` / `float` columns for money (use `numeric(20, 4)`)
- ❌ Hard delete by default (soft-delete with `deleted_at`)
- ❌ Missing `workspace_id` on workspace-scoped tables
- ❌ Missing index on a frequently-queried column
- ❌ No `updated_at` on mutable tables
- ❌ Implicit `ON DELETE` behavior (always explicit cascade/restrict/set null)
- ❌ Non-UUID primary keys (UUID v4 everywhere)
- ❌ Local-time timestamps (UTC `timestamptz` only)
- ❌ Editing a committed migration (always additive new one)
- ❌ Mutation without audit_log entry

## Security bans

- ❌ Tier 1 / Tier 2 secrets in client bundles (`server-only` import guard)
- ❌ Tier 1 secret value displayed after save (only `last_four`)
- ❌ Logging passwords, full session cookies, or decrypted secrets
- ❌ `dangerouslySetInnerHTML` without DOMPurify
- ❌ Webhook handler that doesn't verify signature
- ❌ Routes without rate limit on auth surfaces
- ❌ Database query without parameterization
- ❌ Storing OAuth tokens unencrypted
- ❌ Skipping CSRF tokens on mutating endpoints
- ❌ Master key in any committed file (env only)
- ❌ Permissive CORS (locked to our own origins)

## AI bans (extended)

- ❌ Auto-send any AI-generated message (always founder-approval gated)
- ❌ Auto-charge / auto-pay anything based on AI output
- ❌ Auto-modify deal stage / lifecycle without confirmation
- ❌ Hardcoding an API key in code
- ❌ Skipping the budget guard
- ❌ Skipping fallback chain
- ❌ Logging full AI inputs without PII redaction policy applied
- ❌ Loud "Made with AI" badges on every AI artifact (we make AI invisible by default)
- ❌ Chatbot sidebar that demands prompting (AI is in the work, not a separate panel — the ⌘J Copilot is the ONE exception)
- ❌ Auto-executing Composio tool calls that write to third-party systems without user preview + confirm (read-only tools are OK to auto-invoke; writes gate through the automation preview UI)
- ❌ Groq Compound calls without a workspace-level daily budget cap (agentic tools use tokens fast)

## Payment bans

- ❌ Direct Daraja integration (we use Paystack only — operator can add Daraja path later if needed, but never as the default)
- ❌ Storing card numbers anywhere in Atlas (Paystack hosted checkout only)
- ❌ Currency mixed in one numeric column (always pair amount with currency column)
- ❌ Tax computed in floating point (integer cents, then rounded)
- ❌ Send / receive money flows without webhook idempotency
- ❌ Payment status changes outside the webhook + admin-correction paths
- ❌ Skipping audit log on financial mutations

## Email + WhatsApp bans

- ❌ Send from a sender identity that hasn't passed DKIM/SPF verification (show banner: "Verify sender identity to send")
- ❌ Send WhatsApp marketing outside an approved template
- ❌ Send WhatsApp outside the 24h service window with a free-form message
- ❌ Ignore opt-out / suppression list
- ❌ Loop unsubscribe handling (every email has working unsubscribe)
- ❌ Bulk-send without rate limit (Meta tier-respecting, Resend IP-respecting)
- ❌ Track opens / clicks by default for personal correspondence (only campaigns)

## Social publishing bans

- ❌ Auto-publishing without a founder-approval gate (draft → review → send)
- ❌ Posting the same generic content across all platforms (per-platform variants are the point)
- ❌ Cross-posting X/TikTok/YouTube via a scraper or unauthorized aggregator
- ❌ Buying followers / engagement / reviews
- ❌ Auto-liking / auto-following on any platform (violates ToS; reputation risk)
- ❌ Fake urgency / stat inflation ("Only 3 spots left!" without truth)
- ❌ Stock photos without attribution
- ❌ Marketing content that promises deliverables the studio can't ship

## AI bans (extended)

## Mobile / responsive bans

- ❌ Hover-only interactions (touch can't trigger)
- ❌ Hit targets < 44px on mobile
- ❌ Horizontal scroll on mobile main content
- ❌ Display headers that don't wrap on narrow viewports (use `overflow-wrap: anywhere`)
- ❌ Modal that doesn't fit on a 320px-wide screen

## Process bans

- ❌ Skipping the phase acceptance checklist before declaring done
- ❌ Merging a PR that drops Lighthouse score by > 5
- ❌ Merging a PR with new high/critical `npm audit` findings
- ❌ Hand-editing the `migrations/` folder
- ❌ Pushing directly to `main` (PR review required, even solo)
- ❌ Committing `.env.local` (gitignored)
- ❌ Force-pushing to shared branches
