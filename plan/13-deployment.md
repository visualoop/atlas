# 13 · Deployment

## Environments

| Env | Frontend | Convex backend | Notes |
|---|---|---|---|
| Local | `http://localhost:3010` or `https://3010.blyss.co.ke` | Docker via `docker-compose.yml` (ports 3220/3221/6791) | Active dev loop |
| Staging | `staging.atlas.blyss.co.ke` (Vercel preview) | Same self-hosted k3s backend (separate Convex env vars + DB branch) | Pre-prod verification |
| Production | `atlas.blyss.co.ke` (Vercel) | k3s namespace `atlas` on Oracle Cloud | – |

## Hosting

- **Frontend** → Vercel via `visualoop` GitHub account / team `daily-cutlines-projects`. Vercel CLI logged in.
- **Backend** → self-hosted Convex on the existing k3s cluster at `130.162.184.133` (Oracle Cloud, Always Free ARM).
- **DocuSeal** (e-signature, Phase 7a) → same k3s cluster, separate namespace or alongside Atlas.

## Cluster resource allocation

The cluster ceiling is 24 GB RAM / 195 GB storage. Atlas joins by trimming existing namespaces:

| Namespace | RAM (was → is) | Storage (was → is) |
|---|---|---|
| blyss | 12 → **10.5 GB** | 90 → **82 GB** |
| olestones | 3 → **3 GB** | 40 → **38 GB** |
| chapaswali | 5 → **4.5 GB** | 20 → **20 GB** |
| monitoring | 2.5 → **2 GB** | 30 → **28 GB** |
| **atlas (new)** | — → **2.5 GB** | — → **15 GB** |
| **System reserve** | — | **12 GB** |
| **Total** | **24 GB ✓** | **195 GB ✓** |

`infra/quotas/resource-quotas.yaml` (in the shared infra repo) updated accordingly.

## DNS (Cloudflare)

A records, DNS-only at first for Let's Encrypt issuance, then can flip to proxied:

| Subdomain | Target | Notes |
|---|---|---|
| `atlas.blyss.co.ke` | Vercel | Frontend |
| `api.atlas.blyss.co.ke` | `130.162.184.133` | Convex API + WebSocket |
| `actions.atlas.blyss.co.ke` | `130.162.184.133` | Convex HTTP actions (webhooks) |
| `convex.atlas.blyss.co.ke` | `130.162.184.133` | Convex dashboard (IP-allowlisted) |
| `pay.atlas.blyss.co.ke` | Vercel | Branded payment short links |
| `book.atlas.blyss.co.ke` | Vercel | Public booking pages |

Cloudflare API token already in operator env as `CLOUDFLARE_API_TOKEN`, zone ID for `blyss.co.ke` is `c1eaaa292b9dddcb67f9592bb5bc1948`. Records can be scripted with curl or `gcloud`/`gws` if needed.

## Local development setup

### Prereqs

- Node 20 LTS, npm
- Docker + docker-compose
- Git
- Cloudflare tunnel running, routing `<port>.blyss.co.ke` → `localhost:<port>`

### First-time setup

```bash
git clone <repo>
cd atlas
npm install

# Copy env template, fill in the bootstrap values
cp .env.example .env.local
# Generate CONVEX_INSTANCE_SECRET — already in .env.local for committed dev backend
# openssl rand -hex 32

# Start Convex backend
docker compose --env-file .env.local up -d

# Generate admin key (once)
docker exec atlas-convex-backend ./generate_admin_key.sh
# Paste output into .env.local as CONVEX_SELF_HOSTED_ADMIN_KEY

# Set Convex env vars (JWT keys, JWKS, CONFIG_ENCRYPTION_KEY, SITE_URL)
# See scripts/bootstrap-convex-env.sh (Phase 0 follow-up)

# Push functions to local backend
npm run dev:convex   # in one terminal

# Run Next.js
npm run dev:next     # in another terminal
```

