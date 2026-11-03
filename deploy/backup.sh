#!/usr/bin/env bash
# Nightly encrypted Postgres backup (DEPLOYMENT §7, SECURITY §7). Host cron, as the deploy user:
#   15 3 * * *  cd /opt/rotationlab && ./backup.sh >> backups/backup.log 2>&1
#
# pg_dump -Fc inside the postgres container → age-encrypted to AGE_RECIPIENT (public key only on
# the VM; the private key lives offline) → backups/ → rclone to RCLONE_REMOTE (R2 bucket with its
# own credentials). Retention: 14 daily + 8 weekly (Sunday) remotely, 3 days locally.
#
# .env: AGE_RECIPIENT=age1…  RCLONE_REMOTE=r2:rotationlab-backups  (empty → local copy only)
# Overrides for a local rehearsal: COMPOSE_PROJECT, AGE (e.g. a docker wrapper).
set -euo pipefail

DIR=${DEPLOY_DIR:-$(cd "$(dirname "$0")" && pwd)}
cd "$DIR"
[ -f .env ] && . ./.env
: "${AGE_RECIPIENT:?AGE_RECIPIENT (age public key) must be set}"
AGE=${AGE:-age}
COMPOSE="docker compose -f docker-compose.prod.yml"
[ -n "${COMPOSE_PROJECT:-}" ] && COMPOSE="docker compose -p $COMPOSE_PROJECT -f docker-compose.prod.yml"
export TAG=${TAG:-$(cat .last_tag 2>/dev/null || echo unused)}

mkdir -p backups
STAMP=$(date -u +%Y%m%d-%H%M%S)
OUT="backups/rotationlab-$STAMP.dump.age"
trap 'rm -f "$OUT.part"' EXIT

# the dump never touches the disk unencrypted
$COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' |
  $AGE -r "$AGE_RECIPIENT" >"$OUT.part"
mv "$OUT.part" "$OUT"
[ -s "$OUT" ] || { echo "backup: empty dump" >&2; exit 1; }
echo "backup: wrote $OUT ($(wc -c <"$OUT") bytes)"

if [ -n "${RCLONE_REMOTE:-}" ]; then
  rclone copyto "$OUT" "$RCLONE_REMOTE/daily/$(basename "$OUT")"
  [ "$(date -u +%u)" = 7 ] && rclone copyto "$OUT" "$RCLONE_REMOTE/weekly/$(basename "$OUT")"
  rclone delete --min-age 14d "$RCLONE_REMOTE/daily"
  rclone delete --min-age 56d "$RCLONE_REMOTE/weekly"
  echo "backup: uploaded to $RCLONE_REMOTE"
fi
find backups -name 'rotationlab-*.dump.age' -mtime +3 -delete
