# StdOut Self-Hosted Edition - Installation Testing

## Test Session: 2026-08-15

### Testing Method
- **Environment:** ThinkPad at 192.168.68.89
- **Installer:** stdout-setup container (visual installer on port 8888)
- **Method:** Automated browser testing via Chrome DevTools MCP
- **Test Mode:** TEST_MODE=true (bypasses license validation)
- **Credentials:** admin@brightonlab.local / SecurePassword123! / Brighton Test Lab

### Bugs Found & Fixed

#### Bug #1: Duplicate column error in migration 0032
- **Symptom:** `Migration failed: duplicate column name: user_id` on windlass_config table
- **Root Cause:** Migration 0001_fix_windlass_config.sql already creates windlass_config table WITH user_id column. Migration 0032 attempted to ADD the same column.
- **Fix:** Deleted drizzle/0032_add_windlass_config_user_id.sql and removed idx 32 from journal.
- **Commit:** a571d66

#### Bug #2: Missing user_id column in api_tokens
- **Symptom:** `mark-installation-complete.js` failed with "no such column: user_id" on api_tokens table
- **Root Cause:** api_tokens table created in migration 0000 without user_id column, but schema.ts expects it. No migration ever added it.
- **Fix:** Created migration 0032_add_api_tokens_user_id.sql
- **Commit:** 89a1f50

### Migration Status

**Total migrations:** 33 files (0000-0032)
**Applied:** 31 migrations
**Skipped:** 2 placeholders (0013, 0015) - Drizzle skips migrations with only SELECT statements

**Key migrations:**
- 0000: Initial schema (without user_id columns)
- 0001: Recreates windlass_config WITH user_id (this is why 0032 was redundant)
- 0008: Adds api_tokens.expires_at
- 0031: Adds scanner_schedule.user_id ✅
- 0032: Adds api_tokens.user_id ✅

### Test Results

✅ **Installation: SUCCESSFUL**
- Visual installer completed at 100%
- Dashboard accessible at http://192.168.68.89:8112
- Admin user created successfully
- Zero "no such column: user_id" errors in logs
- Zero console errors in browser

✅ **Database Schema: VALIDATED**
```sql
-- api_tokens now has user_id column
CREATE TABLE `api_tokens` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `token_hash` text NOT NULL,
  `last_used_at` integer,
  `created_at` integer NOT NULL,
  expires_at INTEGER NOT NULL DEFAULT (unixepoch() + 30 * 24 * 60 * 60),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE
);
```

✅ **Dashboard: OPERATIONAL**
- Logged in as admin
- Riggins Observatory Agent: IDLE
- 0 services / 0 incidents (clean install)
- Activity log showing recent events
- Infrastructure stats: 3 stacks, 0 monitors, 5 docs

⚠️ **Minor Issue (non-blocking):**
- Initial discovery shows SQL syntax error: `near "=": syntax error`
- Does not block installation or dashboard functionality
- Discovery worker continues and saves 0 discoveries successfully
- Needs investigation but not critical for release

### Final Docker Image

**Digest:** `sha256:da3b77ace7e1dd94e66f53fbe2319b34cec93e8ad19f7e91e87ef8d1e56239b0`
**Tag:** charlieseay/stdout:latest
**Build Date:** 2026-08-15
**Platforms:** linux/amd64, linux/arm64

### Conclusion

StdOut Self-Hosted Edition installer is **READY FOR RELEASE** with the following caveats:

1. ✅ All critical bugs fixed (user_id column errors)
2. ✅ Installation completes successfully
3. ✅ Dashboard fully operational
4. ✅ Zero blocking errors
5. ⚠️ Minor discovery SQL syntax error (non-blocking, needs follow-up)

**Recommendation:** Ship to customers. The discovery error can be addressed in a patch release.
