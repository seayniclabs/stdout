# StdOut Cycle 1: Issues to Fix

**Time:** 09:36-10:00 AM (24 minutes)  
**Status:** Testing complete, moving to fixes

---

## ✅ What Works (No Fixes Needed)

1. **Installation** - Fast (<60s), clean, reliable
2. **Setup wizard** - Single-page, auto-generates defaults
3. **Infrastructure discovery** - Automatic, works immediately
4. **Incident creation** - Form works, data persists correctly
5. **Dashboard UX** - Professional, polished, intuitive
6. **Performance** - Excellent (instant loads, fast startup)

---

## 🔴 CRITICAL FIXES (Blocks Customer Install)

### 1. Create Customer-Ready docker-compose.yml
**File:** `docker-compose.customer.yml` (new file)  
**Issue:** Current docker-compose.yml uses `build: .` which requires source code  
**Impact:** Customers cannot install without cloning entire repo  
**Fix:**
```yaml
services:
  stdout:
    image: charlieseay/stdout:latest  # Changed from build: .
    container_name: stdout
    restart: unless-stopped
    ports:
      - "8112:3000"
    volumes:
      - ./data:/app/data  # Changed from absolute path
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - TZ=${TZ:-America/Chicago}
      - STDOUT_MODE=${STDOUT_MODE:-selfhost}
      - DB_PATH=${DB_PATH:-/app/data/stdout.db}
      - APP_URL=${APP_URL:-http://localhost:8112}
      - SECRET_KEY=${SECRET_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
      - RESEND_API_KEY=${RESEND_API_KEY:-}
      - WINDLASS_URL=${WINDLASS_URL:-http://windlass:8116}
      - OLLAMA_URL=${OLLAMA_URL:-http://172.17.0.1:11434}
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    networks:
      - stdout-net

  windlass:
    image: charlieseay/windlass:latest  # Changed from build
    container_name: windlass
    restart: unless-stopped
    ports:
      - "8116:8116"
    volumes:
      - ./windlass-config:/opt/windlass
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - TZ=${TZ:-America/Chicago}
      - WINDLASS_CONFIG=/opt/windlass
      - WINDLASS_INTERVAL=${WINDLASS_INTERVAL:-300}
      - STDOUT_URL=http://stdout:3000
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8116/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
    networks:
      - stdout-net

networks:
  stdout-net:
    driver: bridge
    ipam:
      config:
        - subnet: 10.21.0.0/24
```

**Also update .env.example** to be more customer-friendly:
```bash
# StdOut Self-Hosted Configuration
# Copy this file: cp .env.example .env

# Your public URL (change localhost to your server IP/domain)
APP_URL=http://localhost:8112

# Generate with: openssl rand -hex 32
SECRET_KEY=

# Database path (leave as default)
DB_PATH=/app/data/stdout.db

# Timezone
TZ=America/Chicago

# Optional: AI features (leave empty to skip)
ANTHROPIC_API_KEY=
RESEND_API_KEY=
```

---

## 🟡 HIGH PRIORITY (UX Issues)

### 2. Update README.md
**File:** `README.md`  
**Lines to change:**

Line 80-86 (Setup Wizard section):
```markdown
### Setup Wizard (1 step)  # Changed from "3 steps"

1. Open http://localhost:8112
2. Fill in admin account details and license key
3. Click "Install StdOut"

That's it. You're running StdOut.
```

Line 43-58 (Quick Start section):
```markdown
## Quick Start (2 Minutes)

### Option A: Docker Compose (Recommended)

```bash
# Download files
curl -O https://raw.githubusercontent.com/seayniclabs/stdout/main/docker-compose.customer.yml
curl -O https://raw.githubusercontent.com/seayniclabs/stdout/main/.env.example
mv docker-compose.customer.yml docker-compose.yml
cp .env.example .env

# Edit .env - set APP_URL and SECRET_KEY
nano .env

# Start StdOut + Windlass
docker compose up -d

# Open browser and complete 1-step setup
open http://localhost:8112
```
```

### 3. Add Password Validation Feedback
**File:** `src/pages/setup/index.astro`  
**Lines:** Around line 40-46

Add validation state and error message:
```typescript
let passwordError = '';

// In the POST handler, after password check:
} else if (password.length < 8) {
  error = 'Password must be at least 8 characters.';
  passwordError = 'Minimum 8 characters required';
```

In the HTML (around line 206):
```html
<label>
  <span>Password</span>
  <input
    type="password"
    name="password"
    placeholder="At least 8 characters"
    required
    autocomplete="new-password"
    minlength="8"
    aria-invalid={passwordError ? 'true' : 'false'}
  />
  {passwordError && <span class="error-message">{passwordError}</span>}
</label>

<style>
  .error-message {
    color: var(--color-error);
    font-size: 0.875rem;
    margin-top: 0.25rem;
    display: block;
  }
</style>
```

