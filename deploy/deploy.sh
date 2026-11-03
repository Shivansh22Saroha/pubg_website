#!/usr/bin/env bash
# Deploy one image tag to this VM, smoke-test it, roll back on failure (DEPLOYMENT §5).
#
#   ./deploy.sh sha-abc1234        # staging (from CI on push to main)
#   ./deploy.sh v1.0.0             # production (from CI on tag, after approval)
#
# Runs in the deploy directory (/opt/rotationlab), which holds docker-compose.prod.yml,
# Caddyfile, env/*.env and a `.env` with REGISTRY / APP_DOMAIN / ACME_EMAIL for compose.
# The last good tag is kept in .last_tag. Migrations are never rolled back: they are additive
# (expand / contract, DEPLOYMENT §7), so the previous release runs on the new schema.
#
# Env knobs (local rehearsal): COMPOSE_PROJECT (-p name), SKIP_PULL=1 (local images),
# CURL_INSECURE=1 (Caddy's internal CA on localhost), SMOKE_TIMEOUT (seconds, default 90).
set -euo pipefail

TAG=${1:?usage: deploy.sh <tag>}
DIR=${DEPLOY_DIR:-$(cd "$(dirname "$0")" && pwd)}
cd "$DIR"
[ -f .env ] && . ./.env
: "${APP_DOMAIN:?APP_DOMAIN must be set (in .env)}"

COMPOSE="docker compose -f docker-compose.prod.yml"
[ -n "${COMPOSE_PROJECT:-}" ] && COMPOSE="docker compose -p $COMPOSE_PROJECT -f docker-compose.prod.yml"
CURL="curl -fsS --max-time 5"
[ "${CURL_INSECURE:-0}" = 1 ] && CURL="$CURL -k"
BASE="https://$APP_DOMAIN"
PREV=$(cat .last_tag 2>/dev/null || true)

log() { printf '%s deploy: %s\n' "$(date -u +%H:%M:%S)" "$*"; }

# healthy = both containers report healthy, the API says ok through Caddy and a page renders
smoke() {
  deadline=$(($(date +%s) + ${SMOKE_TIMEOUT:-90}))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    states=$($COMPOSE ps --format '{{.Service}}={{.Health}}' web server | tr '\n' ' ')
    case "$states" in
      *server=healthy*web=healthy* | *web=healthy*server=healthy*)
        # no `curl | grep -q` under pipefail: grep exiting early can fail the pipe
        body=$($CURL "$BASE/api/health" || true)
        if [[ $body == *'"status":"ok"'* ]] && $CURL -o /dev/null "$BASE/login"; then
          return 0
        fi
        ;;
    esac
    sleep 3
  done
  log "smoke test failed (containers: ${states:-none})"
  return 1
}

up() {
  export TAG="$1"
  if [ "${SKIP_PULL:-0}" != 1 ]; then $COMPOSE pull --quiet web server migrate; fi
  $COMPOSE --profile migrate run --rm migrate
  $COMPOSE up -d --remove-orphans web server caddy
}

log "deploying $TAG (previous: ${PREV:-none})"
if up "$TAG" && smoke; then
  echo "$TAG" >.last_tag
  log "ok: $TAG is live"
  exit 0
fi

if [ -z "$PREV" ] || [ "$PREV" = "$TAG" ]; then
  log "FAILED and there is no previous tag to roll back to"
  exit 1
fi
log "rolling back to $PREV"
export TAG="$PREV"
$COMPOSE up -d --remove-orphans web server caddy
if smoke; then
  log "rolled back to $PREV; $1 is NOT live"
else
  log "ROLLBACK FAILED: $PREV is unhealthy too — investigate now"
fi
exit 1
