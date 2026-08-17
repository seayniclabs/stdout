# Device Classification & Hierarchical Topology Verification

**Deployed:** 2026-08-17  
**Target:** ThinkPad (192.168.68.89:8112)

## What Was Deployed

### 1. Enhanced Device Classifier
**File:** `src/lib/observatory/workers/enhanced-classifier.ts`

**Features:**
- 12 device types: router, gateway, switch, nas, printer, iot, server, docker-host, docker-container, workstation, mobile, unknown
- Confidence scoring (0.0 - 1.0)
- Multi-factor classification:
  - IP address patterns (.1 = gateway)
  - Hostname patterns (router, switch, nas, etc.)
  - MAC vendor OUI lookup (Ubiquiti, Cisco, Synology, etc.)
  - Open ports (22=SSH, 445=SMB, 9100=printer, 2375=Docker)
  - Service detection (mysql, postgresql, docker, etc.)
  - OS fingerprinting

### 2. nmap Capability Fix
**File:** `src/lib/observatory/workers/device-profiler.ts`

**Change:** Added `-sT` flag to nmap command for TCP connect scanning (doesn't require NET_RAW capability)

```typescript
// Before:
`nmap -sV -T4 --top-ports 100 ${ip} 2>/dev/null`

// After:
`nmap -sT -sV -T4 --top-ports 100 ${ip} 2>/dev/null`
```

### 3. Hierarchical Topology Map
**File:** `src/components/HierarchicalTopologyMap.astro`

**Features:**
- 5-layer stratification (edge → infrastructure → servers → containers → devices)
- Y-axis positioning by device type
- Color-coded nodes (orange=gateway, purple=infrastructure, blue=server, green=container, gray=device)
- Link types: backbone (orange, 2px), access (gray, 1px), virtual (green, 1px dashed)
- Node sizing by importance (router=16px, server=12px, container=10px)
- Interactive: zoom, pan, drag nodes
- Download SVG button
- Legend

## Current State

**Status:** ✅ Deployed, ⏸️ Awaiting Setup Completion

The container is running but the app is in setup mode. Discovery won't run until the first user completes setup and logs in.

**Setup requirement:** Valid license key (use `SL-DEV-TESTING-123` for development)

## Verification Steps

### Step 1: Complete Setup

1. Navigate to http://192.168.68.89:8112/setup
2. Fill in:
   - Display Name: `Charlie Seay`
   - Email: `charlie@seayniclabs.com`
   - Password: `password123`
   - License Key: `SL-DEV-TESTING-123`
3. Click "Install StdOut"

### Step 2: Wait for First Discovery Run

Discovery runs every 5 minutes. After setup, wait 5 minutes and then:

```bash
ssh thinkpad 'docker logs stdout 2>&1 | grep -A 5 "Profiler\|Classifier" | tail -30'
```

Expected output:
```
[Profiler] 192.168.68.1 → router (95% confidence)
[Profiler] 192.168.68.80 → docker-host (90% confidence)
[Profiler] 10.21.0.2 → docker-container (100% confidence)
```

### Step 3: Check Discovery Tab

1. Navigate to http://192.168.68.89:8112/app/infrastructure
2. Click "Discovery" tab
3. Verify devices show device types instead of "AUTO-FOUND":
   - `_gateway` should be `ROUTER` or `GATEWAY`
   - Docker containers should be `DOCKER-CONTAINER`
   - Network hosts should be classified (SERVER, WORKSTATION, IOT, etc.)

### Step 4: Check Topology Map

1. Click "Topology Map" tab
2. Verify hierarchical layout:
   - Gateway at top (large orange node)
   - Infrastructure layer below (purple nodes)
   - Server layer in middle (blue nodes)
   - Container layer near bottom (green nodes)
   - Device layer at bottom (gray nodes)
3. Verify nodes are stratified by Y-axis (not bouncing randomly)
4. Verify link colors: orange (backbone), gray (access), green dashed (virtual)

## Expected Results

**Before this deployment:**
- All devices showed "AUTO-FOUND" with no classification
- nmap scans failed due to missing NET_RAW capability
- Topology map was a random "bouncing balls" force-directed graph

**After this deployment:**
- Devices auto-classify on discovery with 12 device types
- nmap scans work (TCP connect mode)
- Topology map shows proper hierarchical infrastructure diagram

## Troubleshooting

### Devices Still Show "AUTO-FOUND"
```bash
# Check if discovery has run since deployment
ssh thinkpad 'docker logs stdout 2>&1 | grep "RIGGINS DISCOVERY COMPLETE" | tail -5'

# Manually trigger discovery (if API is accessible)
curl -X POST http://192.168.68.89:8112/api/observatory/discover
```

### nmap Still Failing
```bash
# Check nmap is installed
ssh thinkpad 'docker exec stdout which nmap'

# Check nmap command in logs
ssh thinkpad 'docker logs stdout 2>&1 | grep "nmap -sT"'
```

### Topology Map Not Hierarchical
```bash
# Verify HierarchicalTopologyMap component is loaded
ssh thinkpad 'docker exec stdout cat /app/dist/pages/app/infrastructure.astro' | grep -i hierarchical
```

## Files Changed

1. `src/lib/observatory/workers/enhanced-classifier.ts` (NEW)
2. `src/lib/observatory/workers/device-profiler.ts` (MODIFIED - line 86, 130-150)
3. `src/components/HierarchicalTopologyMap.astro` (NEW)
4. `src/pages/app/infrastructure.astro` (MODIFIED - import changed)

## Deployment Date

**Deployed:** 2026-08-17 11:51 AM CT  
**Container:** stdout:latest (rebuilt with new code)  
**Host:** ThinkPad (192.168.68.89)  
**Method:** `docker compose down` → rsync code → `docker compose build` → `docker compose up -d`

## Next Steps After Verification

Once verified working:

1. **Capture lesson:** Device classification implementation (classifier patterns, nmap capabilities, hierarchical layout)
2. **Update StdOut HANDOFF:** Mark device classification feature as complete
3. **Regression test:** Add to regression test suite (verify classifier assigns correct types)
4. **Checkpoint:** Commit all changes to git

## Known Limitations

1. **Existing devices won't reclassify until next discovery run** - devices discovered before enhanced classifier was deployed keep their old type until rediscovered
2. **nmap requires network access** - containers in isolated networks won't get port scans
3. **Classification confidence varies** - devices without ports/hostnames may classify as "unknown"
4. **Hierarchical layout is heuristic** - server-container links assume same subnet = hosted-on relationship
