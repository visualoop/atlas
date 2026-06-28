# Atlas — self-hosted Convex on k3s

Atlas's backend runs as **Convex, self-hosted** in the `atlas` namespace on the same k3s cluster as `blyss`, `olestones`, `chapaswali`. The Next.js frontend deploys to Vercel via the `visualoop` GitHub account, connecting to this backend over the public subdomains below.

Convex is the whole backend: database + server functions (everything in `convex/*.ts`). It stores its own data in an embedded SQLite DB on a Persistent Volume — no separate Postgres/MySQL needed.

## Architecture

```
 Vercel (Next.js UI)
     │  WebSocket + HTTPS
     ▼
 api.atlas.blyss.co.ke ─────► convex-backend :3210   (API / queries / mutations)
 actions.atlas.blyss.co.ke ─► convex-backend :3211   (HTTP actions + webhooks)
 convex.atlas.blyss.co.ke ──► convex-dashboard :6791 (admin UI, IP-allowlisted)
     │
     ▼
 SQLite on convex-data PVC (10Gi)
   + daily `convex export` → convex-backups PVC (5Gi, last 14 snapshots)
```

## Files (apply in order)

```
infra/atlas/
  01-convex-backend.yaml    Backend Deployment (3210+3211) + PVC (10Gi) + 2 Services
  02-convex-dashboard.yaml  Dashboard Deployment + Service
  03-ingress.yaml           3 ingresses + TLS + dashboard IP-allowlist
  04-backup-cronjob.yaml    Daily `convex export` (keeps 14)
.github/workflows/
  deploy-atlas.yml          The GitHub Actions deploy
```

## Resource footprint (within atlas 2.5Gi / 15Gi quota)

| Component | RAM limit | Storage |
|---|---|---|
| convex-backend | 1.8 Gi | 10 Gi (SQLite + files + indexes) |
| convex-dashboard | 384 Mi | — |
| backups (transient) | – | 5 Gi |
| **Total** | **~2.2 Gi** (≤ 2.5) | **15 Gi** (= quota) |

## DNS — needed before first deploy

Point these at the server `130.162.184.133` (A records, DNS-only at first so Let's Encrypt can validate; flip to proxied after certs issue):

| Record | Value |
|---|---|
| `api.atlas.blyss.co.ke` | `130.162.184.133` |
| `actions.atlas.blyss.co.ke` | `130.162.184.133` |
| `convex.atlas.blyss.co.ke` | `130.162.184.133` |

Can be scripted with the existing Cloudflare API token (`CLOUDFLARE_API_TOKEN` in operator env, zone `c1eaaa292b9dddcb67f9592bb5bc1948`):

```bash
CF="https://api.cloudflare.com/client/v4/zones/c1eaaa292b9dddcb67f9592bb5bc1948"
for sub in api actions convex; do
  curl -s -X POST "$CF/dns_records" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"A\",\"name\":\"${sub}.atlas\",\"content\":\"130.162.184.133\",\"proxied\":false}"
done
```

## Required GitHub secrets

| Secret | Status | How to get it |
|---|---|---|
| `SERVER_IP` | ✅ set | `130.162.184.133` |
| `SSH_PRIVATE_KEY` | ✅ set | server SSH key |
| `CONVEX_INSTANCE_SECRET_ATLAS` | ⬜ add | `openssl rand -hex 32` |
| `CONVEX_SELF_HOSTED_ADMIN_KEY_ATLAS` | ⬜ add **after** first deploy | generated from backend |
| `VERCEL_TOKEN` | ⬜ add | `vercel tokens create atlas-deploy` |
| `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` | ⬜ add | from Vercel project settings |

## Deploy procedure

### 1. Update shared cluster quotas

Edit `infra/quotas/resource-quotas.yaml` in the shared infra repo (cluster owner controls) to reduce blyss/monitoring/chapaswali and add the `atlas` namespace + ResourceQuota. The full delta is in `plan/13-deployment.md`. Apply via the shared infra workflow.

### 2. Create the 3 DNS records

Curl snippet above.

### 3. Add `CONVEX_INSTANCE_SECRET_ATLAS` to GitHub secrets

```bash
openssl rand -hex 32   # paste as the secret value
```

### 4. Push the workflow + manifests

```bash
git add .github/workflows/deploy-atlas.yml infra/atlas/
git commit -m "atlas: self-hosted Convex deploy"
git push
```

The **infra** job deploys the backend; the **functions** job is skipped on this first run (no admin key yet).

### 5. Generate the admin key (one-time)

```bash
sudo kubectl -n atlas exec deploy/convex-backend -- ./generate_admin_key.sh
```

Copy the key, add as `CONVEX_SELF_HOSTED_ADMIN_KEY_ATLAS` GitHub secret.

### 6. Set Convex env vars on production

```bash
export CONVEX_SELF_HOSTED_URL=https://api.atlas.blyss.co.ke
export CONVEX_SELF_HOSTED_ADMIN_KEY=<key>

npx convex env set SITE_URL https://atlas.blyss.co.ke
npx convex env set JWT_PRIVATE_KEY --from-file priv.pem
npx convex env set JWKS --from-file jwks.json
npx convex env set CONFIG_ENCRYPTION_KEY "$(openssl rand -base64 32)"
```

Generate `priv.pem` and `jwks.json` with `scripts/bootstrap-convex-env.sh`.

### 7. Re-run the workflow

Now the **functions** job runs `npx convex deploy` and pushes all of `convex/*.ts` to the backend.

### 8. Wire Vercel

See `VERCEL.md` in this directory.

## Webhook callbacks

The `actions.atlas.blyss.co.ke` subdomain is where third-party services POST:

- **Paystack** — register in Paystack dashboard: `https://actions.atlas.blyss.co.ke/paystack/webhook`
- **Resend Inbound** — configure in Resend dashboard
- **Meta WhatsApp** — register `https://actions.atlas.blyss.co.ke/whatsapp/webhook` in Meta App
- **DocuSeal** — configure webhook URL in DocuSeal admin

If any of these isn't public + HTTPS, callbacks fail.

## Backups & restore

- Daily `convex export` at 02:30 UTC → `convex-backups` PVC, keeps last 14
- List: `kubectl -n atlas exec deploy/convex-backend -- ls -lh /backups`
- Restore:
  ```bash
  CONVEX_SELF_HOSTED_URL=https://api.atlas.blyss.co.ke \
  CONVEX_SELF_HOSTED_ADMIN_KEY=<key> \
  npx convex import --replace /path/to/atlas-YYYYMMDD-HHMMSS.zip
  ```

## Security notes

- **Dashboard (`convex.atlas.blyss.co.ke`) is admin-level.** The ingress has an IP-allowlist middleware but defaults to `0.0.0.0/0` (placeholder). **Set your real IP** in `03-ingress.yaml` (`atlas-dashboard-ipallow`) before exposing it.
- **Tier-0 secrets** (`CONFIG_ENCRYPTION_KEY`, `JWT_PRIVATE_KEY`) live in Convex env (set via `npx convex env set`), not in the cluster manifests.
- **Tier-1/2 secrets** live encrypted inside the Convex DB (`orgIntegrationKeys`, `userPersonalKeys`). The instance secret + admin key are k8s Secrets, injected from GitHub secrets by the workflow.
- `api`/`actions` are public by necessity (frontend + webhooks). The backend authenticates requests; the admin key is never exposed to clients.

## Single-writer caveat

The backend uses SQLite on one ReadWriteOnce volume, so it runs as a single replica with `Recreate` strategy. **Do not scale `convex-backend` to >1 replica without first switching to Convex's Postgres/MySQL storage backend.**
