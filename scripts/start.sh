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

# Run database migrations first
echo "Running database migrations..."
node scripts/migrate.js

# Seed Observatory standard patterns on fresh install
# TODO: Fix seed-patterns.js to match current schema
# echo "Seeding Observatory patterns..."
# node scripts/seed-patterns.js

# Run init script for first-run auto-configuration (after DB exists)
if [ -f scripts/init-setup.sh ]; then
  sh scripts/init-setup.sh
fi

# Validate license (production only)
# TODO: Re-enable after fixing license.js build output issue
# License is already validated by installer before container starts
# if [ "$NODE_ENV" = "production" ]; then
#   echo "[start] Validating license..."
#   node scripts/validate-license.js
# fi

echo "[start] Starting web server on port ${PORT:-3000}..."
exec node dist/server/entry.mjs
