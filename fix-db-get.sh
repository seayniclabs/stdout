#!/bin/bash
# Fix all db.get(sql` calls by converting to proper Drizzle queries or raw SQL

echo "Finding all files with db.get(sql usage..."
files=$(grep -r "db\.get.*sql\`" src/ --include="*.ts" --include="*.js" -l | sort -u)

echo "Files to fix:"
echo "$files"
echo ""
echo "Total files: $(echo "$files" | wc -l)"

# For now, just list them. Manual fix required as each needs different table imports.
echo ""
echo "Manual fix required - each file needs:"
echo "1. Import the table schema (e.g., import { systemSettings } from '../db/schema')"
echo "2. Replace db.get(sql\`...\`) with db.select().from(table).where(eq(...))"
echo "3. OR use raw SQLite: (db as any).\$client.prepare(...).get()"
