# CRITICAL: Fix Duplicate Schema Exports

## Problem Statement

Gemini's Phase 3 schema refactoring (commit f69ef94) created duplicate table exports that break Drizzle ORM at runtime, causing deployment failure on ThinkPad.

**Error:** `TypeError: Cannot read properties of undefined (reading 'Symbol(drizzle:IsAlias)')`

## Root Cause

Multiple schema files export tables with identical names:

**Duplicates Found:**
1. `users` table - exported by BOTH:
   - `src/lib/db/auth-schema.ts` (7 columns)
   - `src/lib/db/central-schema.ts` (10 columns - adds emailVerified, privacyAcceptedAt, dpaAcceptedAt)

2. `sessions` table - exported by BOTH:
   - `src/lib/db/auth-schema.ts`
   - `src/lib/db/central-schema.ts`

**How it breaks:**
```typescript
// schema.ts does:
export * from './auth-schema';      // exports users, sessions
export * from './central-schema';   // ALSO exports users, sessions

// When code tries: db.select().from(schema.users)
// Drizzle sees TWO definitions and fails
```

## Required Fix

**Goal:** Single source of truth for each table - no duplicates

**Approach:**
1. Audit ALL schema files for duplicate exports
2. Decide canonical location for each table
3. Remove duplicates, keep only one definition
4. Ensure all re-exports work correctly

## Files to Audit

```
src/lib/db/
├── schema.ts              (master file, does export *)
├── auth-schema.ts         (users, sessions, apiTokens)
├── central-schema.ts      (users, sessions, license, etc) ⚠️ DUPLICATES
├── monitoring-schema.ts   (monitors, incidents, etc)
├── observatory-schema.ts  (baselines, patterns, etc)
└── agent-schema.ts        (agentConfig, agentConversations)
```

## Decision Rules

For each duplicate table, choose ONE location:

**auth-schema.ts should contain:**
- Core auth tables ONLY: users, sessions, apiTokens
- Simple schema (no SaaS-specific fields)

**central-schema.ts should contain:**
- License/subscription tables
- System-wide config tables
- Multi-tenant tables (if any)
- NOT auth tables (those go in auth-schema)

**If tables have different schemas:**
- Use the MOST COMPLETE version (more columns)
- central-schema.ts `users` has 10 columns vs auth-schema 7 columns
- Keep central-schema version, DELETE auth-schema version

## Verification Steps

After fixing:

1. **Build test:**
   ```bash
   npm run build
   ```

2. **Runtime test:**
   ```bash
   docker build -t stdout:test .
   docker run --rm stdout:test node -e "const s = require('./dist/server/entry.mjs')"
   ```

3. **Deploy test:**
   - Deploy to ThinkPad
   - Check logs for Drizzle errors
   - Verify container reaches `healthy` state
   - Test login/auth flows

## Success Criteria

✅ No duplicate table exports  
✅ `npm run build` succeeds  
✅ Docker build succeeds  
✅ Container starts without Drizzle errors  
✅ Health check passes  
✅ Workers start cleanly  
✅ Auth flows work (login, sessions)

## Additional Context

**Current state:**
- StdOut rolled back to commit `457b34a` (working)
- Broken commits: f69ef94, 63c4ef8, ecc5549, 12c6017
- ThinkPad running old version at http://192.168.68.89:8112

**What's good about Gemini's work:**
- 3 new workers (passive-discovery, housekeeping, storage-monitor)
- Modular schema architecture (good idea, bad execution)
- Network dashboard
- Removed ticketing system (intentional)

**What needs fixing:**
- Duplicate schema exports (CRITICAL)
- Schema file organization
- Proper re-export structure

## Team Assignment

**NLM:** Query stdout-kb for existing schema architecture, any prior schema refactoring lessons

**Cursor:** Fix the duplicate exports - audit files, choose canonical locations, remove duplicates

**Gemini:** Validate the fix - test build, verify no runtime errors, confirm all imports resolve

**Claude (me):** Coordinate, verify final result, deploy to ThinkPad, run verification checklist
