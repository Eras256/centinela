#!/bin/sh
# Scans every 5 minutes and pushes any data change to the repo this
# container was built from. Expects the repo to already be cloned at
# /app (the Docker build context) and a deploy key or PAT wired in via
# Fly secrets (GIT_ASKPASS / SSH key - not configured by this build; a
# human must add it). See README "Honest limits".
set -eu

cd /app

while true; do
  echo "[centinela] scanning at $(date -u -Iseconds)"
  if node dist/cli.js; then
    if ! git diff --quiet -- data/positions.json data/history.json data/topics.json; then
      git add data/positions.json data/history.json data/topics.json
      git -c user.name="centinela-bot" -c user.email="219895655+Eras256@users.noreply.github.com" \
        commit -m "scan: update positions ($(date -u -Iseconds))"
      git push
    fi
  else
    echo "[centinela] scan failed, will retry next cycle" >&2
  fi
  sleep 300
done
