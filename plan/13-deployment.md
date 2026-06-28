# 13 · Deployment

## Environments

| Env | URL | DB | Notes |
|---|---|---|---|
| Local | `localhost:3000` or `<port>.blyss.co.ke` (via Cloudflare tunnel) | Neon dev branch | Used during development |
| Staging | `staging.atlas.blyss.co.ke` | Neon staging branch | Auto-deploy from `main`; for final review |
| Production | `atlas.blyss.co.ke` | Neon production branch | Manual promotion from staging |

## Hosting choice

**Vercel Hobby** for v1 — free for non-revenue internal use, fast deploys, edge runtime where applicable. If Vercel costs become an issue or commercial use kicks in:

- **Cloudflare Pages** with `@opennextjs/cloudflare` — free tier, integrates natively with R2 and Email Routing
- **Hetzner ARM VPS** (`CAX11`, €4.51/mo) — full control, host Next.js + DocuSeal on same box

The plan is Vercel until volume requires migration.

## DNS

- `atlas.blyss.co.ke` → CNAME to Vercel
- `staging.atlas.blyss.co.ke` → CNAME to Vercel staging
- `pay.blyss.co.ke` → CNAME to Vercel (for public payment short links)
- `book.blyss.co.ke` → CNAME to Vercel (for booking pages)
- `<port>.blyss.co.ke` → Cloudflare tunnel from code-server (dev preview)

Cloudflare proxy on; DDoS + bot management defaults.

## Local development setup

### Prerequisites

- Node.js 20 LTS
- npm (bundled)
- Git
- Docker (optional, for local DocuSeal)
- A Neon account + project (free tier)
- A Cloudflare R2 bucket (free tier)
- A Resend account (free tier, 3K emails/mo)

### Steps

