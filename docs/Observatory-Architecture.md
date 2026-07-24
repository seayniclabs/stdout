# StdOut Observatory Architecture

**Status:** Production-ready autonomous infrastructure monitoring with AI diagnosis  
**Created:** 2026-07-24  
**Phase:** P7b (Tool Invocation Layer complete)

## Overview

Observatory is StdOut's AI-powered autonomous monitoring system. It combines passive network discovery, baseline anomaly detection, and LLM-powered diagnosis to detect and remediate infrastructure issues automatically.

The architecture follows industry best practices for autonomous infrastructure agents:
1. **Investigation** (automatic, read-only) - gather metrics, detect anomalies, diagnose root causes
2. **Remediation** (gated by human approval for external infrastructure) - propose and execute fixes
3. **Verification** (feedback loops) - confirm actions worked, escalate if not
4. **Least Privilege** - read-only tools always available, write tools require operator+ role

## Core Components

### 1. Riggins - The Autonomous Watcher

**File:** `src/lib/agent/autonomous-watcher.ts`

Riggins is the autonomous agent persona that runs continuous infrastructure checks. Named agent with distinct personality and mission.

**Key characteristics:**
- Runs every 3 minutes (configurable via `intervalSeconds`)
- Per-user checks (multi-tenant aware)
- Self-healing enabled for StdOut itself (no approval needed)
- Human-in-the-loop for external infrastructure (approval required by default)

**Autonomy modes:**
- `selfHealingEnabled: true` - Can fix StdOut itself without approval (restart services, clear cache)
- `externalRemediationMode: 'investigate'` - External infrastructure: investigate only, propose actions
- `externalRemediationMode: 'approve-to-act'` - External infrastructure: queue actions for human approval

**Configuration:**
```typescript
interface WatcherConfig {
  enabled: boolean;
  intervalSeconds: number;
  selfHealingEnabled: boolean;
  externalRemediationMode: 'investigate' | 'approve-to-act';
  notifyOnCritical: boolean;
}
```

