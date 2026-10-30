#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT=/opt/f1-companion
SEASON="${F1_SEASON:-$(date +%Y)}"

cd "$APP_ROOT/backend"
pnpm ingest:schedule -- "$SEASON"
pnpm ingest:results -- "$SEASON"
