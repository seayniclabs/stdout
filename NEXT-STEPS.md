# StdOut Installation - Next Steps

## Current State (2026-06-09)

✅ **Completed:**
- Visual installer built (Home Assistant style, StdOut branding)
- Real-time progress tracking via SSE
- Ephemeral setup server on port 8888
- E2E test passes to 70% (health checks)
- System requirements documented (x86_64, ARM64, Raspberry Pi)
- Multi-arch build guide created (BUILD.md)
- License validation strategy designed (hybrid approach)

⏳ **Blockers:**
1. Cannot push to `ghcr.io/seayniclabs/*` (403 Forbidden)
2. Need to test updated StdOut image (with `db:migrate` script) to 100%

## Image Status

Built image saved at: `/tmp/stdout-latest.tar` (281MB)
- Includes updated `package.json` with `db:migrate` script
- Includes all required initialization scripts
- Built for `linux/amd64` platform

## Testing Plan

### Step 1: Transfer Image to ThinkPad

```bash
# On Mac
scp /tmp/stdout-latest.tar charlieseay@192.168.0.244:/tmp/

# On ThinkPad
docker load < /tmp/stdout-latest.tar
docker images | grep stdout  # Verify loaded
```

### Step 2: Run E2E Test

```bash
# On ThinkPad
cd ~/e2e-tests
npx playwright test tests/stdout/installer.spec.js --headed
```

**Expected result:** Installation reaches 100% with all 8 steps completed.

**If it fails at step 5 (Initialize Database):**
- Check: `docker logs stdout`
- Verify: `npm run db:migrate` exists in package.json
- Verify: `scripts/migrate.js` exists and is executable

### Step 3: Verify All Scripts Work

After successful installation:

```bash
# Verify database was created
docker exec stdout ls -lh /data/stdout.db

# Verify tables exist
docker exec stdout sqlite3 /data/stdout.db ".tables"

# Verify admin user created
docker exec stdout sqlite3 /data/stdout.db "SELECT email FROM users WHERE role='admin';"

# Verify environment name set
docker exec stdout cat /data/env-name.txt

# Verify installation marked complete
docker exec stdout cat /data/installation-complete
```

## License Validation - Implementation Order

### Phase 1: Runtime Validation (Week 1)
**Priority:** High  
**Blocks:** Nothing (foundation for other phases)

1. Create `src/lib/license.ts` in StdOut app
2. Add license validation to app startup (exit if invalid)
3. Support both online API validation and offline license file
4. Create `scripts/set-license.js` helper
5. Test with mock licenses

**Deliverables:**
- App validates license on every startup
- Works online (API call) or offline (local file)
- Clear error messages if license missing/invalid

### Phase 2: Online Install (Week 2)
**Priority:** High  
**Blocks:** Public launch (primary install path)

1. Build license validation API
   - `POST /activate` — validates key, returns GHCR token + offline license
   - `POST /validate` — checks if key is still valid
2. Add license key field to setup form
3. Update installer.js to validate before pulling
4. Generate temporary GHCR tokens (1-hour expiry)
5. Integrate with Stripe for license generation

**Deliverables:**
- User enters license key in setup form
- Installer validates via API
- Images pull from private GHCR using temporary token
- Offline license file written for future use

### Phase 3: Offline Install (Week 3)
**Priority:** Medium  
**Blocks:** Air-gapped/enterprise deployments

1. Create `save-images.sh` script (bundles all images to tarball)
2. Update `install.sh` with `--offline` flag
3. Build customer download portal (authenticated downloads)
4. Automate bundle generation (Stripe webhook → bundle → email)
5. Test full offline install flow

**Deliverables:**
- `./install.sh --offline --bundle stdout-bundle.tar.gz --license stdout.license`
- No network required except one-time license validation
- Bundle downloads authenticated by license purchase

### Phase 4: License Server (Week 2-3, parallel with Phase 2/3)
**Priority:** High  
**Tech stack:** Cloudflare Workers + D1 + KV (recommended)

