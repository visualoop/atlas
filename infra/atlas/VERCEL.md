# Vercel wiring — Atlas Next.js frontend

The frontend deploys to Vercel via the `visualoop` GitHub account / `daily-cutlines-projects` team. Backend is self-hosted Convex at `https://api.atlas.blyss.co.ke`.

## One-time link

```bash
cd atlas
vercel link --yes --project atlas
# pick team: daily-cutlines-projects
```

## Production env vars

```bash
# Frontend → Convex backend
vercel env add NEXT_PUBLIC_CONVEX_URL production <<< "https://api.atlas.blyss.co.ke"
vercel env add NEXT_PUBLIC_CONVEX_PUBLIC_URL production <<< "https://api.atlas.blyss.co.ke"
vercel env add NEXT_PUBLIC_CONVEX_SITE_URL production <<< "https://actions.atlas.blyss.co.ke"
vercel env add NEXT_PUBLIC_APP_URL production <<< "https://atlas.blyss.co.ke"

# Optional observability
# vercel env add SENTRY_DSN production <<< "..."
# vercel env add NEXT_PUBLIC_POSTHOG_KEY production <<< "..."

# Verify
vercel env ls
```

## Preview env vars

Mirror production env vars to `preview` so PR previews work. (Atlas previews talk to the same Convex backend — no separate preview deployment yet. If we add one, the preview env points at a separate Convex instance.)

```bash
vercel env add NEXT_PUBLIC_CONVEX_URL preview <<< "https://api.atlas.blyss.co.ke"
vercel env add NEXT_PUBLIC_CONVEX_PUBLIC_URL preview <<< "https://api.atlas.blyss.co.ke"
vercel env add NEXT_PUBLIC_CONVEX_SITE_URL preview <<< "https://actions.atlas.blyss.co.ke"
vercel env add NEXT_PUBLIC_APP_URL preview <<< "https://staging.atlas.blyss.co.ke"
```

## Domain

```bash
vercel domains add atlas.blyss.co.ke
# Cloudflare will need CNAME atlas.blyss.co.ke → cname.vercel-dns.com
# (Vercel prints the exact value after you run the above)
```

## First production deploy

```bash
vercel deploy --prod
```

## CI deploy (via GitHub Actions)

`.github/workflows/deploy-atlas.yml` calls `npx vercel deploy --prod --token=$VERCEL_TOKEN` with `VERCEL_ORG_ID` + `VERCEL_PROJECT_ID` env. GitHub secrets needed:

| Secret | How to get it |
|---|---|
| `VERCEL_TOKEN` | `vercel tokens create atlas-deploy` |
| `VERCEL_ORG_ID` | from `.vercel/project.json` after linking |
| `VERCEL_PROJECT_ID` | from `.vercel/project.json` |

## Cache headers (already in `next.config.ts`)

Atlas serves through Cloudflare. The CDN-Cache-Control headers on static assets + sitemaps are set in `next.config.ts`. No `vercel.json` needed because Next 16 + the locked headers config handle it.

## SEO + analytics

Deferred — see `plan/12-performance.md` for performance targets. GA4 / Search Console wiring follows the team's standard SEO playbook when we're ready to surface Atlas externally (it's internal-only for the foreseeable future).
