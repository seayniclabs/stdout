# Network Discovery Implementation - 2026-06-17

## Completed This Session

### 1. Comprehensive Network Discovery System ✅

Created Fing-level device discovery with multiple signal sources:

**Files Created:**
- `src/lib/discovery/mdns-scanner.ts` - mDNS/Bonjour discovery for Apple devices, printers, smart speakers
- `src/lib/discovery/ssdp-scanner.ts` - SSDP/UPnP discovery for Smart TVs, media players, streaming devices
- `src/lib/discovery/mac-vendor.ts` - MAC address vendor lookup via macvendors.com API with local cache
- `src/lib/discovery/device-profiler.ts` - Multi-signal device classification and profiling
- `src/lib/discovery/network-scanner.ts` - Orchestration layer for comprehensive network scans
- `src/pages/app/api/discovery/scan.ts` - API endpoint to trigger discovery and create monitors/entities

**Discovery Capabilities:**
- **ARP scanning** - Base network host discovery
- **mDNS/Bonjour** - Apple devices (HomePod, Apple TV, AirPlay), printers, SSH servers, file servers
- **SSDP/UPnP** - Smart TVs (Roku, Samsung, LG, Sony), Chromecast, Fire TV, gaming consoles, routers
- **MAC vendor lookup** - Device manufacturer identification with local cache for common vendors
- **Port-based heuristics** - Service classification from open ports
- **Multi-signal profiling** - Combines all signals with confidence scoring (high/medium/low)

**Device Types Detected:**
- Smart TVs, streaming devices, gaming consoles
- Smart home devices (Philips Hue, Ring, Nest, Echo, Google Home)
- Printers and scanners
- Network infrastructure (routers, switches, access points)
- Servers (web, file, database, media)
- Apple devices, Samsung devices, Sony devices
- IoT devices, smart speakers, IP cameras

### 2. Entity Graph Database ✅

Added relational entity tracking to database schema:

**Tables Added:**
```sql
-- entities: JSON-based node structure for devices/services
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL, -- host, container, service, network, switch, router, device
  name TEXT NOT NULL,
  properties TEXT, -- JSON blob: {ip, mac, hostname, vendor, deviceType, confidence, metadata, signals}
  discovered_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- entity_relationships: edges in the graph
CREATE TABLE entity_relationships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_id TEXT NOT NULL, -- FK to entities.id
  target_id TEXT NOT NULL, -- FK to entities.id
  type TEXT NOT NULL, -- runs_on, connects_to, depends_on, part_of, serves
  metadata TEXT, -- JSON: {port, protocol, bandwidth, etc.}
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**Query Capabilities:**
- Find all services running on a specific device
- Map network paths between entities
- List all devices of a specific type
- Show dependency chains for services
- Topology traversal for visualization

### 3. Infrastructure Card Summary Stats ✅

Enhanced stack cards to show comprehensive metrics:

**New Fields:**
- **Device Count** - Number of discovered network devices
- **Service Count** - Number of monitored services
- **Health Percentage** - Overall service health (green ≥90%, yellow ≥70%, red <70%)
- **Last Scan Time** - Time of most recent discovery scan

**Visual Improvements:**
- Summary stats row with labeled metrics
- Color-coded health badges
- Tooltips for clarity
- Responsive grid layout

### 4. Auto-Resolution Already Implemented ✅

Verified existing auto-resolution logic in `src/lib/hud.ts:460-504`:

**How It Works:**
1. Monitor transitions from `down` to `healthy`
2. Finds most recent auto-created incident for that monitor
3. Calculates downtime duration
4. Creates resolution record with downtime stats
5. Marks incident as `resolved`
6. Fires recovery notification

**Resolution Format:**
```
Service recovered automatically.

**Downtime:** 15m
**Recovered at:** 2026-06-17T11:15:00.000Z

