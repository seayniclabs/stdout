# License Validation Strategy for StdOut

## Current State

StdOut installer currently attempts to pull from `ghcr.io/seayniclabs/*` but has no license validation mechanism. Images fail to pull with "unauthorized" error unless:
1. User has GitHub PAT with read:packages scope
2. Images exist locally (pre-loaded via `docker load`)

## Proposed Solutions

### Option 1: License Key API Validation (Recommended)

**Flow:**
1. Add "License Key" field to setup form (`/Users/charlieseay/Projects/stdout-setup/public/index.html`)
2. Validate license key against API endpoint before pulling images
3. Use validated license to authorize GHCR pull (via temporary PAT or pre-signed download)

**Pros:**
- Clean UX — single license key unlocks everything
- Works offline after initial validation (license stored in local DB)
- Can track installations per license
- Can revoke/expire licenses server-side

**Cons:**
- Requires license validation service (API endpoint)
- Network dependency during initial install
- Need to build license management backend

**Implementation:**
```javascript
// In installer.js, before pulling images:
const licenseValid = await fetch('https://licenses.stdout.io/validate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    licenseKey: config.licenseKey,
    email: config.adminEmail 
  })
});

if (!licenseValid.ok) {
  throw new Error('Invalid license key');
}

const { ghcrToken } = await licenseValid.json();
// Use ghcrToken to authenticate Docker pull
```

### Option 2: GitHub PAT (Self-Service)

**Flow:**
1. User purchases StdOut license
2. Receives instructions to:
   - Create GitHub account (if none)
   - Generate PAT with `read:packages` scope for `seayniclabs` org
   - Enter PAT in setup form
3. Installer uses PAT to pull from GHCR

**Pros:**
- No custom license backend needed
- Leverages GitHub's existing auth infrastructure
- Works immediately

**Cons:**
- Poor UX — requires GitHub account + PAT generation (non-trivial for non-developers)
- Can't revoke licenses (PATs are user-controlled)
- Can't track installations
- Security risk if PAT leaked (grants access to all org packages)

### Option 3: Pre-Bundled Images (Download Portal)

**Flow:**
1. User purchases StdOut license
2. Downloads `stdout-bundle.tar.gz` from customer portal (authenticated download)
3. Runs `install.sh --offline` which loads images from tarball

**Pros:**
- No network dependency during install
- Simple to implement (static file hosting + auth)
- Works in air-gapped environments

**Cons:**
- Large download (300-500 MB)
- Must re-download for every update
- No automatic updates
- Requires separate download step before install

### Option 4: Embed License in Image (Deferred Validation)

**Flow:**
1. Images are public on GHCR (anyone can pull)
2. App validates license on first startup
3. Refuses to run without valid license

**Pros:**
- Clean install flow (no licensing friction during setup)
- Can still track/revoke licenses server-side
- Installer stays simple

**Cons:**
- Anyone can pull images (license check is runtime, not pull-time)
- Requires license check in app startup code
- License server downtime blocks new installations

## Recommendation

**Hybrid approach using Options 1, 3, and 4 together.**

This provides multiple install paths for different user scenarios:

### Distribution Model

**Path A: Online Install with License Key (Option 1)**
- Best UX for users with internet
- License key field in setup form
- API validates → grants temporary GHCR token → pulls images
- Post-install: embedded license check (Option 4) validates on every startup

**Path B: Offline/Air-Gapped Install (Option 3)**
- Download authenticated tarball from customer portal
- Run `install.sh --offline` → loads from bundle
- Post-install: embedded license check (Option 4) validates on first startup (requires one-time internet)
- Future startups: cached validation (offline-friendly)

**Path C: Pre-Loaded Install (Option 3 + 4)**
- For truly air-gapped environments
- Download tarball + offline license file from portal
- Installer loads images from tarball
- App validates offline license file (no phone-home required)

### How They Work Together

