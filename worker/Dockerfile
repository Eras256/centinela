# The originally-specified deploy target for the scanner: a small
# always-on Fly app (shared-cpu-1x, 256MB) that scans every 5 minutes and
# pushes to this repo. NOT deployed or verified this session - `fly auth
# whoami` had no stored login, and the sandbox would not let the agent
# read or export a token to work around that. `.github/workflows/scan.yml`
# is the substitute that actually ran. See README "Honest limits" and
# REPORT.md for exactly what a human needs to do to switch to this instead.
FROM node:22-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src
RUN npm install --no-save typescript@5.7.3 && npx tsc -p tsconfig.json && npm uninstall typescript

COPY worker/loop.sh ./worker/loop.sh
RUN chmod +x ./worker/loop.sh

ENV CENTINELA_DATA_DIR=/app/data
ENTRYPOINT ["/app/worker/loop.sh"]
