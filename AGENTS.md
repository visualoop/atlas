<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:deployment-rules -->
# Deployment rules — READ FIRST

This VPS is a **development environment**, not production.

- `https://3220.blyss.co.ke` — dev Convex backend running on this VPS
- `https://3221.blyss.co.ke` — dev Convex HTTP-actions endpoint on this VPS
- `https://3222.blyss.co.ke` — dev Convex dashboard on this VPS

**Production runs on Kubernetes on a different server.** Never deploy from here.

## What you MUST NOT do

- **Never run `npx convex deploy`** — that pushes functions to the dev instance running on this VPS. The user does not want changes shipped that way anymore.
- **Never run `vercel --prod`** — production Vercel deployments happen via GitHub Actions when the frontend rebuilds after a push.
- **Never run `vercel env add`** or `vercel env rm` — production env is managed elsewhere.
- Never invoke `curl` against `3220.blyss.co.ke` / `3221.blyss.co.ke` and treat it as production behavior.

## What you SHOULD do

- Make code changes locally in `/home/ubuntu/workspace/atlas`.
- Run `npm run build` + `npx convex codegen --typecheck disable` to verify the code compiles.
- `git add`, `git commit`, `git push` to `visualoop/atlas` main.
- **The GitHub Actions workflows handle the rest**:
  - `.github/workflows/deploy-atlas.yml` — deploys Convex functions to the k3s prod cluster (`api.atlas.blyss.co.ke` + `actions.atlas.blyss.co.ke`)
  - Vercel picks up frontend commits automatically and deploys to `atlas.blyss.co.ke`
- If a workflow needs changes (new secret, new step, new provider), edit `.github/workflows/*.yml` and push — don't try to substitute manual runs.

## Verification pattern

Instead of running `npx convex deploy` yourself:

1. Push to GitHub.
2. Poll workflow status via `gh run list --workflow=deploy-atlas.yml --limit 3`.
3. If failing, `gh run view <run-id> --log-failed | tail -60` to see the error.
4. Fix in a follow-up commit + push again.

Never mutate the dev VPS deploy target as a shortcut. If you're tempted to, stop and push instead.

## When code checks are enough

For small non-behavior-changing fixes (typos, UI tweaks), it is enough to:
- Run `npm run build` locally to catch TypeScript errors
- Run `npx convex codegen --typecheck disable` if Convex code changed
- Commit + push
- Let CI verify the rest
<!-- END:deployment-rules -->

