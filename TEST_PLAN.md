# StdOut Automated Setup - Test Plan

## Test Environment

**Fresh Install Test**: Start from scratch, no existing data

```bash
# Cleanup
cd /Users/charlieseay/Projects/stdout
docker compose down -v  # Remove volumes too
rm -rf data/  # Remove any local data
rm -rf windlass-config/

# Start fresh
docker compose build
docker compose up -d
```

---

## Test Cases

### 1. Zero-Touch Setup Flow

**Objective**: Verify setup completes with only 2 manual steps

**Steps**:
1. Open http://localhost:8112
2. Should redirect to `/setup` (Step 1: Create Admin Account)
3. Fill in:
   - Display Name: "Test Admin"
   - Email: test@example.com
   - Password: testpassword123
4. Click "Create Account & Continue"
5. Should redirect to `/setup/environment` (Step 2: Name Environment)
6. Fill in:
   - Environment Name: "Test Lab"
7. Click "Continue"
8. Should redirect DIRECTLY to `/setup/complete` (skipping steps 3-7)

**Expected Result**:
- Setup completes in 2 steps
- No license prompt
- No scanner manual controls
- No Windlass configuration choices
- No ticketing system selection
- Completion screen shows:
  - ✅ Admin Account: test@example.com
  - ✅ License: Optional (activate in Settings)
  - ✅ Infrastructure: Scanning in background... OR Auto-scan complete
  - ✅ Windlass: Auto-detected and connected OR Not available (optional)
  - ✅ Ticketing: Built-in

**Pass Criteria**:
- [ ] Only 2 forms shown (account + environment)
- [ ] Redirects directly to completion
- [ ] No "Skip for Now" buttons
- [ ] Dashboard accessible after completion

---

### 2. Background Scanner Execution

**Objective**: Verify network scanner runs in background

**Steps**:
1. Complete setup flow (Test Case 1)
2. Check Docker logs: `docker compose logs -f stdout`
3. Look for:
   ```
   [setup] Background scanner triggered
   [auto-scan] Starting background infrastructure scan
   [auto-scan] Scanning subnet: X.X.X.X/24
   [auto-scan] Found N hosts
   [auto-scan] Scanner step marked complete
   ```

