# StdOut Installation Automation Plan

## Goal
"StdOut should have a simple install process for customers and when it starts, it is all automated from there with nothing deferred if possible"

## Current State Audit

### ✅ Already Automated
1. **Admin account creation** - First setup step, DB tables auto-initialized
2. **Environment naming** - Simple form, saves to setup_config
3. **Scanner token generation** - Auto-created during admin account setup
4. **StdOut container startup** - Docker Compose handles this

### ⚠️ Partially Automated
1. **Windlass installation** - Has API endpoint but requires manual choice (same/different/cloud/skip)
2. **Scanner discovery** - Can be skipped, doesn't auto-run on install
3. **License activation** - Fully skippable

### ❌ Requires Manual Steps
1. **Ollama installation** - Required before Observatory can work
2. **Ollama model pulls** - llama3.2:3b + qwen2.5:14b (~11GB total)
3. **Windlass config directory** - Need `/opt/windlass` created before container starts
4. **Observatory profile** - Must explicitly start with `--profile observatory`
5. **External ticketing** - Requires API keys in env vars

## Automation Strategy

### Phase 1: Zero-Touch StdOut Core (HIGH PRIORITY)
**Goal:** `docker compose up -d` → fully functional StdOut without ANY manual steps

#### Changes Required:

1. **Auto-create data directories on first run**
   - Create `./data/` if missing
   - Create `./windlass-config/` if missing  
   - Add entrypoint script to StdOut container

2. **Auto-detect Windlass availability**
   - On first boot, check if Windlass container is reachable
   - If yes, auto-connect and sync
   - If no, continue without Windlass (graceful degradation)

3. **Auto-run network scanner on first boot**
   - Skip the "Skip for Now" option
   - Run scanner in background during setup
   - Auto-populate discovered infrastructure
   - User sees results on completion screen, not a wizard step

4. **Remove license gate from wizard**
   - License is optional → don't block setup on it
   - Move license activation to Settings page only
   - Setup wizard completes without license check

5. **Auto-detect and connect ticketing**
   - Check env vars for Linear/GitHub/Jira credentials
   - If present, auto-configure connector
   - If absent, use built-in ticketing (no wizard step)

#### Result:
- User runs `docker compose up -d`
- Opens http://localhost:8112
- Creates admin account (only required manual step)
- Setup auto-completes: scanner runs in background, Windlass connects if available, ticketing auto-configured
- User lands on dashboard with discovered infrastructure

### Phase 2: Observatory Auto-Installation (MEDIUM PRIORITY)
**Goal:** `--profile observatory` auto-installs Ollama and models if missing

#### Detection Logic:

```bash
# On observatory-sentinel container start
1. Check if Ollama is reachable at OLLAMA_HOST
2. If not reachable:
   a. Check if running on Linux (can install Ollama via script)
   b. If yes → curl install script, run it
   c. If no (Mac/Windows) → log warning, provide instructions
3. Check if models are pulled:
   - ollama list | grep llama3.2:3b-instruct-q4_K_M
   - ollama list | grep qwen2.5:14b-instruct-q4_K_M
4. If missing → ollama pull both models in background
5. Monitor progress, update status on Observatory dashboard
6. When complete, start Watcher agent
```

#### Implementation:

1. **Add init script to observatory-sentinel**
   - `/app/scripts/init-ollama.sh`
   - Runs before main.py starts
   - Handles Ollama detection + model pulls
   - Writes status to `/tmp/observatory-init-status.json`

2. **Add status endpoint to Sentinel**
   - `GET /init-status` → returns Ollama availability, model pull progress
   - Observatory UI polls this during first load

3. **Update Observatory dashboard**
   - Show "Initializing Ollama..." banner if models not ready
   - Progress bar for model downloads
   - Auto-refresh when ready

#### Result:
- User adds `--profile observatory` to docker compose up
- Observatory container auto-installs Ollama (if on Linux)
- Auto-pulls models in background (~5-15 min depending on network)
- Dashboard shows progress
- When complete, monitoring starts automatically