**Default config:**
- Enabled: `true`
- Interval: `180` seconds (3 minutes)
- Self-healing: `true` (can fix StdOut itself)
- External remediation: `'investigate'` (propose but don't execute)
- Notify on critical: `true`

**Storage:**
- Configuration: `agent_watcher_config` table
- Alerts: `agent_conversations` table with `autonomous: true, alert: true` metadata
- Pending actions: `agent_pending_actions` table with approval workflow

### 2. Observatory Toolbox

**File:** `src/lib/observatory/toolbox.ts`

The safe bridge between LLM agents and actual diagnostic/remediation tools. All tools run in isolated containers via `docker exec` with:
- Argument validation (no shell injection surface)
- Timeout enforcement
- Output size caps (64KB max)
- Full audit trail in `observatory_agent_runs` table

**Safety classes:**
- `read-only` - Observes only, no side effects (auto-allowed)
- `mutating` - Changes state on targets (requires `allowGated: true`)
- `gated` - Potentially heavy/sensitive (requires `allowGated: true`)

**Available tools:**

| Tool | Safety | Container | Description |
|------|--------|-----------|-------------|
| `dig` | read-only | observatory-tools | DNS lookup for hostname resolution |
| `ping_sweep` | read-only | observatory-tools | Host discovery sweep (nmap -sn, no port scan) |
| `port_scan` | gated | observatory-tools | TCP connect scan (nmap -sT) |
| `packet_sample` | read-only | observatory-tools | Bounded packet capture (tshark, N packets) |
| `trivy_image` | read-only | trivy | Scan container image for CVEs |
| `zeek_analyze` | read-only | zeek | Batch-analyze pcap with Zeek (conn/dns/http/ssl/notice) |
| `discover_network` | read-only | stdout | Network discovery: ARP + mDNS + SSDP |
| `create_stack` | mutating | stdout | Create new infrastructure stack |
| `create_monitor` | mutating | stdout | Create monitor for a service |

**Execution flow:**
1. Agent calls `runTool({ tool, args, allowGated?, userId, reason })`
2. Tool registry validates tool exists and args are safe
3. Gate enforcement checks safety class vs `allowGated` flag
4. Tool `build()` function constructs argv array (no shell strings)
5. Execute via `docker exec <container> <argv>` with timeout
6. Audit to `observatory_agent_runs` table (success/error/blocked/rejected)
7. Return result to agent

### 3. Agent Personas

**File:** `src/lib/observatory/agents.ts`

Two specialized agent personas with distinct models and missions:

**Watcher Agent:**
- Model: `llama3.2:3b-instruct-q4_K_M` (fast, lightweight)
- Mission: "Detect anomalies and early warning signs before they become incidents"
- Check interval: 3 minutes
- Focus: Real-time anomaly detection via baseline comparison (2σ threshold)

**Analyst Agent:**
- Model: `qwen2.5:14b-instruct-q4_K_M` (deeper reasoning)
- Mission: "Deep-dive incident investigation and root cause analysis"
- Triggered: On-demand when incidents detected
- Focus: Multi-factor correlation, root cause diagnosis, remediation planning

### 4. Tool Calling Integration

**File:** `src/lib/agent/auto-router-tools.ts`

Routes agent prompts to LLM providers that support tool calling (Ollama qwen2.5, Claude, Gemini). Handles:
- Tool call loop (max 5 iterations to prevent infinite loops)
- Tool execution via Observatory toolbox
- Result formatting and return to agent
- Graceful fallback to text-only generation if tools unavailable

**Tool definitions:**

**File:** `src/lib/agent/tools.ts`

7 core tools agents can invoke:
1. `get_metrics` - Current CPU/memory/disk/network stats
2. `get_baselines` - Established baseline ranges for anomaly detection
3. `get_incidents` - Recent incidents (filterable by status/severity)
4. `get_stacks` - List all configured stacks
5. `restart_container` - Restart specific container (requires operator+, external only)
6. `restart_stdout_service` - **SELF-HEALING:** Restart StdOut services (no approval needed)
7. `clear_stdout_cache` - **SELF-HEALING:** Clear StdOut caches (no approval needed)

### 5. Housekeeping Tasks

**Location:** `runHousekeepingTasks()` in `autonomous-watcher.ts`

Riggins maintains system health via scheduled background tasks:

| Task | Frequency | Purpose |
|------|-----------|---------|
| Passive discovery | 6 hours | Network device/service discovery sweep |
| Storage monitoring | 1 hour | Check disk usage, alert if >90% |
| Storage snapshot | 24 hours | Record daily storage metrics |
| Database vacuum | 7 days | SQLite maintenance to reclaim space |
| Log archival | Daily | Archive old logs to prevent bloat |

**Storage tracking:**
- Task history: `housekeeping_runs` table (task, last_run, status, details)
- Critical alerts: Posted via `sendAlert()` to all users when storage >90%

## Architecture Patterns

### Read-Before-Remediate

Every watcher cycle follows this sequence:
1. **Investigation phase** (automatic, read-only)
   - Check active incidents
   - Review metrics for anomalies
   - Check stack health
   - Identify root causes
2. **Classification** - Is this StdOut itself or external infrastructure?
3. **Remediation phase** (conditional)
   - **StdOut issues:** Self-healing enabled, act immediately
   - **External issues:** Propose actions, queue for approval (default mode)
4. **Verification** - Confirm fix worked, escalate if not

### Self-Healing Authority

Riggins can **autonomously remediate StdOut itself** without approval:
- Restart Observatory services
- Restart watcher loop
- Restart monitors
- Clear internal caches (metrics, baselines)

**Rationale:** StdOut monitoring itself going down defeats the purpose. Self-healing keeps the monitoring system reliable.

### Human-in-the-Loop for External Infrastructure

For watched stacks (user's containers, VMs, services):
- **Default mode:** `investigate` - diagnose and propose, but don't execute
- **Approval mode:** `approve-to-act` - queue proposed actions in `agent_pending_actions` table
- **Operator+ only:** `restart_container` tool requires elevated permission

**Pending action workflow:**
1. Agent detects issue, proposes remediation
2. Action stored in `agent_pending_actions` with status `'pending'`
3. Alert shown to user: "🔔 Action pending approval: [investigation report]"
4. User approves via UI (sets `approved_by`, `approved_at`)
5. System executes action, records result
6. Verification phase confirms success or escalates

## Memory & Context

**Files:**
- `src/lib/agent/memory.ts` - Load/save conversation history
- Agent memory persists in `agent_conversations` table

**Context building:**
- Load recent conversation history for the user
- Include infrastructure context (stacks, monitors, recent incidents)
- Build prompt context with agent persona + recent memory
- Auto-route with tools to LLM provider

**Conversation metadata:**
```typescript
{
  provider: 'ollama',
  model: 'qwen2.5:14b-instruct-q4_K_M',
  autonomous: true,
  phase: 'investigation' | 'remediation' | 'verification',
  toolsUsed: ['get_metrics', 'get_incidents'],
  alert: true  // if critical
}
```

## Deployment & Lifecycle

### Starting the Watcher

```typescript
import { startAutonomousWatcher } from './lib/agent/autonomous-watcher';

// In server startup (e.g., Astro integration hook)
startAutonomousWatcher();
```

**What happens:**
1. Load config from `agent_watcher_config` table (or use defaults)
2. Check if enabled (skip if `enabled: false`)
3. Log startup with interval and auto-remediation status
4. Run first cycle immediately
5. Schedule subsequent cycles on `intervalSeconds` interval

### Stopping the Watcher

```typescript
import { stopAutonomousWatcher } from './lib/agent/autonomous-watcher';

stopAutonomousWatcher();
```

**Graceful shutdown:**
- Clear the interval timer
- Set `isRunning = false`
- Log shutdown event

### Configuration Updates

```typescript
import { saveWatcherConfig } from './lib/agent/autonomous-watcher';

saveWatcherConfig({
  intervalSeconds: 300,  // 5 minutes instead of 3
  externalRemediationMode: 'approve-to-act',  // Enable approval workflow
});
```

**Auto-restart on config change:**
- Stop current watcher
- Save new config
- Start watcher with updated config

## Observability

### Audit Trail

Every tool invocation (success, error, blocked, rejected) is logged to `observatory_agent_runs`:

```sql
INSERT INTO observatory_agent_runs (
  id, user_id, agent_name, stack_id, trigger,
  input_context, output_decision, decision_made,
  confidence_score, execution_time_ms, created_at
) VALUES (
  'tool_1721846400_abc123',
  'user_xyz',
  'toolbox',
  NULL,
  'tool_invocation',
  '{"tool":"dig","safety":"read-only","argv":["dig","+short","example.com"],"reason":"DNS resolution check"}',
  '{"outcome":"success","detail":null}',
  'dig:success',
  NULL,
  NULL,
  1721846400000
);
```

**Query patterns:**
- Recent tool usage: `SELECT * FROM observatory_agent_runs WHERE agent_name = 'toolbox' ORDER BY created_at DESC LIMIT 20`
- Blocked attempts: `SELECT * FROM observatory_agent_runs WHERE decision_made LIKE '%blocked' OR decision_made LIKE '%rejected'`
- Tool usage by user: `SELECT * FROM observatory_agent_runs WHERE user_id = ? AND agent_name = 'toolbox'`

### Autonomous Alerts

Critical findings are stored as autonomous alerts in `agent_conversations`:

```typescript
await storeAutonomousAlert(userId, message);
```

**Metadata flags:**
- `autonomous: true` - Generated by autonomous agent, not user interaction
- `alert: true` - Critical finding requiring attention

**UI integration:**
- Alerts appear in Observatory chat interface
- Badge/notification when new autonomous alerts exist
- Filter view: autonomous alerts only

### Housekeeping Status

Track background task execution in `housekeeping_runs`:

```sql
CREATE TABLE housekeeping_runs (
  id INTEGER PRIMARY KEY,
  task TEXT NOT NULL,
  last_run INTEGER NOT NULL,
  status TEXT NOT NULL,  -- 'success' | 'failed'
  details TEXT
);
```

**Example queries:**
- Last passive discovery: `SELECT * FROM housekeeping_runs WHERE task = 'passive-discovery'`
- Failed tasks: `SELECT * FROM housekeeping_runs WHERE status = 'failed'`

## Security Boundaries

### Container Isolation

All diagnostic tools run in isolated containers:
- `observatory-tools` - General network diagnostics (nmap, tshark, dig)
- `trivy` - CVE scanning (isolated from main app)
- `zeek` - Protocol analysis (sandboxed)
- `stdout` - Only for read-only operations (network discovery) and self-healing

**No shell execution:** Tools are invoked via `execFile()` with argv arrays, never shell strings. LLM can't inject commands.

### Argument Validation

Every tool has a `build()` function that validates args before execution:

```typescript
function safeTarget(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!/^[A-Za-z0-9._:\/-]{1,128}$/.test(s)) {
    throw new Error(`invalid target: ${JSON.stringify(v)}`);
  }
  return s;
}
```

**Rejected on validation failure:**
- Logged to audit trail with `outcome: 'rejected'`
- Error returned to agent
- No execution attempted

### Permission Gating

**Read-only tools:** Auto-allowed for all users

**Mutating/gated tools:** Require explicit opt-in via `allowGated: true` flag

**Role-based tools:** `restart_container` requires `operator+` role (checked at API layer)

### Output Caps

**Max output:** 64KB per tool execution

**Timeout enforcement:**
- Per-tool timeout (e.g., 10s for `dig`, 120s for `trivy_image`)
- `AbortSignal.timeout()` on fetch calls
- `execFile({ timeout: timeoutMs })` for shell commands

**Prevents:**
- Memory exhaustion from chatty tools
- Runaway processes blocking the watcher
- Log flooding from verbose output

## Extension Points

### Adding New Tools

1. **Define tool in registry** (`src/lib/observatory/toolbox.ts`):

```typescript
const TOOLS: Record<string, ToolDef> = {
  my_new_tool: {
    name: 'my_new_tool',
    safety: 'read-only',
    description: 'What this tool does',
    container: 'observatory-tools',
    timeoutMs: 30_000,
    build: (a) => ['command', 'arg1', safeTarget(a.target)],
  },
};
```

2. **Expose to agents** (if needed, add to `src/lib/agent/tools.ts`):

```typescript
export const OBSERVATORY_TOOLS: Tool[] = [
  // ... existing tools
  {
    name: 'my_new_tool',
    description: 'What agents should know about this tool',
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'What to analyze',
        },
      },
      required: ['target'],
    },
  },
];
```

3. **Add executor** (in `src/lib/agent/tools.ts > executeTool()`):

```typescript
case 'my_new_tool': {
  const result = await runTool({
    tool: 'my_new_tool',
    args: parameters,
    allowGated: false,  // or true if mutating/gated
    userId,
    reason: 'Agent-requested diagnostic',
  });
  return { success: result.ok, result: result.stdout };
}
```

### Adding New Agent Personas

Define in `src/lib/observatory/agents.ts`:

```typescript
export const AGENTS = {
  riggins: {
    name: 'Riggins',
    model: 'llama3.2:3b-instruct-q4_K_M',
    mission: 'Detect anomalies and early warning signs',
    checkIntervalMinutes: 3,
    systemPrompt: `You are Riggins, an autonomous infrastructure monitoring agent...`,
  },
  my_new_agent: {
    name: 'NewAgent',
    model: 'qwen2.5:14b-instruct-q4_K_M',
    mission: 'Specialized task description',
    checkIntervalMinutes: 10,
    systemPrompt: `You are NewAgent, specializing in...`,
  },
};
```

**Integration:**
- Add check loop in `autonomous-watcher.ts` if continuous monitoring
- OR expose as on-demand tool callable by other agents
- Define tool permissions (which tools this agent can use)

### Adding New Containers

If you need to run tools in a new sidecar container:

1. **Add container to docker-compose.yml**:

```yaml
services:
  my-diagnostic-tool:
    image: my-tool:latest
    container_name: my-diagnostic-tool
    networks:
      - stdout-network
```

2. **Update toolbox container enum**:

```typescript
interface ToolDef {
  container: 'observatory-tools' | 'trivy' | 'zeek' | 'my-diagnostic-tool';
  // ...
}
```

3. **Define tools that use this container**:

```typescript
my_tool: {
  name: 'my_tool',
  safety: 'read-only',
  container: 'my-diagnostic-tool',
  build: (a) => ['tool-command', '--arg', safeTarget(a.input)],
  timeoutMs: 60_000,
},
```

## Testing the Observatory

### Manual Testing

**Start the watcher:**

```bash
# In StdOut container
docker exec stdout node -e "
  const {startAutonomousWatcher} = require('./dist/server/chunks/autonomous-watcher.mjs');
  startAutonomousWatcher();
"
```

**Check watcher logs:**

```bash
docker logs -f stdout | grep "Agent Watcher"
```

**Expected output:**
```
[Agent Watcher] Starting autonomous loop (every 180s)
[Agent Watcher] Auto-remediation: ENABLED
[Agent Watcher] Running cycle...
[Agent Watcher] User abc123: All clear
[Agent Watcher] Cycle complete
```

### Tool Invocation Testing

**Test read-only tool (dig):**

```bash
docker exec stdout node -e "
  const {runTool} = require('./dist/server/chunks/toolbox.mjs');
  runTool({
    tool: 'dig',
    args: { target: 'example.com' },
    userId: 'test-user',
    reason: 'Manual test'
  }).then(r => console.log(JSON.stringify(r, null, 2)));
"
```

**Expected result:**
```json
{
  "ok": true,
  "tool": "dig",
  "safety": "read-only",
  "stdout": "93.184.216.34\n",
  "stderr": "",
  "exitCode": 0,
  "durationMs": 152
}
```

**Test gated tool without permission (port_scan):**

```bash
docker exec stdout node -e "
  const {runTool} = require('./dist/server/chunks/toolbox.mjs');
  runTool({
    tool: 'port_scan',
    args: { target: '192.168.1.1', ports: '80,443' },
    allowGated: false,
    userId: 'test-user',
    reason: 'Manual test'
  }).then(r => console.log(JSON.stringify(r, null, 2)));
"
```

**Expected result:**
```json
{
  "ok": false,
  "tool": "port_scan",
  "safety": "gated",
  "stdout": "",
  "stderr": "",
  "exitCode": null,
  "durationMs": 1,
  "error": "tool \"port_scan\" is gated — requires allowGated=true"
}
```

### Agent Tool Call Testing

**Simulate agent calling get_metrics:**

```bash
docker exec stdout node -e "
  const {executeTool} = require('./dist/server/chunks/tools.mjs');
  executeTool('get_metrics', {}, 'test-user')
    .then(r => console.log(JSON.stringify(r, null, 2)));
"
```

**Expected result:**
```json
{
  "success": true,
  "result": {
    "metrics": [
      {
        "stack_id": "abc123",
        "cpu_percent": 45.2,
        "memory_used_mb": 2048,
        "disk_used_percent": 67.3,
        "network_rx_bytes": 12345678,
        "network_tx_bytes": 9876543,
        "timestamp": 1721846400000
      }
    ]
  }
}
```

## Production Considerations

### Resource Limits

**Watcher interval:** Default 3 minutes balances responsiveness vs overhead
- Too frequent (<1 min): CPU/memory pressure from constant LLM calls
- Too infrequent (>10 min): Slower incident detection

**Tool timeouts:** Set per-tool based on expected duration
- Quick lookups (dig): 10s
- Network scans (nmap): 60s
- Deep analysis (trivy, zeek): 120s

**Output caps:** 64KB prevents memory exhaustion but allows most tool output to pass through

### Model Selection

**Watcher (llama3.2:3b):**
- Fast inference (~500ms per call)
- Low memory footprint (~4GB VRAM)
- Good for pattern matching and anomaly flagging

**Analyst (qwen2.5:14b):**
- Deeper reasoning (~2-3s per call)
- Higher memory footprint (~12GB VRAM)
- Better for root cause analysis and remediation planning

**Ollama required:** Both models run via Ollama with tool calling support

### Database Maintenance

**Tables to monitor:**
- `agent_conversations` - Grows with every watcher cycle + user chat
- `observatory_agent_runs` - Tool audit trail (one row per tool call)
- `housekeeping_runs` - Small, one row per task type
- `agent_pending_actions` - Grows only when approval mode enabled

**Retention policy:**
- Autonomous alerts: Keep 30 days
- Tool audit trail: Keep 90 days
- Pending actions: Archive after 14 days (completed or expired)

**Cleanup queries:**

```sql
-- Archive old autonomous alerts
DELETE FROM agent_conversations
WHERE metadata LIKE '%"autonomous":true%'
  AND created_at < (SELECT (strftime('%s', 'now') - 2592000) * 1000);

-- Archive old tool audit logs
DELETE FROM observatory_agent_runs
WHERE agent_name = 'toolbox'
  AND created_at < (SELECT (strftime('%s', 'now') - 7776000) * 1000);

-- Clean expired pending actions
DELETE FROM agent_pending_actions
WHERE status = 'pending'
  AND created_at < (SELECT (strftime('%s', 'now') - 1209600) * 1000);
```

### Monitoring the Monitor

**Health checks:**
1. Is watcher running? Check last `agent_conversations` entry with `autonomous: true`
2. Are tools working? Check `observatory_agent_runs` for recent successes
3. Are housekeeping tasks running? Check `housekeeping_runs` last_run timestamps

**Alerts to set:**
- No autonomous activity in >10 minutes → Watcher may have crashed
- High tool rejection rate → LLM making invalid requests
- Storage >90% → Housekeeping task should trigger this already

**Fallback:**
- If watcher crashes, restart via `startAutonomousWatcher()`
- If tools fail repeatedly, check container health (`docker ps`, `docker logs`)
- If DB grows too large, run manual cleanup queries above

## Future Enhancements

### Planned Features

1. **Multi-model ensemble** - Vote between multiple LLMs for high-stakes decisions
2. **Remediation playbooks** - Pre-approved action sequences for common incidents
3. **Learned baselines** - Machine learning on historical metrics for smarter anomaly detection
4. **Cross-stack correlation** - Detect cascade failures across multiple stacks
5. **Incident timeline** - Reconstruct event sequences leading to failures

### Extension Ideas

- **Custom tool plugins** - User-defined diagnostic scripts
- **Webhook integration** - Post alerts to external systems (Slack, PagerDuty)
- **Remediation simulation** - Dry-run mode to preview actions before execution
- **Agent collaboration** - Multiple agents consulting each other on complex incidents
- **Proactive optimization** - Suggest infrastructure improvements based on patterns

---

**Version:** 1.0  
**Last Updated:** 2026-07-24  
**Status:** Production-ready, actively monitoring
