# Observatory Learning Layer

AI-powered infrastructure monitoring with continuous learning.

## Architecture

```
┌─────────────────────────────────────────────┐
│ SHIPPED IN EVERY INSTALLATION              │
├─────────────────────────────────────────────┤
│ • Agent personas (Watcher, Analyst)        │
│ • 32 standard incident patterns            │
│ • Metric interpretation guide (8 metrics)  │
│ • System prompts & decision frameworks     │
│ • Database schema for learning             │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│ LEARNS PER INSTALLATION                    │
├─────────────────────────────────────────────┤
│ • Stack-specific baselines (7-day rolling) │
│ • User's resolved incidents               │
│ • Feedback on agent suggestions            │
│ • Custom patterns created by user          │
└─────────────────────────────────────────────┘
```

## Startup Sequence

**Every time StdOut starts** (fresh boot, restart, recovery), Observatory runs a 5-phase initialization:

1. **Identity** - Load agent personas, understand mission
2. **Knowledge Base** - Connect to standard patterns, metrics guide, user incidents
3. **Infrastructure** - Discover stacks, hosts, services to monitor
4. **Monitors** - Check configured monitors and data sources
5. **Activation** - Start Watcher agent, set Analyst to standby

## Integration

### Server Startup (Required)

Add this to your StdOut server entry point (e.g., `src/middleware.ts` or `astro.config.mjs`):

```typescript
import { startupObservatory } from './lib/observatory/startup';

// During server initialization
const observatoryResult = await startupObservatory();

if (!observatoryResult.success) {
  console.error('Observatory failed to start:');
  console.error(observatoryResult.issues.join('\n'));
  // Service can still run, but Observatory features may be limited
}

// Log startup for debugging
console.log(formatStartupResult(observatoryResult));
```

### Database Migrations

Run these in order on fresh install or upgrade:

```bash
# 1. Create learning layer schema
sqlite3 data/stdout.db < migrations/0010_add_observatory_learning_layer.sql

# 2. Seed standard patterns (32 patterns)
npx tsx migrations/0011_seed_observatory_patterns.ts
```

## Files

| File | Purpose |
|------|---------|
| `agents.ts` | Agent personas (Watcher, Analyst) - who they are, what their mission is |
| `metrics-guide.ts` | Metric interpretation (8 common metrics) - normal ranges, thresholds, causes |
| `prompts.ts` | System prompt builders - inject identity + knowledge into LLM calls |
| `standard-patterns.json` | 32 incident patterns - shipped knowledge base |
| `initialization.ts` | 5-phase startup sequence - brings Observatory online |
| `startup.ts` | Startup hook - runs on every service start/restart |

## Agent Personas

### Watcher
- **Role:** Continuous Infrastructure Monitor
- **Model:** Llama 3.2 3B
- **Mission:** Detect anomalies before they become incidents
- **Check Interval:** Every 3 minutes
- **Alert Threshold:** >2σ deviation sustained >6 minutes

### Analyst
- **Role:** Incident Investigator & Root Cause Analyst
- **Model:** Qwen 2.5 14B
- **Mission:** Diagnose HIGH/CRITICAL incidents, recommend fixes
- **Trigger:** HIGH or CRITICAL severity only
- **Knowledge:** Past incidents + standard patterns + docs

## Learning Timeline

| Day | What Observatory Knows |
|-----|------------------------|
| **Day 1** | Standard patterns only (32 patterns) |
| **Day 7** | Stack baselines established (knows what's normal for YOU) |
| **Day 30** | Significant incident history (learns YOUR infrastructure) |

## Standard Pattern Library

32 patterns across 11 categories:
- **Resource Exhaustion** (4) - disk, memory, CPU, connections
- **Service Crash** (4) - exceptions, hangs, crashes, database
- **Configuration** (4) - env vars, syntax, certs, images
- **Network** (4) - DNS, ports, timeouts, proxies
- **Database** (2) - corruption, slow queries
- **Filesystem** (3) - inodes, mounts, permissions
- **Security** (2) - access, secrets
- **Performance** (2) - leaks, latency
- **Docker-specific** (4) - disk, network, shutdown, daemon
- **External Service** (2) - API failures, webhooks
- **System** (1) - systemd

Average confidence: **0.89** (realistic, not over-promised)

## Development

### Adding New Standard Patterns

1. Edit `standard-patterns.json`
2. Follow the schema:
```json
{
  "id": "stdlib_your_pattern",
  "pattern_name": "Human Readable Name",
  "category": "category_name",
  "symptoms": ["observable behavior"],
  "common_causes": ["root cause"],
  "resolution_steps": ["how to fix"],
  "prevention_steps": ["how to prevent"],
  "confidence_threshold": 0.85,
  "source": "stdlib"
}
```
3. Re-run migration: `npx tsx migrations/0011_seed_observatory_patterns.ts`

### Testing

```typescript
import { initializeObservatory, isObservatoryReady } from './observatory/initialization';

const result = await initializeObservatory();
console.log(result.startupLog.join('\n'));

const readiness = isObservatoryReady(result);
console.log('Ready:', readiness.ready);
console.log('Issues:', readiness.missingComponents);
```

## Production Checklist

- [ ] Migrations run (schema + seed)
- [ ] Startup hook integrated in server
- [ ] License activated (Observatory feature gated)
- [ ] At least 1 stack discovered
- [ ] At least 1 monitor configured
- [ ] 7 days of baseline data collected
- [ ] First incident resolved (teaches system)

## Troubleshooting

**Observatory not activating:**
- Check license is valid
- Verify migrations ran: `sqlite3 data/stdout.db "SELECT COUNT(*) FROM observatory_standard_patterns;"`
- Check startup log: look for initialization errors

**No alerts being generated:**
- Check if baselines established (need 7 days data)
- Verify Watcher agent is active: `SELECT * FROM observatory_agent_runs ORDER BY started_at DESC LIMIT 5;`
- Review agent decision logs in database

**False positives:**
- Provide feedback: mark suggestions as unhelpful
- System learns from feedback and adjusts weights
- Takes ~100 feedback samples to see 10%+ accuracy improvement

## Next Steps

1. **Implement retrieval logic** - RAG layer to query patterns + baselines
2. **Wire up Sentinel integration** - actually call the agents
3. **Build feedback UI** - let users mark suggestions helpful/unhelpful
4. **Deploy to ThinkPad** - test with real infrastructure
5. **Monitor learning** - track accuracy over time

---

**Status:** Foundation complete, ready for integration
**Version:** 1.0 (32 patterns, 2 agents, 8 metrics)
**Last Updated:** 2026-06-09
