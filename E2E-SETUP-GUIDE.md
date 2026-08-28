---
tags: [stdout, e2e, testing, setup, credentials]
created: 2026-08-25
status: ready
---

# StdOut E2E Setup Guide

## 🎯 Quick Setup (Manual)

**URL**: http://192.168.68.89:8112/setup

### Credentials (Standard Test Account)

```
Email:    charlie@seayniclabs.com
Password: Stdout2026!
Name:     Charlie Seay
```

### Environment Settings

```
Workspace Name: Production Lab
Accent Color:   Indigo (#6366F1)
```

### License

```
License Key: STDOUT-SELFHOST-2026
(or click "Skip for Now" to use offline mode)
```

---

## 📋 Setup Wizard Steps

### Step 1: Create Admin Account
1. Navigate to http://192.168.68.89:8112/setup
2. Fill in:
   - **Display Name**: Charlie Seay
   - **Email**: charlie@seayniclabs.com
   - **Password**: Stdout2026!
3. Click "Create Account"

### Step 2: Name Environment
1. **Workspace Name**: Production Lab
2. **Accent Color**: Indigo (or choose from palette)
3. Click "Continue"

### Step 3: Activate License
1. **Option A**: Enter license key `STDOUT-SELFHOST-2026`
2. **Option B**: Click "Skip for Now" (offline mode)
3. Click "Activate" or "Skip"

### Step 4: Complete
- Automatic redirect to dashboard
- Workers start automatically
- Discovery begins within 5 minutes

---

## ✅ Verification Checklist

### Immediately After Setup

```bash
# 1. Check workers started
ssh thinkpad "docker logs stdout 2>&1 | grep -E 'Setup complete|Observatory|workers'"

# Expected output:
# [init] Setup complete - starting background workers
# [Observatory] Observatory Initialization Started
# [passive-discovery-worker] started — checking scanner_schedule every 5 min
```

### 5 Minutes After Setup

```bash
# 2. Check discoveries
ssh thinkpad "docker exec stdout sqlite3 /app/data/stdout.db 'SELECT COUNT(*) FROM discovered_hosts;'"

# Expected: Number > 0
```

### 15 Minutes After Setup

```bash
# 3. Check integration status
ssh thinkpad "docker exec stdout sqlite3 /app/data/stdout.db 'SELECT ip_address, hostname, device_type, connection_status FROM discovered_hosts LIMIT 10;'"

# Expected: Hosts with various connection_status values
```

---

## 🔧 Automated Setup (Future)

**Script**: `scripts/automated-setup.sh`

**Status**: Blocked by CSRF origin check on API endpoints  
**Alternative**: Use Chrome DevTools MCP for browser automation  
**Manual**: Follow steps above (< 2 minutes)

### Database Direct Method (Development Only)

```bash
# Generate password hash (requires bcryptjs)
HASH=$(docker exec stdout node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('Stdout2026!', 10, (e,h) => console.log(h));")

# Insert user directly
ssh thinkpad "docker exec stdout sqlite3 /app/data/stdout.db \"
INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at)
VALUES ('usr_charlie', 'charlie@seayniclabs.com', '${HASH}', 'Charlie Seay', 'admin', $(date +%s)000, $(date +%s)000);
\""

# Mark setup complete
ssh thinkpad "docker exec stdout sqlite3 /app/data/stdout.db \"
INSERT INTO system_state (key, value, updated_at)
VALUES ('installation_complete', 'true', $(date +%s)000)
ON CONFLICT(key) DO UPDATE SET value='true', updated_at=$(date +%s)000;
\""

# Restart container
ssh thinkpad "docker restart stdout"
```

---

## 🧪 E2E Test Scenarios

### Scenario 1: Fresh Installation
1. Start with empty database
2. Complete setup wizard
3. Verify workers start
4. Wait 5 min, verify discoveries
5. Login at /app/login
6. Navigate to /app/infrastructure/discovery
7. Verify discovered hosts appear

### Scenario 2: Discovery → Topology
1. Wait 15 min after setup
2. Verify ≥10 hosts discovered
3. Navigate to /app/infrastructure/topology (when built)
4. Verify animated diagram renders
5. Verify diagram shows real hosts
6. Test export functionality

### Scenario 3: Integration Status
1. Check discovered_hosts table
2. For each host, verify:
   - connection_status set correctly
   - device_type classified
   - Services detected (if applicable)
3. Test configuration modal (needs_config status)
4. Test ignore functionality

---

## 📊 Expected Discovery Results

### Typical Home Lab

After 15 minutes, expect to discover:

- **Router**: 192.168.68.1 (gateway)
- **Mac Mini**: 192.168.68.78 (server, multiple containers)
- **ThinkPad**: 192.168.68.89 (StdOut host itself)
- **Other devices**: Printers, IoT, workstations, phones

### Docker Containers (on StdOut host)

- stdout (self)
- stdout-avahi
- Any other running containers

### Services Detected

- Prometheus (if running)
- Grafana (if running)
- Docker API
- SSH servers
- HTTP/HTTPS services

---

## 🚨 Common Issues

### Issue 1: Workers Don't Start

**Symptom**: Logs show "Setup not yet complete - background workers will not start"

**Cause**: `system_state.installation_complete` not set  
**Fix**: Complete setup wizard OR manually insert flag (see above)

### Issue 2: Zero Discoveries After 15 Minutes

**Symptom**: `discovered_hosts` table empty

**Causes**:
1. No scanner schedule configured
2. Network scan failed
3. Insufficient permissions (Docker socket)

**Debug**:
```bash
# Check scanner schedule
docker exec stdout sqlite3 /app/data/stdout.db "SELECT * FROM scanner_schedule;"

# Check discovery logs
docker logs stdout 2>&1 | grep -i discovery

# Check Docker socket permissions
docker exec stdout docker ps
```

### Issue 3: Login Fails After Setup

**Symptom**: Credentials don't work

**Cause**: Password hash mismatch or user not created

**Fix**:
```bash
# Verify user exists
docker exec stdout sqlite3 /app/data/stdout.db "SELECT email FROM users;"

# Reset password (generate new hash and update)
```

---

## 📝 Test Credentials Reference

**Standard Test Account** (used across all test docs):
- Email: `charlie@seayniclabs.com`
- Password: `Stdout2026!` OR `test1234` (depending on test)
- Name: Charlie Seay
- Role: admin

**Alternative Test Account** (legacy):
- Email: `admin@test.local`
- Password: `test12345`
- Name: Admin User
- Role: superadmin

---

## 🔗 Related Documentation

- **HANDOFF.md** - Current production credentials (line 248)
- **TESTING-COMPLETE-REPORT.md** - E2E test results
- **CUSTOMER-JOURNEY-TEST.md** - User flow testing
- **WEEK-LONG-TEST-PLAN.md** - Extended testing scenarios
- **automated-setup.sh** - Automated setup script (WIP)

---

## ✅ Success Criteria

Setup is complete when:

1. ✅ User can login at /app/login
2. ✅ Dashboard loads without errors
3. ✅ Workers shown in logs: `[init] Setup complete - starting background workers`
4. ✅ Observatory initialized: `[Observatory] ✓ Initialization complete`
5. ✅ Discovery worker active: `[passive-discovery-worker] started`
6. ✅ Discoveries appear within 15 minutes
7. ✅ Discovery UI shows hosts at /app/infrastructure/discovery

---

**Last Updated**: 2026-08-25  
**Status**: Workers fixed and operational  
**Next**: Complete setup wizard to trigger first discovery scan
