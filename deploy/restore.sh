#!/usr/bin/env bash
# Restore an encrypted backup (DEPLOYMENT §7). Default target is a scratch database, so this
# doubles as the monthly restore test; `--into rotationlab` overwrites the live database
# (stop `server` first, and only with a reason).
#
#   AGE_IDENTITY=~/rl-backup.key ./restore.sh backups/rotationlab-20261103-031500.dump.age
#   AGE_IDENTITY=… ./restore.sh <file> --into rotationlab
#
# Prints row counts of the main tables from the restored copy, then drops a scratch database.
set -euo pipefail

FILE=${1:?usage: restore.sh <backup.dump.age> [--into <database>]}
TARGET=rotationlab_restore_test
[ "${2:-}" = --into ] && TARGET=${3:?--into needs a database name}
: "${AGE_IDENTITY:?AGE_IDENTITY (path to the age private key) must be set}"

DIR=${DEPLOY_DIR:-$(cd "$(dirname "$0")" && pwd)}
cd "$DIR"
[ -f .env ] && . ./.env
AGE=${AGE:-age}
COMPOSE="docker compose -f docker-compose.prod.yml"
[ -n "${COMPOSE_PROJECT:-}" ] && COMPOSE="docker compose -p $COMPOSE_PROJECT -f docker-compose.prod.yml"
export TAG=${TAG:-$(cat .last_tag 2>/dev/null || echo unused)}
psql() { $COMPOSE exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d $1 -v ON_ERROR_STOP=1 -qtA -c \"$2\""; }

if [ "$TARGET" = rotationlab_restore_test ]; then
  psql postgres "DROP DATABASE IF EXISTS $TARGET"
  psql postgres "CREATE DATABASE $TARGET"
fi

$AGE -d -i "$AGE_IDENTITY" "$FILE" |
  $COMPOSE exec -T postgres sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $TARGET --clean --if-exists --no-owner --exit-on-error"

echo "restore: $FILE → $TARGET"
for t in users rooms boards elements chat_messages snapshots _prisma_migrations; do
  echo "  $t: $(psql "$TARGET" "SELECT count(*) FROM $t")"
done

if [ "$TARGET" = rotationlab_restore_test ]; then
  psql postgres "DROP DATABASE $TARGET"
  echo "restore: scratch database dropped — restore test passed"
fi
