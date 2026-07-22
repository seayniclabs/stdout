# Production Database Migration Guide
**Upgrade to StdOut with Auto-Remediation & Cost Tracking**

---

## Overview

This guide walks you through safely migrating your production StdOut database to support the new features:

✅ **Auto-remediation framework** (playbooks, dry-run, rollback)  
✅ **Cost tracking** (per-incident AI costs, provider breakdown)  
✅ **P0 code quality fixes** (structured logging, type safety, error handling)  
✅ **UI/UX improvements** (component library ready to apply)

**Time required:** 10-15 minutes  
**Downtime:** ~2 minutes  
**Risk level:** Low (automatic backup + rollback script included)

---

## Pre-Migration Checklist

Before starting, verify:

- [ ] You have SSH access to the ThinkPad (charlie@192.168.68.89)
- [ ] StdOut is currently running and accessible
- [ ] You have at least 1GB free disk space for backup
- [ ] Your account and license are working (charlie@seayniclabs.com)

---

## Migration Steps

### Step 1: Verify Current State

SSH to ThinkPad and check StdOut is running:

```bash
ssh charlie@192.168.68.89
docker ps | grep stdout
```

Expected output: Container `stdout` should be `Up` and `healthy`.

### Step 2: Run Migration Script

The migration script will:
- Create a timestamped backup
- Add missing columns to existing tables
- Create new tables for auto-remediation and cost tracking
- Validate the migration
- Rollback automatically if anything fails

Run inside the container:

```bash
docker exec stdout /app/scripts/migrate-production-to-new-schema.sh /data/stdout.db
```

**Watch for:**
- ✓ Green checkmarks = success
- ✗ Red X's = failure (script will abort and preserve your data)

**Expected output:**
```
=== StdOut Production Database Migration ===
[1/6] Creating backup...
  ✓ Backup created
[2/6] Adding missing columns to existing tables...
  → Add expires_at to api_tokens... ✓
  → Add ai_cost_usd to incidents... ✓
  ...
[6/6] Validating migration...
  ✓ Table remediation_playbooks exists
  ...
=== Migration completed successfully! ===
```

### Step 3: Stop Old Container

```bash
docker stop stdout
```

### Step 4: Start New Version

```bash
cd ~/stdout-new
docker-compose up -d
```

Wait 10 seconds for startup:

```bash
sleep 10
docker ps | grep stdout
```

### Step 5: Verify Everything Works

**Test login:**
```bash
curl -I http://localhost:8112/app/login
```

Expected: `HTTP/1.1 200 OK` or `302 Found`

**Check logs for errors:**
```bash
docker logs stdout 2>&1 | grep -i error | tail -20
```

Expected: No SQL errors about missing columns

**Test in browser:**
1. Open http://192.168.68.89:8112
2. Log in with your credentials
3. Navigate to Observatory (/app/observatory)
4. Navigate to Remediations (/app/remediations) - **NEW!**
5. Navigate to Costs (/app/costs) - **NEW!**

### Step 6: Verify Account & License

Check your account and license are intact:

```bash
docker exec stdout sqlite3 /data/stdout.db 'SELECT email, role FROM users'
docker exec stdout sqlite3 /data/stdout.db 'SELECT email, edition FROM license'
```

Expected:
```
charlie@seayniclabs.com|admin
charlie@seayniclabs.com|self-host
```

---

## If Something Goes Wrong

### Rollback to Previous Version

If the new version has issues, rollback to your working version:

**Step 1: Stop new container**
```bash
docker stop stdout
```

**Step 2: Find your backup**
```bash
ls -lh ~/stdout-new/data/stdout-pre-migration-*.db
```

**Step 3: Run rollback script**
```bash
cd ~/stdout-new
./scripts/rollback-migration.sh \
  /data/stdout-pre-migration-YYYYMMDD-HHMMSS.db \
  /data/stdout.db
```

(Replace `YYYYMMDD-HHMMSS` with the actual timestamp from step 2)

**Step 4: Start old container**
```bash
cd ~/stdout
docker-compose up -d
```

**Step 5: Verify old version works**
```bash
curl -I http://localhost:8112/app/login
```

---

## Post-Migration: Test New Features

### Test Auto-Remediation

1. Go to http://192.168.68.89:8112/app/remediations
2. View built-in playbooks (K8s, Docker, cache, scaling, restart)
3. Create a test playbook or run one in dry-run mode

### Test Cost Tracking

1. Go to http://192.168.68.89:8112/app/costs
2. View monthly cost summary
3. Check cost breakdown by provider
4. See which incidents cost money (Ollama = $0!)

### Test UI Improvements

1. Check Observatory page for improved layout
2. Accessibility: Use Tab key to navigate (should work smoothly)
3. Mobile: View on phone (should be responsive)

---

## What Changed

### Database Schema

**New tables:**
- `remediation_playbooks` — Store auto-remediation playbooks
- `remediation_executions` — Execution history
- `remediation_execution_steps` — Step-by-step logs
- `cost_audit` — LLM cost tracking per incident

**Modified tables:**
- `api_tokens` — Added `expires_at` column
- `incidents` — Added `ai_cost_usd`, `ai_tokens_used`, `provider` columns

**New indexes:**
- `idx_cost_audit_incident` — Fast incident cost lookups
- `idx_cost_audit_created` — Fast date-range queries
- `idx_remediation_executions_incident` — Fast execution history
- `idx_remediation_executions_playbook` — Fast playbook usage stats

### Code Changes

**P0 Fixes:**
- ✅ All errors now logged (structured JSON)
- ✅ Type safety (zero `as any` bypasses)
- ✅ Idempotent background jobs
- ✅ Better error handling

**New Features:**
- ✅ Auto-remediation framework
- ✅ Cost tracking system
- ✅ Dry-run mode
- ✅ Automatic rollback

---

## Troubleshooting

### Issue: "no such column" errors in logs

**Cause:** Migration didn't complete successfully  
**Fix:** Run migration script again or rollback

### Issue: Login page blank/white

**Cause:** Missing `expires_at` column  
**Fix:** 
```bash
docker exec stdout sqlite3 /data/stdout.db 'ALTER TABLE api_tokens ADD COLUMN expires_at INTEGER'
docker restart stdout
```

### Issue: Import page blank

**Cause:** Code expecting new schema  
**Fix:** Complete migration or rollback to old version

### Issue: Container won't start

**Cause:** Docker image mismatch  
**Fix:**
```bash
docker-compose down
docker-compose up -d
docker logs stdout
```

---

## Support

If you encounter issues not covered here:

1. **Check logs:** `docker logs stdout 2>&1 | tail -50`
2. **Check database integrity:** `docker exec stdout sqlite3 /data/stdout.db 'PRAGMA integrity_check'`
3. **Verify backup exists:** `ls -lh ~/stdout-new/data/*.db`
4. **Rollback if needed:** Use rollback script above

---

## Success Criteria

Migration is successful when:

✅ Login page loads without errors  
✅ Account and license preserved  
✅ Old data (incidents, monitors, stacks) still visible  
✅ New pages accessible (/app/remediations, /app/costs)  
✅ No SQL errors in logs  
✅ Database integrity check passes  

---

## Next Steps After Migration

1. **Apply UI components** — Update pages with new component library (26 hours)
2. **Create your first playbook** — Test auto-remediation on a safe target
3. **Review cost tracking** — See which AI providers cost money
4. **Update documentation** — Capture any custom playbooks you create

**Enjoy your upgraded StdOut with autonomous incident remediation!** 🎉