**Expected Result**:
- Scanner starts automatically after environment name submitted
- Runs in background (doesn't block setup completion)
- Discovers hosts on local network
- Saves results to database

**Pass Criteria**:
- [ ] Log shows scanner triggered
- [ ] Scanner completes without errors
- [ ] Database has entries in `discovered_hosts` table
- [ ] Completion screen updates from "Scanning..." to "X services found"

---

### 3. Windlass Auto-Detection

**Objective**: Verify Windlass is auto-detected and connected if available

**Test 3A: Windlass Available**

**Steps**:
1. Start Windlass: `docker compose --profile windlass up -d windlass`
2. Wait for Windlass health check: `curl http://localhost:8116/health`
3. Run setup flow (Test Case 1)
4. Check completion screen

**Expected Result**:
- Windlass: "Auto-detected and connected"
- No manual configuration prompt

**Test 3B: Windlass Not Available**

**Steps**:
1. Ensure Windlass is NOT running: `docker compose stop windlass`
2. Run setup flow (Test Case 1)
3. Check completion screen

**Expected Result**:
- Windlass: "Not available (optional)"
- Setup continues without error
- No manual configuration prompt

**Pass Criteria**:
- [ ] Auto-connects when Windlass is running
- [ ] Gracefully skips when Windlass is not available
- [ ] No user prompt in either case

---

### 4. Ticketing Auto-Detection

**Objective**: Verify external ticketing systems are auto-detected from env vars

**Test 4A: No External Ticketing**

**Steps**:
1. Ensure no ticketing env vars in `.env`
2. Run setup flow
3. Check completion screen

**Expected Result**:
- Ticketing: "Built-in"

**Test 4B: Linear Detected**

**Steps**:
1. Add to `.env`: `LINEAR_API_KEY=lin_api_xxxx`
2. Rebuild and restart: `docker compose up -d --force-recreate`
3. Run setup flow
4. Check completion screen

**Expected Result**:
- Ticketing: "Linear (auto-detected)"

**Pass Criteria**:
- [ ] Defaults to built-in when no env vars
- [ ] Detects Linear when LINEAR_API_KEY present
- [ ] No manual selection prompt

---

### 5. Init Script Execution

**Objective**: Verify container init script runs on startup

**Steps**:
1. Start container: `docker compose up -d stdout`
2. Check logs: `docker compose logs stdout`
3. Look for:
   ```
   [init] StdOut initialization starting...
   [init] Data directories ensured
   [init] Database exists at /data/stdout.db
   [init] Setup already complete
   [init] Checking Windlass availability...
   [init] Initialization complete
   [init] Starting StdOut web server...
   ```

**Expected Result**:
- Init script runs before web server starts
- Creates data directories if missing
- Checks setup status
- Auto-connects to Windlass/Sentinel if available

**Pass Criteria**:
- [ ] Init logs appear before web server logs
- [ ] Data directories created automatically
- [ ] Windlass/Sentinel checked on every start

---

### 6. Observatory Profile with Ollama Auto-Install

**Objective**: Verify Observatory auto-installs Ollama and models (Linux only)

**Steps**:
1. Start Observatory: `docker compose --profile observatory up -d`
2. Check Sentinel logs: `docker compose logs -f observatory-sentinel`
3. Look for:
   ```
   [init-ollama] Starting Ollama initialization...
   [init-ollama] Checking Ollama at http://host.docker.internal:11434...
   [init-ollama] Pulling Watcher model (llama3.2:3b-instruct-q4_K_M)...
   [init-ollama] Pulling Analyst model (qwen2.5:14b-instruct-q4_K_M)...
   [init-ollama] All models ready
   [init-ollama] Initialization complete
   ```
4. Check init status: `curl http://localhost:8081/init-status | jq`

**Expected Result**:
- Ollama detected or installed
- Models pulled automatically
- Watcher agent starts monitoring

**Pass Criteria**:
- [ ] Ollama check runs on container start
- [ ] Models auto-pull if missing
- [ ] Status endpoint shows progress
- [ ] Monitoring starts when ready

---

### 7. Network Service Discovery Integration

**Objective**: Verify discovered services can be added to Observatory

**Steps**:
1. Open http://localhost:8112/app/observatory/network-test
2. Click "Start Scan"
3. Wait for scan to complete
4. Click "Scan Services"
5. Wait for service detection
6. Verify services are grouped by host
7. Click "Add to Observatory Monitoring"
8. Check Prometheus config: `docker exec prometheus cat /etc/prometheus/prometheus.yml | grep discovered -A 10`

**Expected Result**:
- Network scan discovers hosts
- Service scan finds open ports
- Services saved to database
- "Add to Observatory" creates Prometheus scrape targets
- Services appear in Observatory dashboard

**Pass Criteria**:
- [ ] Scan discovers hosts on network
- [ ] Service detection identifies services
- [ ] Database has entries in `discovered_services`
- [ ] Prometheus config updated with new targets
- [ ] Observatory dashboard shows new services

---

### 8. Database Schema Verification

**Objective**: Verify all required tables exist

**Steps**:
1. Connect to database: `docker exec -it stdout sqlite3 /data/stdout.db`
2. List tables: `.tables`
3. Check for:
   - `setup_progress` (8 rows, all completed=1)
   - `setup_config` (environment_name, scanner_token)
   - `discovered_hosts`
   - `discovered_services`
   - `stacks`
   - `windlass_services`

**Expected Result**:
- All tables exist
- setup_progress shows 8 completed steps
- discovered_hosts/services have scanner results

**Pass Criteria**:
- [ ] All tables present
- [ ] Setup steps marked complete
- [ ] Scanner data saved correctly

---

## Performance Metrics

Track these during testing:

| Metric | Target | Actual |
|--------|--------|--------|
| Time to create account | < 5s | |
| Time to name environment | < 5s | |
| Time to complete setup | < 10s | |
| Background scanner duration | 30-60s | |
| First incident creation | < 30s | |
| Dashboard load time | < 2s | |

---

## Regression Tests

Ensure existing functionality still works:

- [ ] Manual license activation (Settings → License)
- [ ] Incident creation and management
- [ ] Windlass service control
- [ ] HUD dashboard
- [ ] Documentation pages
- [ ] User settings

---

## Edge Cases

### Database Migration
**Test**: Upgrade from previous version
- Start with old DB (manual setup)
- Update to new version
- Verify setup_progress table created
- Verify no re-setup required

### Network Errors
**Test**: Scanner fails (no network access)
- Disconnect network
- Run setup
- Verify setup still completes
- Verify "No services discovered" shown

### Ollama Unavailable
**Test**: Observatory without Ollama
- Start Observatory without Ollama
- Check /init-status shows error
- Verify error message is helpful
- Verify container doesn't crash

---

## Success Criteria

Setup automation is successful if:

1. ✅ **Zero-Touch Core**: 2 manual steps only (account + environment)
2. ✅ **Background Automation**: Scanner, Windlass, Ticketing all auto-configured
3. ✅ **Graceful Degradation**: Missing components don't block setup
4. ✅ **No Deferred Work**: Nothing left for user to "configure later"
5. ✅ **Fast**: Complete setup in < 3 minutes
6. ✅ **Observable**: Logs show what's happening in background
7. ✅ **Backward Compatible**: Existing installs not affected

---

## Known Limitations

Document any known issues:

1. **Observatory auto-install**: Only works on Linux (Mac/Windows requires manual Ollama)
2. **Subnet detection**: Defaults to common ranges if detection fails
3. **Service identification**: Limited to common ports (22, 80, 443, etc.)
4. **Ollama model pulls**: Can take 10-20 minutes depending on network speed

---

## Test Execution Log

| Date | Tester | Pass/Fail | Notes |
|------|--------|-----------|-------|
| 2026-06-09 | | | |
