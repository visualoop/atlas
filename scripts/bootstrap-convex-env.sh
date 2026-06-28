#!/usr/bin/env bash
#
# scripts/bootstrap-convex-env.sh
#
# Generates and sets the Tier-0 Convex env vars Atlas needs:
#   SITE_URL                  Next.js app URL
#   JWT_PRIVATE_KEY           PKCS#8 PEM — signs Convex Auth sessions
#   JWKS                      Public key set for verification
#   CONFIG_ENCRYPTION_KEY     32-byte base64 — wraps Tier-1/2 secrets
#
# Usage:
#   export CONVEX_SELF_HOSTED_URL=https://3220.blyss.co.ke   (local)
#   export CONVEX_SELF_HOSTED_ADMIN_KEY=<admin key>
#   export NEXT_PUBLIC_APP_URL=http://localhost:3010         (or prod URL)
#
#   bash scripts/bootstrap-convex-env.sh
#
# Idempotent: re-running rotates the keys (you must coordinate
# CONFIG_ENCRYPTION_KEY rotation per plan/11-security.md before
# overwriting it in production).
set -euo pipefail

: "${CONVEX_SELF_HOSTED_URL:?Set CONVEX_SELF_HOSTED_URL}"
: "${CONVEX_SELF_HOSTED_ADMIN_KEY:?Set CONVEX_SELF_HOSTED_ADMIN_KEY}"
: "${NEXT_PUBLIC_APP_URL:?Set NEXT_PUBLIC_APP_URL}"

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

echo "==> Generating RS256 keypair + JWKS"
node -e "
const { generateKeyPair, exportJWK, exportPKCS8 } = require('jose');
(async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const pkcs8 = await exportPKCS8(privateKey);
  const publicJwk = await exportJWK(publicKey);
  const jwks = JSON.stringify({ keys: [{ ...publicJwk, use: 'sig', alg: 'RS256' }] });
  require('fs').writeFileSync('$WORKDIR/priv.pem', pkcs8);
  require('fs').writeFileSync('$WORKDIR/jwks.json', jwks);
})();
"

echo "==> Setting SITE_URL=${NEXT_PUBLIC_APP_URL}"
npx convex env set SITE_URL "$NEXT_PUBLIC_APP_URL"

echo "==> Setting JWT_PRIVATE_KEY"
npx convex env set JWT_PRIVATE_KEY --from-file "$WORKDIR/priv.pem"

echo "==> Setting JWKS"
npx convex env set JWKS --from-file "$WORKDIR/jwks.json"

echo "==> Setting CONFIG_ENCRYPTION_KEY (skip if already set in prod — see plan/11)"
if [ "${1:-}" = "--force-config-key" ] || ! npx convex env get CONFIG_ENCRYPTION_KEY >/dev/null 2>&1; then
  CONFIG_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
  npx convex env set CONFIG_ENCRYPTION_KEY "$CONFIG_KEY"
  echo "    (new key set; back it up — losing it bricks all Tier-1/2 secrets)"
else
  echo "    (already set; pass --force-config-key to rotate — see plan/11-security.md)"
fi

echo "==> Done. Env vars on $CONVEX_SELF_HOSTED_URL:"
npx convex env list | awk -F= '{print "    " $1}'
