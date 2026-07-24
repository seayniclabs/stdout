#!/bin/bash
# Holds exclusive database lock
DB=${STDOUT_DB:-"$HOME/Projects/stdout/data/stdout.db"}
DURATION=${1:-30}
sqlite3 "$DB" "BEGIN EXCLUSIVE; SELECT 'Holding lock for ${DURATION}s'; SELECT sleep(${DURATION}); COMMIT;"
