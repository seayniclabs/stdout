import type { APIRoute } from 'astro';
import { getDb, schema } from '../../lib/db';
import { stacks, docs, monitors, windlassServices } from '../../lib/db/tenant-schema';
import { count, eq, sql } from 'drizzle-orm';

export const GET: APIRoute = async ({ locals }) => {
  const session = locals.user;
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const db = getDb();

  // Gather system metadata
  const [stackCount] = await db.select({ count: count() }).from(stacks).where(eq(stacks.userId, session.id));
  const [monitorCount] = await db.select({ count: count() }).from(monitors).where(eq(monitors.userId, session.id));
  const [docCount] = await db.select({ count: count() }).from(docs).where(eq(docs.userId, session.id));
  const [windlassServiceCount] = await db.select({ count: count() }).from(windlassServices).where(eq(windlassServices.userId, session.id));

  // Get runbook and guide counts
  const runbooks = await db.select({ count: count() }).from(docs)
    .where(sql`${docs.userId} = ${session.id} AND ${docs.docType} = 'runbook'`);
  const guides = await db.select({ count: count() }).from(docs)
    .where(sql`${docs.userId} = ${session.id} AND ${docs.docType} = 'guide'`);

  const runbookCount = runbooks[0]?.count || 0;
  const guideCount = guides[0]?.count || 0;

  // Build LLM context document
  const content = `# StdOut AI Context

## System Type
StdOut is an AI-assisted incident companion for infrastructure monitoring and remediation.

## Environment
- **Owner**: ${session.email}
- **Deployment**: Self-hosted
- **Version**: 1.2.1

## Connected Systems


### Infrastructure
- **Stacks**: ${stackCount.count} configured
- **Monitors**: ${monitorCount.count} active
- **Windlass Services**: ${windlassServiceCount.count} managed

### Data Sources
*No external data sources configured yet.*

## Knowledge Base

### Runbooks
- **Location**: \`/app/docs?docType=runbook\`
- **Count**: ${runbookCount}
- **Purpose**: Operational procedures for common tasks and incidents
- **Search**: Semantic search available via \`/app/api/docs/embeddings\` (POST with \`action: "search"\`)

### Documentation
- **Location**: \`/app/docs?docType=guide\`
- **Count**: ${guideCount}
- **Purpose**: Setup guides, troubleshooting, best practices
- **Search**: Full-text and semantic search available

### Community Library
- **Location**: \`/app/docs?source=community\`
- **Purpose**: Shared runbooks and guides from StdOut community

### Historical Incidents
- **Location**: \`/app/incidents?status=resolved\`
- **Purpose**: Past incidents with resolutions for pattern matching
- **Search**: Search by title, stack, tags, or description

### AI Learning Layer
- **Embeddings**: Document embeddings stored for semantic search
- **RAG**: Retrieval-Augmented Generation for incident diagnosis
- **Workflow**: When diagnosing incidents, AI searches runbooks → past incidents → suggests solutions

## AI Capabilities

### Diagnosis
- **Root cause analysis**: Uses past incident history to identify likely causes
- **Suggested commands**: Context-aware commands based on stack configuration
- **Similarity matching**: Finds similar past incidents for faster resolution

### Auto-Fix
- **Available for**: Docker container restarts, service reloads, configuration resets
- **Not available for**: Database migrations, destructive operations, schema changes

### Learning Layer
- **Runbooks**: AI reads runbooks to suggest documented procedures
- **Past Resolutions**: AI learns from successful incident resolutions
- **Community Knowledge**: AI incorporates community-contributed solutions

## How AI Should Help

### When a New Incident is Reported

1. **Check Runbooks First**
   - Search runbooks for procedures matching the incident keywords
   - If a runbook exists, suggest following it before deeper diagnosis

2. **Search Past Incidents**
   - Find similar resolved incidents by description/tags
   - Show user what worked before for similar issues

3. **Perform Diagnosis**
   - Use stack context (Docker, services, infrastructure)
   - Generate root cause hypotheses ranked by likelihood
   - Suggest diagnostic commands (non-destructive first)

4. **Recommend Actions**
   - Prioritize documented procedures from runbooks
   - Suggest commands that worked for similar past incidents
   - Flag risky operations and ask for confirmation

### When Creating Documentation

1. **Capture New Patterns**
   - If an incident resolution is novel, suggest creating a runbook
   - Extract commands and steps from resolution into template

2. **Update Existing Runbooks**
   - If resolution differs from runbook, suggest updates
   - Track effectiveness: which runbooks lead to fastest resolutions

### Constraints

- **Never suggest destructive operations** without explicit user confirmation
- **Always check runbooks before diagnosis** - documented procedures are tested
- **Prefer non-destructive diagnostics** - read-only commands first
- **Learn from failures** - if suggested fix doesn't work, adjust future recommendations

## API Endpoints for AI Integration

### Read Operations
- \`GET /app/api/incidents\` - List all incidents
- \`GET /app/api/incidents/:id\` - Get incident details with diagnosis
- \`GET /app/api/docs\` - List all documentation
- \`GET /app/api/docs/:id\` - Get specific document content
- \`GET /app/api/stacks\` - List infrastructure stacks

### Write Operations
- \`POST /app/api/incidents/:id/diagnose\` - Request AI diagnosis
- \`POST /app/api/incidents/:id/resolutions\` - Add resolution
- \`POST /app/api/docs\` - Create new runbook/guide

## Context Freshness

This file was generated dynamically. It reflects the current state of:
- Infrastructure discovery (stacks, monitors, services)
- Knowledge base (runbooks, guides, community docs)
- Connected systems (data sources)

**Last Updated**: ${new Date().toISOString()}

---

*This file is intended for AI systems to understand StdOut's capabilities and context. It is regenerated on every request to reflect current system state.*
`;

  return new Response(content, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
};