**Endpoints:**
- `POST /activate` — first-time activation
- `POST /validate` — runtime validation
- `GET /download/bundle/:license_key` — authenticated bundle download

**Features:**
- Rate limiting (5 activations/hour per key)
- License revocation (blacklist)
- Usage analytics (activations, validation calls)
- Integration with Stripe webhooks

## GHCR Permissions Issue

**Current blocker:** Cannot push to `ghcr.io/seayniclabs/*`

**Temporary solution:**
- Use `ghcr.io/charlieseay/*` for testing
- Update templates to use charlieseay namespace

**Permanent solution:**
- Add GitHub PAT with `write:packages` scope for seayniclabs org
- Or: use charlieseay namespace for all images
- Update all references in installer and docs

## Multi-Arch Build (Post-Testing)

Once testing passes at 100%, build for both AMD64 and ARM64:

```bash
# Create buildx builder (one-time)
docker buildx create --name multiarch --use

# Build and push multi-arch
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/charlieseay/stdout:latest \
  --push \
  .
```

**Verify multi-arch:**
```bash
docker buildx imagetools inspect ghcr.io/charlieseay/stdout:latest
```

## Documentation Updates Needed

After testing passes:

1. **INSTALL.md:**
   - Add license key instructions
   - Document all three install paths (online, offline, pre-loaded)
   - Add troubleshooting section for license issues

2. **README.md:**
   - Add "Getting Started" with one-command install
   - Link to LICENSE-VALIDATION.md for details
   - Add "Supported Platforms" section

3. **Website (stdout.io):**
   - Pricing page with license purchase
   - Download portal for bundles + license files
   - License FAQ
   - Installation video/guide

## Success Criteria

**Installation reaches 100%:**
- ✅ All 8 steps complete without errors
- ✅ StdOut accessible at http://stdout.local:8112
- ✅ Windlass accessible at http://stdout.local:8116
- ✅ Admin login works with credentials from setup form
- ✅ Database initialized with correct schema
- ✅ Environment name displayed correctly

**License validation works:**
- ✅ Online: API validates key, grants GHCR access, installs successfully
- ✅ Offline: Bundle + license file install successfully
- ✅ Runtime: App validates on startup (online or offline)
- ✅ Revocation: Blacklisted licenses rejected

**Multi-arch works:**
- ✅ AMD64 image works on ThinkPad
- ✅ ARM64 image works on Raspberry Pi 4
- ✅ Both platforms run same version

## Timeline

- **Day 1:** Test to 100% on ThinkPad ← **YOU ARE HERE**
- **Day 2-3:** Implement Phase 1 (runtime validation)
- **Week 2:** Build license API + online install flow
- **Week 3:** Offline bundles + download portal
- **Week 4:** Polish, docs, testing

## Questions to Answer

1. ✅ **Raspberry Pi support?** Yes — Pi 4/5 with 4GB+ RAM, 64-bit OS, SSD storage
2. ✅ **License approach?** Hybrid: online (Option 1) + offline (Option 3) + runtime (Option 4)
3. ⏳ **GHCR namespace?** charlieseay or seayniclabs? (Need to decide)
4. ⏳ **Pricing model?** (Needed for license generation integration)
5. ⏳ **Support model?** (For license issues, installation failures)

## Files Created This Session

- `/Users/charlieseay/Projects/stdout/BUILD.md` — Multi-arch build guide
- `/Users/charlieseay/Projects/stdout/LICENSE-VALIDATION.md` — License strategy
- `/Users/charlieseay/Projects/stdout/NEXT-STEPS.md` — This file
- `/tmp/stdout-latest.tar` — Updated StdOut image (AMD64)

## Files Updated This Session

- `/Users/charlieseay/Projects/stdout/INSTALL.md` — System requirements + Raspberry Pi guide
- `/Users/charlieseay/Projects/stdout/package.json` — Added `db:migrate` script
