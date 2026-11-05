#!/bin/sh
# Container start for hosts without a pre-deploy step (Render free, DEPLOYMENT §10):
# apply pending migrations, then hand the process over to the API.
# A plain script because Render runs `dockerCommand` without a shell (no quoting, no &&).
set -e
echo "start: applying database migrations"
./node_modules/.bin/prisma migrate deploy
echo "start: launching API"
exec node dist/index.js
