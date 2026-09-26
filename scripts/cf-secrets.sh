#!/usr/bin/env bash
# Push the server secrets from .env into the Cloudflare Worker.
# Terminal-only: each value is piped to wrangler on stdin, never typed or echoed.
#
#   ./scripts/cf-secrets.sh            # push to the default (production) environment
#   ./scripts/cf-secrets.sh --dry-run  # just list what would be pushed
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-.env}"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

[ -f "$ENV_FILE" ] || { echo "✘ $ENV_FILE not found."; exit 1; }

# Only these ever leave the machine. SUPABASE_ANON_KEY is deliberately excluded:
# the server never uses it, so there is no reason to store it in the Worker.
SECRETS=(
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  JWT_SECRET
  JWT_EXPIRE_HOURS
  ADMIN_EMAIL
  ADMIN_PASSWORD
  ADMIN_NAME
  GSTVERIFY_API_KEY
)

# Read a KEY=value from the env file without sourcing it (values may contain spaces).
read_val() {
  sed -n "s/^$1=//p" "$ENV_FILE" | head -n1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

for name in "${SECRETS[@]}"; do
  value="$(read_val "$name" || true)"
  if [ -z "$value" ]; then
    echo "· skip  $name (empty in $ENV_FILE)"
    continue
  fi
  if [ "$DRY_RUN" = "1" ]; then
    echo "· would push $name (${#value} chars)"
    continue
  fi
  printf '%s' "$value" | npx wrangler secret put "$name" >/dev/null 2>&1 \
    && echo "✔ pushed $name" \
    || { echo "✘ failed  $name"; exit 1; }
done

[ "$DRY_RUN" = "1" ] && echo "(dry run - nothing sent)" || echo "Done. Verify with: npx wrangler secret list"
