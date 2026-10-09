#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.19.0+ is required."
  exit 1
fi
node scripts/check-node.mjs

corepack enable >/dev/null 2>&1 || true
node scripts/bootstrap-gaga.mjs
pnpm install --no-frozen-lockfile

echo "Starting signaling worker on http://127.0.0.1:8787"
pnpm --filter @live-voice/signaling-worker dev -- --port 8787 &
WORKER_PID=$!
trap 'kill $WORKER_PID 2>/dev/null || true' EXIT

export PUBLIC_SIGNALING_URL="http://127.0.0.1:8787"
pnpm --filter @live-voice/web dev -- --host 0.0.0.0
