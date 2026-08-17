# Regression Test Suite - 2026-08-17

**Purpose:** Automated regression tests for all 6 bugs found during systematic testing session

**Environment:** ThinkPad 192.168.68.89:8112  
**Test User:** charlie@seayniclabs.com / test1234

**How to run:** Ask Claude Code to execute this test suite using Chrome DevTools MCP

## Test Cases

### Bug #1: Infrastructure page HTTP 500 error
- **Root cause:** TopologyMap component querying non-existent discovered_hosts table
- **Fix:** Added table existence check + try/catch error handling (444557b)
- **Test:**
  1. Navigate to http://192.168.68.89:8112/app/infrastructure
  2. Verify page loads (HTTP 200, not 500)
  3. Verify "Infrastructure" heading present
  4. Verify no error messages visible

### Bug #2: Network Discovery saving 0 hosts
- **Root cause:** Missing schema columns
- **Fix:** Added device_type, open_ports, services, os_guess, discovered_at columns (da83f7a)
- **Test:**
  1. Navigate to http://192.168.68.89:8112/app/infrastructure
  2. Verify discovered hosts are displayed (if any exist)
  3. Click first host card
  4. Verify device detail page loads with network information

### Bug #3: Topology Map blank/not rendering
- **Root cause:** CSP blocking d3js.org CDN
- **Fix:** Changed D3 CDN to cdn.jsdelivr.net (96ae437)
- **Test:**
  1. Navigate to http://192.168.68.89:8112/app/infrastructure
  2. Monitor console for CSP errors
  3. Verify topology map renders (SVG present OR empty state message)
  4. Verify no "violates CSP directive" errors

### Bug #4: Stack timestamps showing year 58597
- **Root cause:** Drizzle `{ mode: 'timestamp' }` expects seconds, we stored milliseconds
- **Fix:** Changed to `{ mode: 'timestamp_ms' }` (498db58)
- **Test:**
  1. Navigate to http://192.168.68.89:8112/app/stacks
  2. Click any stack
  3. Find "Updated" timestamp
  4. Verify year is 2020-2030 range (NOT 58597)

### Bug #5: Host timestamps "Last seen Invalid Date"
- **Root cause:** Same as Bug #4
- **Fix:** Same schema change (498db58)
- **Test:**
  1. Navigate to http://192.168.68.89:8112/app/infrastructure
  2. Find any discovered host card
  3. Verify "Last seen" shows valid date (NOT "Invalid Date")
  4. Verify year is 2020-2030 range

### Bug #6: Device "Discovered Invalid Date"
- **Root cause:** Code referenced device.first_seen but column is discovered_at
- **Fix:** Changed to device.discovered_at (e966c6b)
- **Test:**
  1. Navigate to http://192.168.68.89:8112/app/infrastructure
  2. Click any discovered host
  3. Find "Discovered" timestamp
  4. Verify shows valid date (NOT "Invalid Date" or "Unknown")

### Additional Regression Tests (pages verified working)

**Dashboard:**
- Navigate to http://192.168.68.89:8112/app
- Verify page loads without errors
- Verify stats, monitors, activity sections present

**Incidents:**
- Navigate to http://192.168.68.89:8112/app/incidents
- Verify list page renders
- Navigate to http://192.168.68.89:8112/app/incidents/new
- Verify form renders with title, description, severity fields

**Observatory:**
- Navigate to http://192.168.68.89:8112/app/observatory
- Verify page loads
- Verify "Automatic Context" or "AI Agents" section present

**Alerts:**
- Navigate to http://192.168.68.89:8112/app/alerts
- Verify "Alert Routing" heading present
- Verify "Add Route" button visible

**Settings:**
- Navigate to http://192.168.68.89:8112/app/settings
- Verify all tabs render (Account, Integrations, Data)
- Verify Profile section shows user data

## Expected Results

All 11+ tests should pass:
- ✅ Infrastructure page loads (no 500)
- ✅ Discovery saves hosts correctly
- ✅ Topology map renders (no CSP errors)
- ✅ Stack timestamps valid (not year 58597)
- ✅ Host timestamps valid (not Invalid Date)
- ✅ Device timestamps valid (not Invalid Date)
- ✅ Dashboard renders
- ✅ Incidents workflow works
- ✅ Observatory renders
- ✅ Alerts renders
- ✅ Settings renders

## Automation

This test suite should be run:
1. **Before every release** - Verify no regressions
2. **After any schema changes** - Verify timestamp handling
3. **After any CSP/security changes** - Verify external resources load
4. **Weekly** - Catch any drift in deployed environment