1. `git clone <repo>` (already done — we're at `/home/ubuntu/workspace/atlas`)
2. `npm install`
3. `cp .env.example .env.local` — fill in values (see below)
4. `npm run db:migrate` — applies Drizzle migrations to dev DB branch
5. `npm run db:seed` — seeds Blyss org, 3 workspaces, AI model registry, ship default bindings
6. `npm run dev` (in one terminal)
7. `npm run worker` (in another terminal — runs pg-boss jobs)
8. Open `http://localhost:3000` (or `<port>.blyss.co.ke` via tunnel)

### `.env.example` (committed, placeholders only)

```bash
# === System (Tier 0) — operator-controlled ===

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development

# Auth
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=http://localhost:3000

# Master encryption key for Tier 1/2 secrets (32 bytes base64)
ATLAS_MASTER_KEY=<openssl rand -base64 32>

# Database (Neon)
DATABASE_URL=postgres://<user>:<pass>@<host>/<db>?sslmode=require
DATABASE_URL_UNPOOLED=postgres://<user>:<pass>@<host>/<db>?sslmode=require

# Object storage (Cloudflare R2 — S3-compatible)
R2_ACCOUNT_ID=<your-r2-account>
R2_ACCESS_KEY_ID=<r2-access-key>
R2_SECRET_ACCESS_KEY=<r2-secret>
R2_BUCKET=atlas-files
R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
R2_PUBLIC_BASE=https://files.atlas.blyss.co.ke   # optional CDN front

# Resend (Atlas system emails — separate from org Resend keys)
RESEND_SYSTEM_KEY=re_<system-key>
RESEND_SYSTEM_FROM=Atlas <atlas-noreply@blyss.co.ke>

# Google OAuth (sign-in)
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=

# Observability
SENTRY_DSN=
SENTRY_AUTH_TOKEN=
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com

# Backups
R2_BACKUP_BUCKET=atlas-backups
R2_BACKUP_KEY=<separate-from-master-key>
```

### Env validation

`lib/env.ts` parses all env vars at boot via Zod. App refuses to start with missing or malformed values. Reduces surprise in production.

### Cloudflare tunnel (for `<port>.blyss.co.ke` preview)

Install once on the code-server VM:

```bash
# Add Cloudflare tunnel binary
sudo cloudflared service install <tunnel-token>
```

Configure the tunnel route to send `*.blyss.co.ke` (or specific subdomain) traffic to `localhost:3000`. Already in place per the user's note.

## CI / CD pipeline (GitHub Actions)

`.github/workflows/ci.yml`:

```yaml
name: CI
on: { pull_request: {}, push: { branches: [main] } }
jobs:
  install-and-cache:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'npm' }
      - run: npm ci

  type-check:
    needs: install-and-cache
    steps:
      - run: npm run type-check

  lint:
    needs: install-and-cache
    steps:
      - run: npm run lint

  unit-test:
    needs: install-and-cache
    steps:
      - run: npm run test

  e2e:
    needs: install-and-cache
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: postgres }
        ports: [5432:5432]
    steps:
      - run: npm run db:migrate:test
      - run: npx playwright install --with-deps
      - run: npm run test:e2e

  lighthouse:
    needs: install-and-cache
    steps:
      - run: npm run build
      - run: npm run start &
      - run: npx wait-on http://localhost:3000
      - run: npx lhci autorun --collect.url=http://localhost:3000
        env: { LHCI_TOKEN: ${{ secrets.LHCI_TOKEN }} }

  audit:
    needs: install-and-cache
    steps:
      - run: npm audit --audit-level=high
```

`.github/workflows/deploy-prod.yml` — manual trigger only. Runs migrations against prod DB before deploying. Slack/email notification on success/failure.

## Database migrations

- Drizzle Kit `generate` produces `db/migrations/*.sql`
- Migrations committed to git
- `db:migrate:dev` — applies to dev branch
- `db:migrate:staging` — applies to staging on every `main` push
- `db:migrate:prod` — manual approval required (via GitHub Actions workflow_dispatch)
- Migrations are never edited once committed — only additive new ones

## Worker process

pg-boss workers run as a separate Node process. In production:

- **On Vercel:** runs as a "background function" or external service (Vercel Functions don't keep alive). For v1, simplest: run worker on a Hetzner VPS (€4.51/mo) connected to the same Neon DB.
- **Alternative:** Cloudflare Workers Cron triggers + Cloudflare Queues — more complex, post-Phase-11.

Worker script `worker.ts`:

```ts
import { PgBoss } from 'pg-boss';
import { handlers } from '@/lib/jobs/handlers';

const boss = new PgBoss(process.env.DATABASE_URL_UNPOOLED);
await boss.start();

for (const [name, handler] of Object.entries(handlers)) {
  await boss.work(name, { teamSize: 5 }, handler);
}

console.log('Atlas worker running');
```

Health-checked by an external uptime monitor (BetterStack free).

## Seeds

`db:seed` creates the initial data needed for Atlas to feel right on first launch:

- One organization `Blyss`
- One user `justine@blyss.co.ke` as Org Owner (password set via env or first login)
- Three workspaces: `Omnix`, `Marketplace`, `Studio`
- Pre-seeded pipelines for each workspace with ship default stages
- Pre-seeded AI model registry (the table in `08-ai-gateway.md`)
- Pre-seeded ai_feature_bindings with ship defaults
- Empty integration keys list (Justine fills in via Settings)
- Sample notification preferences

Seeds are idempotent — safe to re-run.

## Backups

- Neon native PITR — 6h on Free, 7d on Launch
- Weekly logical dump via cron job (in worker process):
  ```
  pg_dump $DATABASE_URL_UNPOOLED | gzip | encrypt-with($R2_BACKUP_KEY) | upload-to-r2
  ```
- Backup retention: 12 weekly + 12 monthly
- Restore tested quarterly (operator playbook in `/ops/restore.md`)

## Monitoring

- **Sentry** for errors + slow transactions
- **PostHog** for product analytics
- **BetterStack** (or cron-job.org) for uptime checks on `/api/health`
- **Vercel Speed Insights** for real-user metrics
- Cron monitor on the worker (heartbeat every 5 min to BetterStack)

## DocuSeal hosting

DocuSeal runs separately. Two options:

**Option A — same Hetzner VPS as the pg-boss worker:**

```bash
# docker-compose.yml on the VPS
services:
  docuseal:
    image: docuseal/docuseal:latest
    ports: ['3001:3000']
    environment:
      DATABASE_URL: <its own Postgres DB or shared schema>
      HOST: docuseal.blyss.co.ke
    volumes:
      - docuseal-data:/data/uploads
```

Cloudflare DNS `docuseal.blyss.co.ke` → VPS IP (proxied). Org Owner adds DocuSeal URL + API token in `Settings → Integrations → DocuSeal`.

**Option B — Sliplane / Railway** managed hosting if VPS is too much.

## Domain + email setup

- `atlas.blyss.co.ke` — Cloudflare DNS, A/CNAME to Vercel
- `mail.blyss.co.ke` — SPF + DKIM + DMARC records for Resend
- `wa.blyss.co.ke` — optional vanity hostname (not strictly needed)
- DKIM record from Resend dashboard
- DMARC: `v=DMARC1; p=quarantine; rua=mailto:dmarc@blyss.co.ke`

## Rollback procedure

1. Vercel: instant revert via dashboard (one click to previous deploy)
2. Database migrations are forward-only — rollback means writing a new "down" migration; never edit history
3. If a migration corrupts data: restore from Neon PITR to a new branch, run a `db:diff-and-recover` script (manual)

## Deploy checklist (per release)

- [ ] All CI green
- [ ] Migrations reviewed
- [ ] Lighthouse CI gate passed
- [ ] Sentry release tagged
- [ ] Changelog updated in `CHANGELOG.md`
- [ ] Staging smoke test passed
- [ ] Prod deploy approved by operator
- [ ] Worker process redeployed (if jobs changed)
- [ ] Post-deploy: check `/admin/health` for 10 min
