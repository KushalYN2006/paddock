#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

BACKEND_PRIVATE_IP="${1:-}"
if [[ ! "$BACKEND_PRIVATE_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  echo "Usage: sudo deploy/ec2/install-frontend.sh <backend-private-ip>" >&2
  exit 1
fi

APP_ROOT=/opt/f1-companion
dnf update -y
dnf install -y nodejs24 nginx
npm install --global pnpm@10

cd "$APP_ROOT/frontend"
pnpm install --frozen-lockfile
VITE_API_BASE_URL=/api/v1 pnpm build

install -d -o root -g root -m 0755 /var/www/f1-companion
cp -a dist/. /var/www/f1-companion/
sed "s/__BACKEND_PRIVATE_IP__/$BACKEND_PRIVATE_IP/g" "$APP_ROOT/deploy/ec2/nginx-f1-companion.conf.template" > /etc/nginx/conf.d/f1-companion.conf
nginx -t
systemctl enable --now nginx
systemctl reload nginx
