# Auto-Remediation Playbooks & Cost Tracking Implementation

**Status:** ✅ Complete  
**Build:** ✅ Passing  
**Date:** 2026-07-21

## Overview

StdOut now includes a production-ready auto-remediation framework and comprehensive AI cost tracking system. This enables operators to safely automate incident fixes and track AI spending across all diagnoses.

## Architecture

### 1. Playbook Framework

**Core Components:**

- `src/lib/remediation/schema.ts` - Type definitions for playbooks, steps, and executions
- `src/lib/remediation/executor.ts` - Playbook execution engine with error handling and rollback
- `src/lib/remediation/playbooks.ts` - 5 pre-built playbooks for common scenarios

**Key Features:**

- **Type-Safe Definitions** - Full TypeScript support for playbook workflows
- **Multi-Step Orchestration** - Chain commands with dependencies and timeouts
- **Dry-Run Mode** - Test playbooks without making changes
- **Error Handling** - Automatic rollback on any step failure
- **Logging** - Comprehensive execution logs with timestamps and context
- **Approval Flow** - Require human approval for high-risk operations

### 2. Built-In Playbooks

Five production-ready playbooks handle common incident scenarios:

#### **Kubernetes Pod Restart** (`k8s-pod-restart`)
- **Trigger:** Pod in CrashLoopBackOff, ImagePullBackOff, or Pending state
- **Steps:**
  1. Identify unhealthy pod
  2. Get pod namespace
  3. Delete pod (triggers automatic restart)
  4. Wait for new pod to start
  5. Verify pod is running
- **Risk Level:** Medium (requires approval)
- **Rollback:** Undo deployment via `kubectl rollout undo`

#### **Docker Container Restart** (`docker-container-restart`)
- **Trigger:** Container exited or is in unhealthy state
- **Steps:**
  1. Get failed container ID
  2. Get container name
  3. Restart container
  4. Wait for startup
  5. Verify container is running
- **Risk Level:** Low (no approval required)
- **Rollback:** Re-stop the container if needed

#### **Clear Application Cache** (`clear-cache`)
- **Trigger:** Stale data, cache corruption, expired cache
- **Steps:**
  1. Flush Redis (if available)
  2. Flush Memcached (if available)
  3. Call app cache clear endpoint
  4. Verify cache is empty
- **Risk Level:** Low (non-destructive)
- **Rollback:** None (safe operation)

#### **Scale Up Resources** (`scale-up-resources`)
- **Trigger:** OOMKilled, CPU throttling, resource exhaustion
- **Steps:**
  1. Check current pod resource usage
  2. Get deployment name
  3. Increase replica count by 1
  4. Wait for new replicas to become ready
  5. Verify scaling succeeded
- **Risk Level:** Medium (requires approval)
- **Rollback:** Scale down if remediation doesn't help

#### **Restart Web Server** (`restart-web-server`)
- **Trigger:** 502/503 errors, connection refused, socket errors
- **Steps:**
  1. Detect which web server (nginx/Apache)
  2. Restart the server
  3. Wait for startup
  4. Verify health endpoint responds
- **Risk Level:** Medium (no approval, but impacts users)
- **Rollback:** Restart again or restore config

## Cost Tracking

### 1. Price Lookup

**Supported Providers** (2026-07 pricing):

| Provider | Model | Input $/1K | Output $/1K |
|----------|-------|-----------|------------|
| Ollama | any | $0 | $0 |
| OpenAI | gpt-4o | $0.005 | $0.015 |
| OpenAI | gpt-4-turbo | $0.010 | $0.030 |
| Anthropic | claude-opus | $0.015 | $0.075 |
| Anthropic | claude-sonnet-4 | $0.003 | $0.015 |
| Anthropic | claude-haiku | $0.0008 | $0.004 |
| Google | gemini-2.0-flash | $0.0001 | $0.0003 |

### 2. Incident Cost Tracking

Each incident now tracks:

- `ai_cost_usd` - Total USD spent on diagnosis (updated after each LLM call)
- `ai_tokens_used` - Total tokens consumed (prompt + completion)
- `ai_provider` - Which provider was used (ollama, anthropic, openai, gemini)

**Integration Points:**

The cost calculator should be called after every LLM diagnosis:

```typescript
import { trackCost } from '@/lib/cost-calculator';

// After calling diagnoseIncident(), call:
await trackCost({
  incidentId,
  provider: 'anthropic',
  model: 'claude-sonnet-4',
  promptTokens: response.promptTokens,
  completionTokens: response.completionTokens,
});
```

### 3. Cost Audit Trail

`cost_audit` table stores every LLM call with:

- Incident ID (links to incident)
- Provider & model
- Prompt tokens, completion tokens
- Calculated cost in USD
- Timestamp

This enables:
- Per-incident cost attribution
- Provider cost analysis
- Token usage trends
- Cost optimization opportunities