Visit `https://3010.blyss.co.ke` for the app, `https://6791.blyss.co.ke` for the Convex dashboard.

### `.env.local` (gitignored)

```bash
NEXT_PUBLIC_APP_URL=http://localhost:3010
NEXT_PUBLIC_CONVEX_URL=https://3220.blyss.co.ke
NEXT_PUBLIC_CONVEX_PUBLIC_URL=https://3220.blyss.co.ke
NEXT_PUBLIC_CONVEX_SITE_URL=https://3221.blyss.co.ke

CONVEX_INSTANCE_SECRET=<from openssl rand -hex 32>
CONVEX_SELF_HOSTED_URL=https://3220.blyss.co.ke
CONVEX_SELF_HOSTED_ADMIN_KEY=<from generate_admin_key.sh>

# Optional observability — fill in later
SENTRY_DSN=
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com
```

### Tier-0 Convex env vars (set inside Convex, not `.env.local`)

```bash
export CONVEX_SELF_HOSTED_URL=https://3220.blyss.co.ke
export CONVEX_SELF_HOSTED_ADMIN_KEY=<admin key>

npx convex env set SITE_URL http://localhost:3010
npx convex env set JWT_PRIVATE_KEY --from-file /tmp/atlas-priv.pem
npx convex env set JWKS --from-file /tmp/atlas-jwks.json
npx convex env set CONFIG_ENCRYPTION_KEY "<base64 32-byte key>"
```

`scripts/bootstrap-convex-env.sh` automates this.

## k3s production deploy

### Manifests (in `infra/atlas/`)

```
infra/atlas/
  README.md
  01-convex-backend.yaml      Deployment + PVC (15 Gi data) + 2 Services
  02-convex-dashboard.yaml    Dashboard Deployment + Service
  03-ingress.yaml             3 Traefik ingresses + TLS + dashboard IP-allowlist
  04-backup-cronjob.yaml      Daily convex export → backup PVC (keeps 14)
  VERCEL.md                   Vercel env var wiring for the Next.js side
```

### GitHub Actions workflow

`.github/workflows/deploy-atlas.yml` mirrors `infra/workflows/deploy-chapaswali.yml`:

**Job 1 — infra**: copies manifests to server via SCP, applies via SSH+kubectl, injects `CONVEX_INSTANCE_SECRET_ATLAS` + `CONVEX_SELF_HOSTED_ADMIN_KEY_ATLAS` as k8s Secrets, waits for rollout.

**Job 2 — functions**: (gated on admin key existing) `npx convex deploy` against `https://api.atlas.blyss.co.ke` with the admin key.

### GitHub secrets needed

| Secret | Source |
|---|---|
| `SERVER_IP` | Already set (`130.162.184.133`) |
| `SSH_PRIVATE_KEY` | Already set |
| `CONVEX_INSTANCE_SECRET_ATLAS` | `openssl rand -hex 32` |
| `CONVEX_SELF_HOSTED_ADMIN_KEY_ATLAS` | Generated from backend after first deploy |
| `VERCEL_TOKEN` | Vercel CLI token for production deploys |
| `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` | Vercel project linking |

### First-deploy procedure

1. **DNS first**: create the 4 A records (api/actions/convex/pay/book).
2. **Add `CONVEX_INSTANCE_SECRET_ATLAS`** GitHub secret.
3. **Copy workflow** into `.github/workflows/deploy-atlas.yml` and push.
4. **Infra job runs**, backend pod boots. Functions job skipped (no admin key yet).
5. **Generate admin key** once:
   ```bash
   sudo kubectl -n atlas exec deploy/convex-backend -- ./generate_admin_key.sh
   ```
