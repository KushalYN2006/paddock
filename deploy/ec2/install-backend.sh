#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

APP_ROOT=/opt/f1-companion
ENV_FILE=/etc/f1-companion/backend.env
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Create $ENV_FILE from deploy/ec2/backend.env.example first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
: "${DATABASE_URL:?DATABASE_URL must be set in $ENV_FILE}"
: "${F1_SEASON:?F1_SEASON must be set in $ENV_FILE}"

dnf update -y
dnf install -y nodejs24
npm install --global pnpm@10

if ! id f1companion >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/f1-companion --shell /sbin/nologin f1companion
fi
install -d -o f1companion -g f1companion -m 0750 /var/lib/f1-companion
chown -R f1companion:f1companion "$APP_ROOT"
chmod 0750 "$APP_ROOT/deploy/ec2/refresh-data.sh"

runuser -u f1companion -- env HOME=/var/lib/f1-companion DATABASE_URL="$DATABASE_URL" bash -lc "cd '$APP_ROOT/backend' && pnpm install --frozen-lockfile && pnpm exec prisma generate && pnpm exec prisma migrate deploy && pnpm build"
runuser -u f1companion -- env HOME=/var/lib/f1-companion DATABASE_URL="$DATABASE_URL" F1_SEASON="$F1_SEASON" bash -lc "cd '$APP_ROOT/backend' && pnpm ingest:schedule -- '$F1_SEASON'"
if ! runuser -u f1companion -- env HOME=/var/lib/f1-companion DATABASE_URL="$DATABASE_URL" F1_SEASON="$F1_SEASON" bash -lc "cd '$APP_ROOT/backend' && pnpm ingest:results -- '$F1_SEASON'"; then
  echo "Initial result import did not complete. The API will start; its status endpoint will report missing or stale data." >&2
fi

install -o root -g root -m 0644 "$APP_ROOT/deploy/ec2/f1-companion-backend.service" /etc/systemd/system/f1-companion-backend.service
install -o root -g root -m 0644 "$APP_ROOT/deploy/ec2/f1-companion-refresh.service" /etc/systemd/system/f1-companion-refresh.service
install -o root -g root -m 0644 "$APP_ROOT/deploy/ec2/f1-companion-refresh.timer" /etc/systemd/system/f1-companion-refresh.timer
systemctl daemon-reload
systemctl enable --now f1-companion-backend.service f1-companion-refresh.timer
systemctl restart f1-companion-backend.service
systemctl --no-pager --full status f1-companion-backend.service