```
┌─────────────────────────────────────────────┐
│  User purchases StdOut license              │
│  → Receives: License Key + Download Link    │
└─────────────────┬───────────────────────────┘
                  │
        ┌─────────┴─────────┐
        │                   │
    Online?              Offline?
        │                   │
        ▼                   ▼
┌───────────────┐    ┌──────────────────┐
│ Path A        │    │ Path B/C         │
│               │    │                  │
│ Enter license │    │ Download bundle  │
│ key in form   │    │ + offline cert   │
│               │    │                  │
│ Installer     │    │ install.sh       │
│ validates via │    │ --offline        │
│ API → pulls   │    │ → docker load    │
│ from GHCR     │    │                  │
└───────┬───────┘    └────────┬─────────┘
        │                     │
        └──────────┬──────────┘
                   ▼
        ┌─────────────────────┐
        │  Installation Done   │
        │                      │
        │  App validates on    │
        │  every startup:      │
        │  - Online: API call  │
        │  - Offline: local    │
        │    license file      │
        └──────────────────────┘
```

**Why this works:**
1. **Option 1** — Primary path for most users (clean UX)
2. **Option 3** — Handles air-gapped, slow connections, large deployments
3. **Option 4** — Runtime validation catches license expiry, revocation, or tampering
4. **Together** — Cover all installation scenarios while maintaining license control

## Implementation Plan

### Phase 1: Embedded Runtime Validation (Option 4) — Foundation

**Goal:** App refuses to run without valid license, regardless of how it was installed.

**Add to StdOut app startup** (`scripts/start.sh` or equivalent):

```javascript
// src/lib/license.ts
import { readFileSync } from 'fs';
import { createHash } from 'crypto';

interface License {
  key: string;
  email: string;
  issuedAt: number;
  expiresAt?: number;
  signature: string;
}

export async function validateLicense(): Promise<boolean> {
  // Try online validation first
  const onlineValid = await validateOnline();
  if (onlineValid) return true;

  // Fallback to offline license file
  const offlineValid = validateOffline();
  if (offlineValid) return true;

  console.error('[License] No valid license found');
  return false;
}

async function validateOnline(): Promise<boolean> {
  try {
    const licenseKey = process.env.STDOUT_LICENSE_KEY;
    if (!licenseKey) return false;

    const res = await fetch('https://licenses.stdout.io/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: licenseKey }),
      signal: AbortSignal.timeout(5000), // 5s timeout
    });

    if (!res.ok) return false;
    
    const data = await res.json();
    return data.valid === true;
  } catch (err) {
    console.warn('[License] Online validation failed, trying offline:', err.message);
    return false;
  }
}

function validateOffline(): boolean {
  try {
    const licensePath = '/data/stdout.license';
    const licenseContent = readFileSync(licensePath, 'utf8');
    const license: License = JSON.parse(licenseContent);

    // Check expiry
    if (license.expiresAt && Date.now() > license.expiresAt) {
      console.error('[License] License expired');
      return false;
    }

    // Verify signature (HMAC-SHA256 with secret key)
    const payload = `${license.key}:${license.email}:${license.issuedAt}`;
    const expectedSig = createHash('sha256')
      .update(payload + process.env.LICENSE_SIGNING_SECRET)
      .digest('hex');

    if (license.signature !== expectedSig) {
      console.error('[License] Invalid signature');
      return false;
    }

    return true;
  } catch (err) {
    console.warn('[License] Offline validation failed:', err.message);
    return false;
  }
}

// Call at app startup
if (process.env.NODE_ENV === 'production' && !await validateLicense()) {
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('  StdOut License Required');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('  No valid license found.');
  console.error('  Purchase at: https://stdout.io/pricing');
  console.error('  Support: support@stdout.io');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(1);
}
```

**docker-compose.yml additions:**
```yaml
services:
  stdout:
    environment:
      - STDOUT_LICENSE_KEY=${STDOUT_LICENSE_KEY}
      - LICENSE_SIGNING_SECRET=${LICENSE_SIGNING_SECRET}
```

**Behavior:**
- Tries online validation first (5s timeout)
- Falls back to `/data/stdout.license` file if online fails
- Exits with error if neither works
- Production-only (dev mode bypasses check)

### Phase 2: Online Install Path (Option 1)

**Goal:** User enters license key in setup form, installer validates and pulls images.

**Add license field to setup form** (`stdout-setup/public/index.html`):

```html
<form id="setup-form">
  <label for="license-key">License Key</label>
  <input 
    type="text" 
    id="license-key" 
    name="licenseKey" 
    placeholder="STDOUT-XXXX-XXXX-XXXX-XXXX"
    pattern="STDOUT-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}"
    required 
  />
  
  <label for="admin-email">Admin Email</label>
  <input type="email" id="admin-email" name="adminEmail" required />
  
  <!-- ... rest of form ... -->
</form>
```

