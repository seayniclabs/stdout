#!/bin/sh
set -e

# Read Docker secrets into environment variables
for secret in /run/secrets/*; do
  if [ -f "$secret" ]; then
    name=$(basename "$secret" | tr '[:lower:]' '[:upper:]')
    export "$name"="$(cat "$secret")"
  fi
done

# Run database migrations
echo "Running database migrations..."
node scripts/migrate.js

exec node dist/server/entry.mjs
