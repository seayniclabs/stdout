#!/bin/sh
set -e

echo "[start] StdOut starting..."

# Read Docker secrets into environment variables
for secret in /run/secrets/*; do
  if [ -f "$secret" ]; then
    name=$(basename "$secret" | tr '[:lower:]' '[:upper:]')
    export "$name"="$(cat "$secret")"
  fi
done

# Run init script for first-run auto-configuration
if [ -f scripts/init-setup.sh ]; then
  sh scripts/init-setup.sh
fi

# Run database migrations
echo "Running database migrations..."
node scripts/migrate.js

# Validate license (production only)
if [ "$NODE_ENV" = "production" ]; then
  echo "[start] Validating license..."
  node scripts/validate-license.js
fi

echo "[start] Starting web server on port ${PORT:-3000}..."
exec node dist/server/entry.mjs