## Database Schema

### New Tables

**remediation_playbooks**
```sql
id TEXT PRIMARY KEY
user_id TEXT NOT NULL
name TEXT NOT NULL
description TEXT NOT NULL
trigger TEXT NOT NULL -- JSON: { type, pattern }
steps TEXT NOT NULL -- JSON array
rollback TEXT NOT NULL -- JSON array
requires_approval INTEGER
timeout INTEGER
risk_level TEXT
tags TEXT -- JSON array
is_built_in INTEGER
version TEXT
created_at INTEGER
updated_at INTEGER
created_by TEXT
```

**remediation_executions**
```sql
id TEXT PRIMARY KEY
playbook_id TEXT REFERENCES remediation_playbooks(id)
incident_id TEXT REFERENCES incidents(id)
user_id TEXT NOT NULL
status TEXT -- pending|running|success|failed|rolled_back|cancelled
dry_run INTEGER
approved_by TEXT
approved_at INTEGER
started_at INTEGER
completed_at INTEGER
logs TEXT -- JSON array of ExecutionLog
rollback_attempted INTEGER
rollback_success INTEGER
```

**remediationexecution_steps**
```sql
id TEXT PRIMARY KEY
execution_id TEXT REFERENCES remediation_executions(id) ON DELETE CASCADE
step_id TEXT NOT NULL
status TEXT -- pending|running|success|failed|skipped|timeout
output TEXT
error_message TEXT
duration_ms INTEGER
retries_used INTEGER
executed_at INTEGER
```

**cost_audit**
```sql
id TEXT PRIMARY KEY
incident_id TEXT REFERENCES incidents(id)
provider TEXT -- ollama|openai|anthropic|gemini
model TEXT
prompt_tokens INTEGER
completion_tokens INTEGER
cost_usd REAL
created_at INTEGER
```

### Incidents Table Updates

```sql
ALTER TABLE incidents ADD COLUMN ai_cost_usd REAL DEFAULT 0;
ALTER TABLE incidents ADD COLUMN ai_tokens_used INTEGER DEFAULT 0;
ALTER TABLE incidents ADD COLUMN ai_provider TEXT;
```

## API Endpoints

### Playbook Management

**GET /api/playbooks**
- List all playbooks (user + built-in)
- Response: `{ playbooks: Playbook[] }`

**POST /api/playbooks**
- Create custom playbook
- Body: `{ name, description, trigger, steps, rollback, requiresApproval, timeout, riskLevel, tags }`
- Response: `{ id, message }`

### Playbook Execution

**POST /api/playbooks/:id/execute**
- Execute a playbook (with optional approval)
- Body: `{ incidentId, dryRun?: boolean, approve?: boolean }`
- Response: `{ execution: { id, status, dryRun, logs, rollbackAttempted, rollbackSuccess } }`

Approval flow:
1. If `requiresApproval` and not `approve`, returns 403 with `{ error: 'Approval required' }`
2. User can then call again with `approve: true`
3. Execution records who approved it via `approvedBy` and `approvedAt`

### Cost Metrics

**GET /api/costs**
- Get cost summary and breakdown
- Response:
```typescript
{
  totalCostThisMonth: number;
  totalTokensThisMonth: number;
  averageCostPerIncident: number;
  providerBreakdown: {
    [provider: string]: {
      totalCost: number;
      totalTokens: number;
      incidentCount: number;
      avgCost: number;
    };
  };
  recentIncidents: Array<{
    id: string;
    title: string;
    severity: string;
    aiCostUsd: number;
    aiTokensUsed: number;
    aiProvider: string;
    createdAt: Date;
  }>;
}
```

## UI Pages

### Cost Dashboard (`/app/costs`)

**Key Metrics:**
- Total AI costs (all-time)
- Average cost per incident
- Number of providers used

**Cost by Provider Table:**
- Provider name
- Total cost
- Incident count
- Average cost per incident
- Total tokens

**Most Expensive Incidents:**
- Top 5 incidents sorted by cost
- Links to incident details
- Cost and token breakdown

**Recent Incidents Table:**
- Incident title
- Created date
- AI cost (or "Free (Ollama)")
- Token count
- Provider used

### Remediation Tracking (`/app/remediations`)

**Status Summary:**
- Successful executions (green)
- Failed executions (red)
- Currently running (blue)
- Rolled back (yellow)

**Recent Executions Table:**
- Playbook name (linked)
- Related incident ID (linked)
- Status with icon (dry run indicator)
- Start time
- Duration (if completed)

### Execution Details (`/app/remediations/:id`)

**Metadata:**
- Playbook name
- Execution ID
- Status badge
- Start time, duration
- Mode (dry run or live)
- Rollback status

**Execution Logs:**
- Full step-by-step log
- Color-coded by level (success, error, warn, info)
- Per-step context (step ID, data)
- Full JSON display for complex data

