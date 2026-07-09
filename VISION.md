
## Autonomous Operations Layer

**Goal:** StdOut should eliminate toil by autonomously healing infrastructure issues.

### Current State (Manual)
Today when dispatcher crashes:
1. Charlie notices queue empty
2. Tells Claude to investigate
3. Claude finds dispatcher down
4. Claude restarts it
5. Total time: 30-60 minutes

### Target State (Autonomous)
When dispatcher crashes:
1. StdOut sees: queue=0, pending=50, dispatcher process missing
2. StdOut diagnoses: "Dispatcher crash caused queue starvation"
3. StdOut heals: Restart dispatcher via launchd
4. StdOut learns: Log crash pattern, check if recurring
5. StdOut alerts: Post to Slack only if 3rd crash today
6. Total time: 30 seconds

### Healing Patterns

**Level 1: Restart (no human needed)**
- Service process down → restart via launchd
- Queue backing up → flush stale items
- Worker idle with pending work → re-dispatch

**Level 2: Remediation (no human needed)**
- Memory leak pattern → increase limits + schedule restart
- Recurring crash at time X → add preventive restart at X-1
- Rate limit hit → slow dispatch rate

**Level 3: Escalation (human decision needed)**
- Novel failure mode (never seen before)
- Remediation failed 3x
- Data corruption detected
- Security alert

### Integration with Current Healer

The bash `autonomous-healer` running now is a **prototype** of what StdOut should do:
- It checks services every 30s
- Restarts crashed components
- Auto-fixes stuck tasks
- Logs metrics

**Next:** Build StdOut satellite that:
1. Pulls metrics from helmsman.db (tasks, queue, services)
2. Pulls system metrics (memory, CPU, disk)
3. Runs same healing logic but with:
   - Better diagnosis (correlate multiple signals)
   - Richer actions (not just restart)
   - Learning (pattern detection over time)
   - UI (show healing history on dashboard)

### Success Criteria

**"Zero-touch operations":**
- Charlie never has to manually restart a service
- Claude never has to investigate "why is queue empty"
- System self-heals 95% of issues within 60 seconds
- Escalations only for novel/ambiguous/destructive cases

**Metrics:**
- MTTR (mean time to recovery): <60s for known issues
- Toil reduction: 80% fewer "investigate and restart" sessions
- Reliability: 99.9% uptime for task execution pipeline

### Implementation Path

**Phase 1: StdOut sees helmsman** (current)
- Pull task metrics from helmsman.db
- Pull queue metrics
- Display on dashboard
- **Status: Complete** (StdOut already does this)

**Phase 2: StdOut diagnoses issues** (next)
- Add health checks for dispatcher/consumer/workers
- Correlate signals (queue=0 + pending>0 + dispatcher PID missing = crash)
- Show diagnosis on dashboard

**Phase 3: StdOut heals automatically**
- Port autonomous-healer logic into StdOut
- Add remediation actions beyond restart
- Log all healing actions

**Phase 4: StdOut learns patterns**
- Track healing history over time
- Detect recurring issues
- Suggest permanent fixes (increase limits, add monitoring, refactor)

**Phase 5: Multi-host operations**
- StdOut manages Mac Mini + srv2 + any future hosts
- Coordinate healing across fleet
- Load balancing + failover

---

**Related:**
- Current prototype: `~/.local/bin/autonomous-healer`
- Lessons: `Projects/Lab/Lessons/Queue Consumer Was Missing - Workers Idle.md`
- StdOut project: `Projects/StdOut/StdOut.md`