*Auto-resolved by HUD monitor.*
```

## API Endpoints

### POST /app/api/discovery/scan

Triggers comprehensive network discovery.

**Request Body:**
```json
{
  "arpScan": true,          // Enable ARP scanning
  "mdnsScan": true,         // Enable mDNS/Bonjour
  "ssdpScan": true,         // Enable SSDP/UPnP
  "vendorLookup": true,     // Enable MAC vendor lookups
  "timeout": 10,            // Discovery timeout in seconds
  "createEntities": true,   // Populate entity graph
  "createMonitors": true    // Auto-create ping monitors
}
```

**Response:**
```json
{
  "success": true,
  "devicesFound": 42,
  "entitiesCreated": 38,
  "monitorsCreated": 42,
  "deviceBreakdown": {
    "high_confidence": 15,
    "medium_confidence": 20,
    "low_confidence": 7
  },
  "devices": [
    {
      "ip": "192.168.1.100",
      "name": "Apple TV",
      "type": "smart-tv",
      "vendor": "Apple, Inc.",
      "confidence": "high"
    }
  ]
}
```

## Critical Gaps Remaining

From [CRITICAL-GAPS-2026-06-17.md](Projects/StdOut/CRITICAL-GAPS-2026-06-17.md):

### 1. Network Topology Visualization ❌

**Status:** Not implemented - requires dashmotion integration

**Required:**
- Use dashmotion skill (https://github.com/csthink/dashmotion) to generate animated SVG network diagrams
- Show devices → switches → services with live connections
- Interactive: click node → details panel
- Auto-layout with force-directed graph or hierarchical
- Color-coded by health status (green/yellow/red)
- Export as PNG/SVG for reports

**UI Location:**
- New page: `/app/network-map`
- Link from Infrastructure page
- Embed in Dashboard (mini view)

**Implementation:**
```typescript
// POST /app/api/visualization/network-map
// Returns SVG visualization of entire network topology
```

### 2. Setup Animation + License Validation ❌

**Status:** Partially working - animation missing, license validation needs verification

**Required:**
- Animated progress during setup (scanning → analyzing → configuring)
- Step indicators (1/5, 2/5, etc.)
- Real-time log stream via SSE
- Success animation on completion
- Ed25519 signature validation on startup
- Show activation status in Settings
- Display edition (Free/Pro/Enterprise) + expiry date

**Files to Fix:**
- `src/pages/setup.astro` - Add progress animation
- `src/lib/license.ts` - Verify signature validation works
- `src/pages/app/settings.astro` - Show license status

### 3. Windlass Configuration ❌

**Status:** Container running but StdOut shows "not configured"

**Required:**
- Auto-detect Windlass on localhost:8116
- Sync n8n workflow schedules
- Show synced services on Dashboard
- Enable/disable schedules from StdOut UI

**Files to Fix:**
- `src/lib/windlass.ts` - Add auto-detection
- Check why config not persisting
- Verify `/app/api/tools/windlass/sync` endpoint works

### 4. Observatory Toolset Not Exposed ❌

**Status:** Tools exist in containers (tshark, nmap, tcpdump) but not accessible from UI

**Required:**
- API endpoints to run tools:
  - `/app/api/observatory/tools/packet-capture`
  - `/app/api/observatory/tools/port-scan`
  - `/app/api/observatory/tools/dns-lookup`
- UI page: Tools → Network Analysis
- Watcher can invoke via tool calls

**Files to Create:**
- `src/pages/app/observatory/tools.astro` - Tools UI
- `src/pages/app/api/observatory/tools/[tool].ts` - Proxy to containers

### 5. Monitor Creation Incomplete ❌

**Status:** 9 monitors created from 10 containers, 42 discovered hosts but NO ping monitors created

**Issue:** `syncHostMonitors()` has a bug - not being called correctly or not creating monitors

**Debug Steps:**
1. Check if `/app/api/discovery/scan` is actually calling `syncHostMonitors`
2. Verify discovered_hosts table has 42 rows
3. Test `syncHostMonitors` directly with known host data
4. Check for SQL errors in logs

**Expected Result:** 50+ monitors total (containers + hosts + services)

### 6. Full E2E Testing ❌

**Status:** Not done - requires systematic verification of all features

**Checklist:**
- [ ] Setup wizard works from fresh install
- [ ] Network discovery finds all devices (TVs, IoT, smart devices)
- [ ] Device classification accurate
- [ ] Monitors auto-create for all discovered entities
- [ ] Monitors start and run checks
- [ ] Incidents created on failure
- [ ] Incidents auto-resolve on recovery
- [ ] Observatory Watcher running 24/7
- [ ] Observatory tools accessible
- [ ] Windlass auto-configured and synced
- [ ] Infrastructure cards show correct stats
- [ ] Network topology map renders
- [ ] Entity graph queryable

## Priority Order for Next Session

1. **Fix Monitor Creation Bug** (30 min) - Why aren't 42 hosts getting ping monitors?
2. **Windlass Auto-Configuration** (1 hour) - Auto-detect + sync + persistence
3. **Network Topology Visualization** (2-3 hours) - dashmotion integration
4. **Observatory Tools UI** (2 hours) - Expose tshark/nmap/tcpdump
5. **Setup Animation** (1-2 hours) - Progress indicators + streaming logs
6. **Full E2E Test** (2-3 hours) - Systematic verification

## Estimated Remaining Work

- **Monitor creation fix:** 30 min
- **Windlass integration:** 1-2 hours
- **Topology visualization:** 2-3 hours
- **Observatory tools:** 2 hours
- **Setup polish:** 1-2 hours
- **E2E testing:** 2-3 hours

**Total:** 9-13 hours remaining (1-2 sessions)

## Session Token Usage

- **Start:** ~67K tokens
- **Current:** ~105K tokens
- **Remaining:** ~95K tokens

Safe to continue with monitor creation bug fix and Windlass integration in this session.

## Next Immediate Action

Debug why `syncHostMonitors()` is not creating ping monitors for the 42 discovered hosts:

```bash
# Check discovered_hosts count
docker compose exec stdout sqlite3 /data/stdout.db \
  "SELECT COUNT(*) FROM discovered_hosts WHERE user_id = (SELECT id FROM users LIMIT 1);"

# Check existing monitors
docker compose exec stdout sqlite3 /data/stdout.db \
  "SELECT COUNT(*) FROM monitors WHERE user_id = (SELECT id FROM users LIMIT 1) AND type = 'ping';"

# Test discovery scan API
curl -X POST http://localhost:8112/app/api/discovery/scan \
  -H "Content-Type: application/json" \
  -d '{"timeout": 10, "createMonitors": true}'
```