6. Add the result as `CONVEX_SELF_HOSTED_ADMIN_KEY_ATLAS` GitHub secret.
7. **Re-run workflow**. Functions job runs `npx convex deploy`.
8. **Set Convex env vars on production** (Tier-0):
   ```bash
   export CONVEX_SELF_HOSTED_URL=https://api.atlas.blyss.co.ke
   export CONVEX_SELF_HOSTED_ADMIN_KEY=<key>
   npx convex env set SITE_URL https://atlas.blyss.co.ke
   npx convex env set JWT_PRIVATE_KEY --from-file priv.pem
   npx convex env set JWKS --from-file jwks.json
   npx convex env set CONFIG_ENCRYPTION_KEY "<base64>"
   ```
9. **Wire Vercel**:
   ```
   vercel env add NEXT_PUBLIC_CONVEX_URL production       # https://api.atlas.blyss.co.ke
   vercel env add NEXT_PUBLIC_CONVEX_PUBLIC_URL production # https://api.atlas.blyss.co.ke
   vercel env add NEXT_PUBLIC_CONVEX_SITE_URL production   # https://actions.atlas.blyss.co.ke
   vercel env add NEXT_PUBLIC_APP_URL production           # https://atlas.blyss.co.ke
   vercel deploy --prod
   ```
10. **Smoke test**: load `https://atlas.blyss.co.ke`, sign up, verify Convex sync works.

### Webhook callback wiring

For Paystack / Resend inbound / Meta WhatsApp / DocuSeal, the callback URL base is `https://actions.atlas.blyss.co.ke`:

- Paystack: register `https://actions.atlas.blyss.co.ke/paystack/webhook` in Paystack dashboard
- Resend Inbound: configure inbound webhook URL in Resend dashboard
- Meta WhatsApp: register `https://actions.atlas.blyss.co.ke/whatsapp/webhook`
- DocuSeal: configure webhook URL in DocuSeal admin

## Backups

- Daily `convex export` at 02:30 UTC via k8s CronJob → backup PVC, keep last 14 (per `infra/atlas/04-backup-cronjob.yaml`)
- Verify with `kubectl -n atlas exec deploy/convex-backend -- ls -lh /backups`
- Restore:
  ```bash
  CONVEX_SELF_HOSTED_URL=https://api.atlas.blyss.co.ke \
  CONVEX_SELF_HOSTED_ADMIN_KEY=<key> \
  npx convex import --replace /path/to/atlas-YYYYMMDD-HHMMSS.zip
  ```
- Off-site (future): rclone snapshot → R2 with separate encryption key

## CI

`.github/workflows/ci.yml` on every PR:

- `npm ci`
- `npm run type-check`
- `npm run lint`
- `npm run build` (Next.js)
- `npx convex deploy --dry-run` (validates schema diff)
- `vitest run` (unit + integration via `convex-test`)
- Playwright E2E against a preview deploy
- Lighthouse CI on public routes

## Rollback procedure

1. **Frontend** (Vercel): instant revert via dashboard (one click to previous deploy)
2. **Convex schema/functions**: deploy the previous commit. Convex retains migration history; backwards-compatible additive changes roll back cleanly. Renames/removals require a re-add migration.
3. **Data corruption**: restore from latest `convex export` to a clean namespace, verify, swap DNS

## Deploy checklist (per release)

- [ ] All CI green
- [ ] Convex schema diff reviewed
- [ ] Lighthouse CI gate passed
- [ ] Sentry release tagged
- [ ] `CHANGELOG.md` updated
- [ ] Staging smoke test passed
- [ ] Prod deploy approved by operator
- [ ] Post-deploy: `/admin/health` for 10 min, check Convex dashboard logs

## Operator runbook

`ops/runbook.md` (Phase 11) covers:

- Incident response steps
- Master key rotation
- Restoring from backup
- Re-issuing admin keys
- Scaling the backend (single-writer caveat — SQLite RWO; do not scale replicas without moving to Postgres backend)
- Adding a new workspace member with full audit trail
- Quarterly key rotation playbook (Paystack, Resend, AI providers)