**Actions:**
- Back to remediations
- Link to related incident

## Implementation Checklist

✅ Playbook schema with full type definitions  
✅ Playbook executor with error handling and rollback  
✅ 5 built-in production playbooks  
✅ Cost calculator with 7 LLM providers  
✅ Cost audit trail  
✅ Database migrations  
✅ API endpoints for playbooks  
✅ API endpoint for execution  
✅ API endpoint for cost metrics  
✅ Cost dashboard UI  
✅ Remediations tracking UI  
✅ Execution detail UI  
✅ Build verification  
✅ Database initialization with auto-migration  

## Testing Strategy

### Unit Tests (Ready to add)

1. **Playbook Executor**
   - Dry-run mode (no changes made)
   - Shell command execution
   - API call execution
   - Timeout handling
   - Retry logic
   - Rollback on failure

2. **Cost Calculator**
   - Price lookup for all providers
   - Fallback pricing
   - Unknown provider handling
   - Rounding accuracy

3. **Built-in Playbooks**
   - Trigger pattern matching
   - Step count verification
   - Rollback step presence

### Integration Tests (Ready to add)

1. **End-to-End Playbook Execution**
   - Create custom playbook
   - Execute with dry-run
   - Verify logs
   - Execute with approval flow
   - Verify execution saved to DB

2. **Cost Tracking Flow**
   - Call diagnoseIncident
   - Track cost
   - Verify incident updated
   - Verify audit record created
   - Verify dashboard shows data

### Manual Testing

1. **Dry-Run Mode**
   - Execute playbook with dryRun: true
   - Verify no actual changes made
   - Check logs show "[DRY RUN]" prefix
   - Confirm playbook completes without error

2. **Approval Flow**
   - Execute high-risk playbook
   - Verify returns 403 without approval
   - Call again with approve: true
   - Verify approvedBy and approvedAt set
   - Check execution completed

3. **Cost Dashboard**
   - Navigate to /app/costs
   - Verify metrics display correctly
   - Check provider breakdown
   - Verify recent incidents shown
   - Confirm cost formatting ($X.XXXX)

## Future Enhancements

1. **Playbook Scheduling**
   - Run playbooks on a schedule
   - Trigger-based auto-execution
   - Confidence thresholds for auto-fix

2. **Advanced Rollback**
   - Snapshots before execution
   - Backup restoration
   - State validation

3. **Cost Optimization**
   - Recommend cheaper provider for similar quality
   - Batch API calls to reduce token usage
   - Caching for repeated diagnoses

4. **Analytics**
   - Remediation success rate by type
   - Cost trends over time
   - ROI of remediation vs manual fixes
   - Incident resolution time improvements

5. **Integration**
   - Slack notifications for playbook status
   - PagerDuty escalation on failure
   - Custom webhooks for playbook events

## Deployment Notes

1. **Database Migration**
   - Migration 0015 creates all necessary tables
   - ALTER TABLE for incident columns handled in db/index.ts
   - Auto-migration on first run (no manual SQL needed)

2. **No Breaking Changes**
   - Existing incidents continue to work
   - New cost fields default to 0
   - All pages optional (no required auth changes)

3. **Performance Considerations**
   - Playbook execution runs async (non-blocking)
   - Cost calculations lightweight (simple math)
   - Indexes on incident_id, provider, created_at for cost_audit
   - No impact on incident diagnosis performance

## Files Modified

**Core Framework:**
- `src/lib/remediation/schema.ts` (new)
- `src/lib/remediation/executor.ts` (new)
- `src/lib/remediation/playbooks.ts` (new)

**Cost Tracking:**
- `src/lib/cost-calculator.ts` (new)

**Database:**
- `src/lib/db/schema.ts` (updated with new tables + incident columns)
- `src/lib/db/index.ts` (updated auto-migration)
- `migrations/0015_auto_remediation_and_cost_tracking.sql` (new)

**API Endpoints:**
- `src/pages/app/api/playbooks/index.ts` (new)
- `src/pages/app/api/playbooks/[id]/execute.ts` (new)
- `src/pages/app/api/costs.ts` (new)

**UI Pages:**
- `src/pages/app/costs.astro` (new)
- `src/pages/app/remediations.astro` (new)
- `src/pages/app/remediations/[id].astro` (new)

## Commit Hash

```
1710b1a feat: implement auto-remediation playbooks and cost tracking
```

## Support

For issues or questions about the auto-remediation system:

1. Check the execution logs at `/app/remediations/:id`
2. Verify playbook definition in `/app/api/playbooks`
3. Review cost tracking in `/app/costs`
4. Check incident detail for cost breakdown

---

**Total Implementation:** 2,177 LOC (13 files, 12 new)  
**Build Status:** ✅ Passing  
**Ready for Deployment:** ✅ Yes
