#!/bin/sh
# Deploys web/ to Vercel production, CLI-only - never via Vercel's Git
# integration. Reason: the scan.yml scheduler bot commits to `main` every
# ~10 minutes as "centinela-bot"; Vercel Hobby's Git integration only
# auto-deploys commits from an account it recognizes as a collaborator, and
# would otherwise either skip those commits or (worse) queue a deploy storm.
# A CLI deploy only fires when this script runs, which is only when web/
# itself changed - the page doesn't need a redeploy when the data changes,
# since it fetches data/positions.json live from raw.githubusercontent.com
# at render time.
#
# Usage: ./scripts/deploy-vercel.sh   (run from the repo root)
set -eu

cd "$(dirname "$0")/.."

echo "==> vercel whoami (must be the account you intend to deploy as)"
vercel whoami

echo "==> building web/ for root-path hosting (Vercel serves from /, not /centinela/)"
(cd web && BASE_PATH=/ npm run build)

# Project name. "centinela" itself is a buildable Vercel project (it
# exists, under this same account), but its clean *.vercel.app alias
# turned out to already be claimed by an unrelated project (a different
# "Centinela" - an IoT fire-detection app), so Vercel auto-suffixed that
# project's production alias (centinela-vert.vercel.app) instead of giving
# it the bare name. "centinela-writz" was free and got the clean alias
# (centinela-writz.vercel.app) - that's the one actually linked from the
# README. Override with PROJECT_NAME=centinela to retry the bare name if
# you ever want to (e.g. if that other project's alias frees up).
PROJECT_NAME="${PROJECT_NAME:-centinela-writz}"

echo "==> linking web/dist to the Vercel project '$PROJECT_NAME'"
cd web/dist
rm -rf .vercel
vercel link --yes --project "$PROJECT_NAME"

echo "==> deploying to production"
vercel --prod --yes