### 4. Add Post-Install Welcome Modal
**File:** `src/pages/setup/index.astro`  
**After successful setup** (around line 160):

Instead of silent redirect, show a modal first:
```typescript
// After license validation success:
const setupComplete = {
  message: 'StdOut is ready!',
  nextSteps: [
    'Infrastructure discovery is running in the background',
    'Visit Infrastructure to see discovered hosts',
    'Create your first incident or browse the knowledge base',
  ]
};

// Redirect with a query param
return new Response(null, {
  status: 302,
  headers: {
    'Location': '/app?setup=complete',
    'Set-Cookie': cookieValue
  }
});
```

Then in `/app/index.astro`, detect `?setup=complete` and show a toast:
```typescript
const showWelcome = Astro.url.searchParams.get('setup') === 'complete';
```

```html
{showWelcome && (
  <div class="welcome-toast" role="alert">
    <h3>✓ Installation Complete!</h3>
    <p>StdOut is now monitoring your infrastructure.</p>
    <ul>
      <li>Discovery is running in the background</li>
      <li>Visit <a href="/app/infrastructure">Infrastructure</a> to see hosts</li>
      <li>Check the <a href="/docs">Knowledge Base</a> for runbooks</li>
    </ul>
    <button onclick="this.parentElement.remove()">Got it</button>
  </div>
)}
```

---

## 🟢 NICE TO HAVE (Future)

### 5. Add Dashboard Screenshot to Product Page
**File:** `stdout-site` repo (separate project)  
**Action:** Capture screenshot of working dashboard, add to hero section

### 6. Create Purchase Confirmation Email Template
**File:** New file `PURCHASE-EMAIL-TEMPLATE.md`  
**Content:**
```markdown
# StdOut Self-Hosted - Order Confirmation

Thank you for purchasing StdOut Self-Hosted Edition!

## Your License Key

`SL-XXXX-XXXX-XXXX-XXXX`

Keep this safe - you'll need it during installation.

## Installation Files

Download these files to get started:
- [docker-compose.yml](https://raw.githubusercontent.com/seayniclabs/stdout/main/docker-compose.customer.yml)
- [.env.example](https://raw.githubusercontent.com/seayniclabs/stdout/main/.env.example)

## Quick Start

1. Save the files above
2. Copy `.env.example` to `.env`
3. Edit `.env` and set your `APP_URL` and `SECRET_KEY`
4. Run: `docker compose up -d`
5. Open http://your-server-ip:8112
6. Complete the setup wizard with your license key above

Full documentation: https://github.com/seayniclabs/stdout

## Support

Questions? Email hello@seayniclabs.com

---
Seaynic Labs LLC
```

### 7. Document Backup/Restore
**File:** `docs/BACKUP-RESTORE.md` (new)  
**Content:** SQLite backup procedures, data migration guide

---

## 🔧 Implementation Plan

### Batch 1: Critical (30 minutes)
1. Create `docker-compose.customer.yml` (5 min)
2. Update `.env.example` (5 min)
3. Update README.md Quick Start section (10 min)
4. Update README.md Setup Wizard section (5 min)
5. Test clean install with new files (5 min)

### Batch 2: UX Improvements (30 minutes)
6. Add password validation feedback (10 min)
7. Add post-install welcome toast (15 min)
8. Test both changes (5 min)

### Batch 3: Rebuild & Deploy (15 minutes)
9. Rebuild Docker image with fixes (10 min)
10. Push to Docker Hub (5 min)

### Batch 4: Clean Install Test (15 minutes)
11. Wipe ThinkPad data
12. Run complete install with new files
13. Validate all fixes work
14. Document results

**Total estimated time:** 90 minutes

---

## Test Results Summary

| Feature | Status | Notes |
|---------|--------|-------|
| Installation | ✅ PASS | <60s, clean |
| Setup wizard | ✅ PASS | Single page, works perfectly |
| Password validation | ⚠️ MINOR | No error message shown |
| Infrastructure discovery | ✅ PASS | 4 containers found |
| Incident creation | ✅ PASS | Form works, data persists |
| Dashboard | ✅ PASS | Professional UI |
| Riggins panel | ✅ PASS | Visible, welcoming |
| Navigation | ✅ PASS | Intuitive |
| Performance | ✅ PASS | Excellent |

**Overall:** 9/10 features working perfectly, 1 minor UX issue

---

**Next Action:** Implement Batch 1 fixes (critical path items)
