# Systemic Bug: db.get(sql` pattern throughout codebase

## Root Cause
Drizzle ORM instances don't have a `.get()` method. The pattern `db.get(sql\`...\`)` fails with "near '=': syntax error" because:
1. `sql\`` template returns a SQL query object, not a string
2. `db.get()` doesn't exist on Drizzle - it's a better-sqlite3 method
3. When the query object is coerced to string, it produces invalid SQL

## Affected Files (24 total)
All files using `db.get(sql\`...` pattern - see fix-db-get.sh output

## Correct Patterns

**Option 1 - Raw SQLite (for complex queries):**
```typescript
const db = getDb();
const rawDb = (db as any).$client;
const result = rawDb.prepare('SELECT * FROM table WHERE id = ?').get(value);
```

**Option 2 - Proper Drizzle (for simple queries):**
```typescript
const db = getDb();
const result = await db.select().from(table).where(eq(table.id, value)).limit(1).then(r => r[0]);
```

## Files Fixed So Far
1. ✅ src/lib/observatory/initial-discovery.ts (getDiscoveryState)
2. ✅ src/lib/observatory/operating-mode.ts (ensurePrefsRow, getModeState) - PARTIAL

## Files Still Needing Fix (22 remaining)
See fix-db-get.sh output for complete list

## Impact
- Non-blocking: Code continues after error
- Discovery functionality partially broken
- Will cause similar errors in other features as they're used

## Recommendation
- Immediate: Fix remaining instances in operating-mode.ts (lines 360, 400)
- Sprint: Create task to fix all 22 remaining files
- Long-term: Add ESLint rule to prevent this pattern