### Phase 3: Windlass Zero-Config (MEDIUM PRIORITY)
**Goal:** Windlass works out of the box without manual volume mounts or config files

#### Changes Required:

1. **Auto-generate schedule.yaml on first run**
   - Windlass container creates `/opt/windlass/schedule.yaml` if missing
   - Default: discovers all running Docker containers
   - Treats all as 24/7 services (type: always_on)
   - User can edit later via StdOut UI

2. **Auto-discover compose paths**
   - Scan /var/run/docker.sock for running containers
   - Extract compose project paths from container labels
   - Auto-populate schedule.yaml with discovered paths

3. **Remove manual volume mount requirement**
   - Windlass doesn't need `/opt/containers` mounted by default
   - Only needed if user wants scheduled start/stop
   - Discovery mode works with just docker.sock

#### Result:
- User doesn't need to create `/opt/windlass` directory
- Windlass auto-discovers running services
- Schedule defaults to 24/7 monitoring
- User can add schedules via StdOut UI later

### Phase 4: One-Command Install Script (LOW PRIORITY)
**Goal:** `curl | sh` installer that handles everything

```bash
curl -fsSL https://get.stdout.sh | sh
```

The script:
1. Checks for Docker (error if missing with install instructions)
2. Creates `stdout/` directory
3. Downloads docker-compose.yml and .env.example
4. Generates random SECRET_KEY
5. Detects local IP and sets APP_URL
6. Runs `docker compose up -d`
7. Prints URL to open in browser

Optional flags:
- `--with-windlass` → adds Windlass profile
- `--with-observatory` → adds Observatory profile + Ollama check
- `--non-interactive` → uses all defaults

## Priority Order

1. **Phase 1** (Zero-Touch Core) - Blocks customer deployments
2. **Phase 3** (Windlass Zero-Config) - Windlass is a core feature
3. **Phase 2** (Observatory Auto-Install) - Advanced feature, can be manual initially
4. **Phase 4** (One-Command Installer) - Nice-to-have, core must work first

## Success Criteria

### Minimum Viable (Phase 1)
- [ ] User runs `docker compose up -d`
- [ ] Opens browser to http://localhost:8112
- [ ] Creates admin account
- [ ] Setup completes without additional wizard steps
- [ ] Dashboard shows discovered infrastructure
- [ ] Windlass connects automatically if available

### Full Automation (All Phases)
- [ ] One-command installer works on Ubuntu/Debian/macOS
- [ ] Ollama installs automatically on Linux
- [ ] Models pull in background with progress visible
- [ ] Windlass auto-discovers services without config files
- [ ] No manual steps except running the installer

## Implementation Notes

### Backward Compatibility
- Existing setup wizard flow must still work
- Users who already completed setup shouldn't re-run automation
- Check `setup_progress` table → if SetupStep.Complete is true, skip automation

### Error Handling
- All automation must fail gracefully
- If Ollama can't install → log warning, provide manual instructions
- If scanner fails → continue without discovered services
- If Windlass unreachable → log info, continue without it

### Logging
- All automation steps log to stdout (Docker logs)
- Status visible via `docker compose logs -f`
- Critical errors also written to `/data/install.log`

## Questions for Product Decision

1. **Should setup wizard be removed entirely?**
   - Option A: Keep wizard, auto-complete steps in background
   - Option B: Remove wizard, go straight to dashboard after admin account
   - Recommendation: Option A (less jarring for users)

2. **What if Ollama can't be installed (e.g., Windows)?**
   - Option A: Fail Observatory startup, show instructions
   - Option B: Run Observatory in "remote mode" using external LLM APIs
   - Recommendation: Option A initially, Option B as enhancement

3. **Should license be required or truly optional?**
   - Current: Setup allows skip, but app nags for license
   - Option A: Make it truly optional (all features work unlicensed)
   - Option B: Keep nag, require license for Pro features
   - Recommendation: Option B (existing behavior)