**Update installer.js to validate license before pulling:**

```javascript
async function executeStep(stepId, config, workDir, events, demoMode = false) {
  switch (stepId) {
    case 1: // Generate Configuration
      // Validate license FIRST
      events.emit('progress', { type: 'output', message: 'Validating license...' });
      const licenseValid = await validateLicenseKey(config.licenseKey, config.adminEmail);
      if (!licenseValid.valid) {
        throw new Error(`License validation failed: ${licenseValid.error}`);
      }
      
      // Store license in config for later
      config.ghcrToken = licenseValid.ghcrToken;
      config.offlineLicense = licenseValid.offlineLicense;
      
      await generateDockerCompose(config, workDir, events);
      break;

    case 2: // Pull Docker Images
      events.emit('progress', { type: 'output', message: 'Authenticating with GitHub Container Registry...' });
      
      // Use temporary GHCR token from license validation
      if (config.ghcrToken) {
        await execFile('docker', ['login', 'ghcr.io', '-u', 'stdout-license', '--password-stdin'], {
          input: config.ghcrToken
        });
      }
      
      // Pull images (now authenticated)
      await execFile('docker', ['pull', 'ghcr.io/seayniclabs/stdout:latest']);
      await execFile('docker', ['pull', 'ghcr.io/seayniclabs/windlass:latest']);
      break;

    case 8: // Finalize Installation
      // Write offline license file for future use
      if (config.offlineLicense) {
        await execFile('docker', ['exec', 'stdout', 'sh', '-c', 
          `echo '${JSON.stringify(config.offlineLicense)}' > /data/stdout.license`
        ]);
      }
      
      // Set license key env var
      await execFile('docker', ['exec', 'stdout', 'node', 'scripts/set-license.js', config.licenseKey]);
      break;
  }
}

async function validateLicenseKey(key, email) {
  try {
    const res = await fetch('https://licenses.stdout.io/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, email }),
    });

    if (!res.ok) {
      const err = await res.json();
      return { valid: false, error: err.message };
    }

    const data = await res.json();
    return {
      valid: true,
      ghcrToken: data.ghcrToken,        // Temporary token for pulling
      offlineLicense: data.offlineLicense, // Signed license file
    };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}
```

**License validation API response:**
```json
{
  "valid": true,
  "ghcrToken": "ghp_xxxTemporaryTokenxxx",
  "offlineLicense": {
    "key": "STDOUT-1234-5678-ABCD-EFGH",
    "email": "user@example.com",
    "issuedAt": 1717891200000,
    "expiresAt": null,
    "signature": "abc123...def456"
  }
}
```

### Phase 3: Offline Install Path (Option 3)

**Goal:** User downloads bundle, runs install with --offline flag.

## Phase 1 Implementation (Pre-Bundled Images)

### 1. Create image bundle script

```bash
#!/bin/bash
# save-images.sh
docker pull ghcr.io/seayniclabs/stdout:latest
docker pull ghcr.io/seayniclabs/windlass:latest  
docker pull ghcr.io/charlieseay/stdout-setup:latest

docker save \
  ghcr.io/seayniclabs/stdout:latest \
  ghcr.io/seayniclabs/windlass:latest \
  ghcr.io/charlieseay/stdout-setup:latest \
  -o stdout-bundle.tar

gzip stdout-bundle.tar
echo "Created stdout-bundle.tar.gz ($(du -h stdout-bundle.tar.gz | cut -f1))"
```

### 2. Update install.sh to support --offline mode

