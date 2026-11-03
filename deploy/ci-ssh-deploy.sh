#!/usr/bin/env bash
# Called by .github/workflows/deploy.yml: ship the deploy files to the VM and run deploy.sh there.
# Env: HOST USER SSH_KEY KNOWN_HOSTS TAG GHCR_TOKEN (and GITHUB_ACTOR from Actions).
# The VM keeps its own secrets (env/*.env, .env); only these tracked files are overwritten.
set -euo pipefail
: "${HOST:?}" "${USER:?}" "${SSH_KEY:?}" "${KNOWN_HOSTS:?}" "${TAG:?}" "${GHCR_TOKEN:?}"

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
printf '%s\n' "$SSH_KEY" >"$dir/key" && chmod 600 "$dir/key"
printf '%s\n' "$KNOWN_HOSTS" >"$dir/known_hosts"
ssh_opts=(-i "$dir/key" -o UserKnownHostsFile="$dir/known_hosts" -o StrictHostKeyChecking=yes)

cd "$(dirname "$0")"
scp "${ssh_opts[@]}" docker-compose.prod.yml Caddyfile deploy.sh backup.sh restore.sh \
  "$USER@$HOST:/opt/rotationlab/"

# the token only lives for this job; it is piped, never put on a command line
printf '%s' "$GHCR_TOKEN" | ssh "${ssh_opts[@]}" "$USER@$HOST" \
  "docker login ghcr.io -u '${GITHUB_ACTOR:-ci}' --password-stdin >/dev/null && \
   cd /opt/rotationlab && chmod +x deploy.sh backup.sh restore.sh && ./deploy.sh '$TAG'"