```bash
#!/bin/bash
# install.sh with offline support

set -e

OFFLINE_MODE=false
BUNDLE_PATH="stdout-bundle.tar.gz"
LICENSE_FILE="stdout.license"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --offline)
      OFFLINE_MODE=true
      shift
      ;;
    --bundle)
      BUNDLE_PATH="$2"
      shift 2
      ;;
    --license)
      LICENSE_FILE="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

if [[ "$OFFLINE_MODE" == "true" ]]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  StdOut Offline Installation"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  # Validate bundle exists
  if [[ ! -f "$BUNDLE_PATH" ]]; then
    echo "❌ Error: Bundle not found at $BUNDLE_PATH"
    echo ""
    echo "Download bundle from: https://stdout.io/download"
    echo "(Requires valid StdOut license)"
    exit 1
  fi
  
  # Validate license file exists
  if [[ ! -f "$LICENSE_FILE" ]]; then
    echo "❌ Error: License file not found at $LICENSE_FILE"
    echo ""
    echo "Download your license file from your purchase email"
    echo "or from: https://stdout.io/licenses"
    exit 1
  fi
  
  echo "✓ Found bundle: $BUNDLE_PATH ($(du -h "$BUNDLE_PATH" | cut -f1))"
  echo "✓ Found license: $LICENSE_FILE"
  echo ""
  echo "Loading Docker images..."
  
  # Load images from bundle
  gunzip -c "$BUNDLE_PATH" | docker load
  
  echo "✓ Images loaded"
  echo ""
  
  # Start setup server with offline flag
  docker run -d \
    --name stdout-setup \
    -p 8888:8888 \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$(pwd)/$LICENSE_FILE:/app/stdout.license:ro" \
    -e OFFLINE_MODE=true \
    ghcr.io/charlieseay/stdout-setup:latest
else
  # Normal online flow
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  StdOut Installation"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  # Pull setup server from GHCR
  docker pull ghcr.io/charlieseay/stdout-setup:latest
  
  # Start setup server
  docker run -d \
    --name stdout-setup \
    -p 8888:8888 \
    -v /var/run/docker.sock:/var/run/docker.sock \
    ghcr.io/charlieseay/stdout-setup:latest
fi

# Common flow from here
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✓ Setup Server Running!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Open in your browser:"
echo "  → http://stdout.local:8888"
echo "  → http://$(hostname -I | awk '{print $1}'):8888"
echo ""
```

**Offline install usage:**
```bash
# Download bundle and license from customer portal
# Then run:
./install.sh --offline --bundle stdout-bundle.tar.gz --license stdout.license
```

### 3. Distribution

Host `stdout-bundle.tar.gz` behind authenticated download:
- Stripe-generated download link (expires after 24h)
- Or: Simple password-protected download page
- Or: Email delivery with magic link

## Phase 2 Implementation (License API)

TBD — design license validation service, integrate with Stripe, add license key field to setup form.

## Current Blocker

Cannot push to `ghcr.io/seayniclabs/*` namespace — getting "403 Forbidden" errors. Need to:
1. Verify GitHub org package permissions
2. Add PAT with `write:packages` scope for `seayniclabs` org
3. OR: Use `charlieseay` namespace temporarily for testing

### 3. Update installer to handle offline license

**In `stdout-setup/installer.js`:**

```javascript
async function executeStep(stepId, config, workDir, events, demoMode = false) {
  const OFFLINE_MODE = process.env.OFFLINE_MODE === 'true';
  
  switch (stepId) {
    case 1: // Generate Configuration
      if (OFFLINE_MODE) {
        // Read pre-downloaded license file
        const licenseContent = await readFile('/app/stdout.license', 'utf8');
        config.offlineLicense = JSON.parse(licenseContent);
        
        events.emit('progress', { 
          type: 'output', 
          message: `License validated offline: ${config.offlineLicense.email}` 
        });
      } else {
        // Online validation
        const licenseValid = await validateLicenseKey(config.licenseKey, config.adminEmail);
        if (!licenseValid.valid) {
          throw new Error(`License validation failed: ${licenseValid.error}`);
        }
        config.ghcrToken = licenseValid.ghcrToken;
        config.offlineLicense = licenseValid.offlineLicense;
      }
      
      await generateDockerCompose(config, workDir, events);
      break;

    case 2: // Pull Docker Images
      if (OFFLINE_MODE) {
        events.emit('progress', { 
          type: 'output', 
          message: 'Using pre-loaded images (offline mode)' 
        });
        // Skip pull - images already loaded via docker load
      } else {
        // Normal pull flow
        events.emit('progress', { type: 'output', message: 'Pulling from GHCR...' });
        await execFile('docker', ['login', 'ghcr.io', '-u', 'stdout', '--password-stdin'], {
          input: config.ghcrToken
        });
        await execFile('docker', ['pull', 'ghcr.io/seayniclabs/stdout:latest']);
        await execFile('docker', ['pull', 'ghcr.io/seayniclabs/windlass:latest']);
      }
      break;
  }
}
```

### 4. License Generation Tool (Backend)

**Server-side script to generate signed licenses:**

```javascript
// generate-license.js
import { createHash, randomBytes } from 'crypto';
import { writeFileSync } from 'fs';

function generateLicense(email, expiresAt = null) {
  const key = `STDOUT-${randomSegment()}-${randomSegment()}-${randomSegment()}-${randomSegment()}`;
  const issuedAt = Date.now();
  
  const payload = `${key}:${email}:${issuedAt}`;
  const signature = createHash('sha256')
    .update(payload + process.env.LICENSE_SIGNING_SECRET)
    .digest('hex');
  
  const license = {
    key,
    email,
    issuedAt,
    expiresAt,
    signature,
  };
  
  return license;
}

function randomSegment() {
  return randomBytes(2).toString('hex').toUpperCase();
}

// Usage:
const license = generateLicense('customer@example.com');
writeFileSync('stdout.license', JSON.stringify(license, null, 2));
console.log('License key:', license.key);
```

## Implementation Timeline

### Week 1: Foundation (Phase 1 - Runtime Validation)
- [ ] Add `src/lib/license.ts` to StdOut app
- [ ] Integrate license check into app startup
- [ ] Add `scripts/set-license.js` helper
- [ ] Test license validation (online + offline)
- [ ] Add error messages and exit codes

### Week 2: Online Install (Phase 2 - License API)
- [ ] Build license validation API endpoint
- [ ] Integrate with Stripe for license generation
- [ ] Add license key field to setup form
- [ ] Update installer.js to validate before pulling
- [ ] Generate temporary GHCR tokens server-side
- [ ] Test end-to-end online install flow

### Week 3: Offline Install (Phase 3 - Bundles)
- [ ] Create `save-images.sh` script
- [ ] Update `install.sh` with --offline flag
- [ ] Test offline install with bundle
- [ ] Build customer download portal
- [ ] Integrate bundle generation with Stripe webhook
- [ ] Email delivery automation

### Week 4: Polish & Documentation
- [ ] Update INSTALL.md with all three paths
- [ ] Create troubleshooting guide
- [ ] License FAQ page
- [ ] Support runbook for license issues
- [ ] Monitoring/alerting for license server

## License Server Architecture

```
┌──────────────────────────────────────────────┐
│  licenses.stdout.io (API)                    │
│                                              │
│  POST /activate                              │
│    Input: { key, email }                     │
│    Output: { ghcrToken, offlineLicense }     │
│                                              │
│  POST /validate                              │
│    Input: { key }                            │
│    Output: { valid: boolean }               │
│                                              │
│  Database:                                   │
│    - licenses (key, email, stripe_id, ...)  │
│    - activations (key, ip, timestamp)       │
│    - ghcr_tokens (token, expires_at)        │
└──────────────────────────────────────────────┘
```

**Tech stack options:**
- **Simple:** Cloudflare Workers + D1 (SQLite) + KV (token cache)
- **Traditional:** Node.js + PostgreSQL + Redis
- **Serverless:** AWS Lambda + DynamoDB + API Gateway

## Security Considerations

1. **License Key Format**
   - `STDOUT-XXXX-XXXX-XXXX-XXXX` (20 chars entropy)
   - Prevents brute-force guessing
   - Easy to read/type

2. **Signature Validation**
   - HMAC-SHA256 with server-side secret
   - Prevents tampering with license files
   - Secret rotated quarterly

3. **GHCR Token Lifetime**
   - 1-hour expiration
   - Single-use (invalidated after pull)
   - Scoped to read:packages only

4. **Rate Limiting**
   - 5 activation attempts per key per hour
   - 100 validation requests per IP per hour
   - Prevents abuse/scraping

5. **Revocation**
   - Server-side license blacklist
   - Online validation checks blacklist
   - Offline licenses cached for 30 days

## Next Steps

1. ✅ **System requirements documented** (AMD64, ARM64, Raspberry Pi)
2. ✅ **Multi-arch build guide created** (BUILD.md)
3. ✅ **License strategy designed** (hybrid Options 1+3+4)
4. ⏳ **Test to 100% completion** (transfer image to ThinkPad)
5. ⏳ **Implement Phase 1** (runtime license validation)
6. ⏳ **Build license validation API** (Phase 2)
7. ⏳ **Create offline bundle system** (Phase 3)
