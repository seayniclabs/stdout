---
title: Riggins RAG + Self-Learning System
status: planned
priority: high
created: 2026-07-26
tags: [riggins, rag, learning, notebooklm, observatory]
---

# Riggins RAG + Self-Learning System

## Problem Statement

**Current State:**
Riggins (StdOut Observatory Agent) currently operates with:
- Static identity prompt (hardcoded capabilities/constraints)
- 4-tier memory (identity, infrastructure context, conversations, working memory)
- 6 tools for infrastructure operations (metrics, incidents, restarts)
- Zero access to historical incident data, documentation, or community knowledge

**Gap:**
When users ask "Why is CPU spiking?" or "How do I fix this?", Riggins can only:
1. Check current metrics
2. Compare against baselines
3. Suggest generic actions

He **cannot**:
- Reference past incidents with similar patterns
- Cite StdOut documentation or runbooks
- Learn from successful resolutions
- Leverage community knowledge base
- Provide context-aware fixes based on historical data

**Impact:**
Users get basic monitoring responses instead of intelligent incident companion behavior. Riggins feels like a metrics dashboard, not an AI assistant.

---

## Proposed Solution

### Architecture: 3-Tier RAG + Learning System

```
┌─────────────────────────────────────────────────────────────┐
│                    Riggins Agent Core                        │
│  (qwen2.5:14b + tool calling + enhanced memory)             │
└─────────────────┬───────────────────────────────────────────┘
                  │
        ┌─────────┴──────────┐
        │                    │
        ▼                    ▼
┌──────────────┐    ┌──────────────────┐
│ Tool Calling │    │ RAG Query Layer  │
│ (existing)   │    │ (NEW)            │
└──────────────┘    └────────┬─────────┘
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                 │
           ▼                 ▼                 ▼
    ┌───────────┐   ┌─────────────┐   ┌──────────────┐
    │ NotebookLM│   │ Incident DB │   │ Community KB │
    │ Docs RAG  │   │ (SQLite)    │   │ (Embeddings) │
    └───────────┘   └─────────────┘   └──────────────┘
```

### Tier 1: NotebookLM Documentation RAG

**What:**
- Create dedicated StdOut docs NotebookLM notebook
- Ingest: installation guides, troubleshooting, API docs, runbooks
- Query via nlm CLI from inside agent context

**Implementation:**
```typescript
// src/lib/agent/rag/notebooklm.ts
import { execFileSync } from 'child_process';

const STDOUT_DOCS_NOTEBOOK = process.env.STDOUT_DOCS_NOTEBOOK_ID || 'stdout-docs';

export async function queryDocs(question: string): Promise<string> {
  try {
    const result = execFileSync('nlm', [
      'notebook', 'query', 
      STDOUT_DOCS_NOTEBOOK, 
      question
    ], { encoding: 'utf-8', timeout: 30000 });
    
    return result.trim();
  } catch (error) {
    console.error('[RAG] NotebookLM query failed:', error);
    return '';
  }
}
```

**New Agent Tool:**
```typescript
{
  name: 'query_documentation',
  description: 'Search StdOut documentation, runbooks, and troubleshooting guides for answers to user questions.',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The question to ask the documentation (e.g. "How do I fix high memory usage?")'
      }
    },
    required: ['question']
  }
}
```

**Trigger Logic:**
- User asks "how to" or "why is" questions
- Agent detects it needs context beyond current metrics
- Automatically calls `query_documentation` before responding

### Tier 2: Incident History Learning

**What:**
- Store all incidents with: problem, diagnosis, resolution, outcome
- Build embeddings of incident descriptions (nomic-embed-text via Ollama)
- Semantic search for similar past incidents when new ones occur

**Schema Addition:**
```sql
CREATE TABLE incident_embeddings (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(id),
  embedding_vector TEXT NOT NULL, -- JSON array of floats
  created_at INTEGER NOT NULL,
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
);

CREATE INDEX idx_incident_embeddings_incident ON incident_embeddings(incident_id);
```

**Implementation:**
```typescript
// src/lib/agent/rag/incident-learning.ts
import { getSqlite } from '../../db';

interface SimilarIncident {
  id: string;
  title: string;
  diagnosis: string;
  resolution: string;
  similarity: number;
}

export async function findSimilarIncidents(
  description: string,
  limit: number = 5
): Promise<SimilarIncident[]> {
  // 1. Generate embedding for current incident
  const embedding = await generateEmbedding(description);
  
  // 2. Search incident_embeddings for similar vectors
  const db = getSqlite();
  const allEmbeddings = db.prepare(`
    SELECT ie.incident_id, ie.embedding_vector, i.title, i.diagnosis, i.resolution
    FROM incident_embeddings ie
    JOIN incidents i ON ie.incident_id = i.id
    WHERE i.status = 'resolved' AND i.resolution IS NOT NULL
  `).all();
  
  // 3. Calculate cosine similarity
  const results = allEmbeddings.map(row => {
    const vector = JSON.parse(row.embedding_vector);
    const similarity = cosineSimilarity(embedding, vector);
    return {
      id: row.incident_id,
      title: row.title,
      diagnosis: row.diagnosis,
      resolution: row.resolution,
      similarity
    };
  }).sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  
  return results;
}

async function generateEmbedding(text: string): Promise<number[]> {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://172.17.0.1:11434';
  
  const response = await fetch(`${ollamaUrl}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'nomic-embed-text:latest',
      prompt: text
    })
  });
  
  const data = await response.json();
  return data.embedding;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

**New Agent Tool:**
```typescript
{
  name: 'find_similar_incidents',
  description: 'Search past resolved incidents for similar problems and their resolutions. Use when diagnosing new issues.',
  parameters: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: 'Description of the current problem (e.g. "nginx returning 502 errors")'
      },
      limit: {
        type: 'number',
        description: 'Number of similar incidents to return (default: 5)'
      }
    },
    required: ['description']
  }
}
```

### Tier 3: Community Knowledge Base

**What:**
- Curated library of common incident patterns + resolutions
- Seeded from StdOut community contributions
- Searchable via embeddings (same vector search as Tier 2)

**Schema:**
```sql
CREATE TABLE community_patterns (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL, -- 'memory', 'cpu', 'network', 'disk', 'database', etc.
  title TEXT NOT NULL,
  problem_description TEXT NOT NULL,
  symptoms TEXT NOT NULL, -- JSON array of observable symptoms
  root_causes TEXT NOT NULL, -- JSON array of possible causes
  resolutions TEXT NOT NULL, -- JSON array of resolution steps
  tags TEXT NOT NULL, -- JSON array of tags
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE community_pattern_embeddings (
  id TEXT PRIMARY KEY,
  pattern_id TEXT NOT NULL REFERENCES community_patterns(id),
  embedding_vector TEXT NOT NULL, -- JSON array
  created_at INTEGER NOT NULL,
  FOREIGN KEY (pattern_id) REFERENCES community_patterns(id) ON DELETE CASCADE
);
```

**Seed Data Example:**
```json
{
  "category": "memory",
  "title": "Memory Leak in Node.js Container",
  "problem_description": "Container memory usage grows continuously until OOM kill",
  "symptoms": [
    "Memory usage increases linearly over time",
    "Container restarts every few hours/days",
    "Heap size grows unbounded",
    "RSS memory never decreases"
  ],
  "root_causes": [
    "Event listeners not removed",
    "Circular references preventing GC",
    "Large objects held in closures",
    "Caching without eviction policy"
  ],
  "resolutions": [
    "Enable Node.js --max-old-space-size flag",
    "Add heap snapshots and analyze with Chrome DevTools",
    "Implement LRU cache with size limits",
    "Add listener cleanup in teardown hooks",
    "Use WeakMap/WeakSet for temporary references"
  ],
  "tags": ["nodejs", "memory-leak", "docker", "oom"]
}
```

**New Agent Tool:**
```typescript
{
  name: 'search_community_knowledge',
  description: 'Search community knowledge base for known incident patterns and proven resolutions.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query (e.g. "nodejs memory leak docker")'
      },
      category: {
        type: 'string',
        description: 'Optional category filter',
        enum: ['memory', 'cpu', 'network', 'disk', 'database', 'container']
      }
    },
    required: ['query']
  }
}
```

---

## Enhanced Agent Behavior

### Before RAG (Current):
```
User: "Why is my Node.js container constantly restarting?"

Riggins: "Let me check the metrics... I see the container has restarted 47 times 
in the last 24 hours. Memory usage was at 98% before the last restart. This looks 
like a memory issue. You should investigate memory leaks in your application."
```

### After RAG (Enhanced):
```
User: "Why is my Node.js container constantly restarting?"

Riggins: [Queries metrics] [Searches similar incidents] [Checks community KB]

"I found 3 similar incidents in your history and a community pattern match:

**Current State:**
- Container restarted 47x in 24h
- Memory at 98% before restarts (baseline: 35%)
- Heap size growing 2MB/hour

**Similar Past Incident (2024-12-15):**
You had this exact pattern with `api-worker`. Root cause was event listeners 
not being removed. Fixed by adding cleanup in shutdown hooks.

**Community Pattern: Node.js Memory Leak**
Common symptoms match yours:
✓ Linear memory growth
✓ Container OOM kills
✓ RSS never decreases

**Recommended Resolution:**
1. Enable heap snapshots: Add `--max-old-space-size=512` to container CMD
2. Capture snapshot before next restart (I can trigger this)
3. Check for listener leaks: grep for `.on(` without `.off(`

Similar to your December fix - likely same root cause. Want me to capture 
a heap snapshot now?"
```

---

## User Configuration

### Settings → Observatory → Agent Learning

**Because StdOut is a product**, all RAG/learning features must be user-configurable:

```yaml
Observatory Agent Settings:
  
  □ Enable Documentation Search
    → Allow Riggins to search StdOut documentation
    → Uses NotebookLM (requires internet connection)
    → Disable for air-gapped environments
  
  □ Enable Incident History Learning
    → Learn from your past incidents and resolutions
    → Uses local embeddings (Ollama nomic-embed-text)
    → Works offline after initial model download
  
  □ Enable Community Knowledge Base
    → Access curated incident patterns from StdOut community
    → Helps solve common problems faster
    → Shared knowledge, no customer data uploaded
  
  □ Share Resolved Incidents with Community (opt-in)
    → Anonymously contribute successful resolutions
    → Redacts: hostnames, IPs, container names, env-specific details
    → Manual approval before each submission
    
  Advanced:
    □ Auto-generate embeddings for new incidents
    □ Feedback-weighted similarity search
    □ Custom documentation notebook (bring your own)
```

### Per-Feature Toggle Architecture

```typescript
// src/lib/agent/rag/config.ts
export interface RAGConfig {
  docsSearchEnabled: boolean;
  incidentLearningEnabled: boolean;
  communityKBEnabled: boolean;
  shareWithCommunity: boolean;
  customDocsNotebook?: string; // Optional: user's own NotebookLM ID
  autoEmbedIncidents: boolean;
  feedbackWeighting: boolean;
}

export async function getRAGConfig(userId: string): Promise<RAGConfig> {
  const db = getDb();
  const prefs = await db.get(sql`
    SELECT value FROM preferences 
    WHERE user_id = ${userId} AND key = 'rag_config'
  `);
  
  return prefs?.value ? JSON.parse(prefs.value) : getDefaults();
}

function getDefaults(): RAGConfig {
  return {
    docsSearchEnabled: true,      // ON by default (StdOut docs helpful)
    incidentLearningEnabled: true, // ON by default (local, private)
    communityKBEnabled: true,      // ON by default (read-only, helpful)
    shareWithCommunity: false,     // OFF by default (opt-in only)
    autoEmbedIncidents: true,      // ON by default (background job)
    feedbackWeighting: true        // ON by default (improves results)
  };
}
```

### Conditional Tool Registration

```typescript
// src/lib/agent/tools.ts
export async function getAvailableTools(userId: string): Promise<Tool[]> {
  const config = await getRAGConfig(userId);
  
  const baseTools = [
    GET_METRICS_TOOL,
    GET_BASELINES_TOOL,
    GET_INCIDENTS_TOOL,
    // ... other infrastructure tools
  ];
  
  const ragTools: Tool[] = [];
  
  if (config.docsSearchEnabled) {
    ragTools.push(QUERY_DOCUMENTATION_TOOL);
  }
  
  if (config.incidentLearningEnabled) {
    ragTools.push(FIND_SIMILAR_INCIDENTS_TOOL);
  }
  
  if (config.communityKBEnabled) {
    ragTools.push(SEARCH_COMMUNITY_KB_TOOL);
  }
  
  return [...baseTools, ...ragTools];
}
```

### Air-Gapped / Offline Mode

**Critical for product:** Some StdOut users are in air-gapped environments.

**Offline-capable features:**
- ✅ Incident history learning (local embeddings via Ollama)
- ✅ Community KB (pre-seeded, local database)
- ✅ Agent tool calling (all local APIs)

**Requires internet:**
- ⚠️ NotebookLM docs search (API call to Google)
- ⚠️ Sharing incidents with community (upload to StdOut service)

**Graceful degradation:**
```typescript
// src/lib/agent/rag/notebooklm.ts
export async function queryDocs(question: string, config: RAGConfig): Promise<string> {
  if (!config.docsSearchEnabled) {
    return ''; // Feature disabled by user
  }
  
  try {
    // Attempt NotebookLM query
    const result = await execFileSync('nlm', [...], { timeout: 5000 });
    return result.trim();
  } catch (error) {
    // Network failure or air-gapped
    console.warn('[RAG] Docs search unavailable (offline mode?)');
    return ''; // Fail silently, agent continues without docs
  }
}
```

### Custom Documentation (BYO Notebook)

**Enterprise feature:** Users can point Riggins at their own internal runbooks.

```yaml
Settings → Observatory → Agent Learning → Custom Documentation:
  
  NotebookLM Notebook ID: [________________]
  
  This allows Riggins to search YOUR internal documentation instead of 
  (or in addition to) StdOut's official docs.
  
  Examples:
  - Internal runbooks
  - Team-specific troubleshooting guides  
  - Custom deployment procedures
  
  ℹ️ Requires NotebookLM account with access to the notebook
```

```typescript
export async function queryDocs(question: string, config: RAGConfig): Promise<string> {
  const notebookId = config.customDocsNotebook || STDOUT_DOCS_NOTEBOOK;
  
  try {
    const result = execFileSync('nlm', [
      'notebook', 'query',
      notebookId,  // Use custom or default
      question
    ], { encoding: 'utf-8', timeout: 30000 });
    
    return result.trim();
  } catch (error) {
    // If custom notebook fails, try StdOut docs as fallback
    if (config.customDocsNotebook && notebookId !== STDOUT_DOCS_NOTEBOOK) {
      return queryDocs(question, { ...config, customDocsNotebook: undefined });
    }
    return '';
  }
}
```

### Privacy Controls (Community Sharing)

**When user enables "Share with Community":**

1. **Pre-submission review:**
   ```
   Riggins: "You resolved incident #1234 (nginx 502 errors). 
   Would you like to share this resolution with the StdOut community?
   
   [Preview what will be shared]
   - Problem: nginx returning 502 errors
   - Root cause: Upstream timeout too short
   - Resolution: Increased proxy_read_timeout to 60s
   
   Automatically redacted: container names, hostnames, IPs
   
   [Share] [Don't Share] [Never Ask Again]"
   ```

2. **Anonymization:**
   ```typescript
   function anonymizeIncident(incident: Incident): CommunityPattern {
     return {
       category: inferCategory(incident),
       title: incident.title,
       problem_description: redactSensitive(incident.description),
       symptoms: incident.symptoms,
       root_causes: [incident.diagnosis],
       resolutions: [redactSensitive(incident.resolution)],
       tags: extractTags(incident)
     };
   }
   
   function redactSensitive(text: string): string {
     return text
       .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '<IP>')
       .replace(/[a-z0-9-]+\.(local|internal|lan)/gi, '<hostname>')
       .replace(/container:[a-z0-9-]+/gi, 'container:<name>')
       .replace(/port:\d+/g, 'port:<N>');
   }
   ```

3. **Upload endpoint:**
   ```typescript
   // POST https://api.stdout.seayniclabs.com/v1/community/patterns
   // Only when user explicitly approves each submission
   ```

---

## Implementation Plan

### Phase 1: NotebookLM Docs RAG (2-3 hours)
**Goal:** Riggins can answer "how to" questions from documentation

1. Create `stdout-docs` NotebookLM notebook
2. Ingest StdOut docs (installation, troubleshooting, API reference)
3. Add `queryDocs()` function to agent
4. Add `query_documentation` tool
5. Update agent prompt to use docs when answering how-to questions
6. Test: "How do I configure Prometheus integration?"

**Deliverables:**
- `src/lib/agent/rag/notebooklm.ts`
- Updated `src/lib/agent/tools.ts` with new tool
- NotebookLM notebook created and seeded

### Phase 2: Incident History Learning (4-6 hours)
**Goal:** Riggins learns from past incidents and suggests resolutions

1. Add `incident_embeddings` table to schema
2. Create embedding generation on incident resolution
3. Implement `findSimilarIncidents()` function
4. Add `find_similar_incidents` tool
5. Update agent prompt to search history when diagnosing
6. Seed with 10-20 sample incidents for testing

**Deliverables:**
- Database migration: `0012_incident_embeddings.sql`
- `src/lib/agent/rag/incident-learning.ts`
- Background job: embed resolved incidents
- Updated agent tools

### Phase 3: Community Knowledge Base (3-4 hours)
**Goal:** Riggins leverages curated incident patterns

1. Add `community_patterns` + `community_pattern_embeddings` tables
2. Seed with 50+ common patterns (memory leaks, disk full, DNS issues, etc.)
3. Implement pattern search with embeddings
4. Add `search_community_knowledge` tool
5. Update agent prompt to check KB for known patterns

**Deliverables:**
- Database migration: `0013_community_kb.sql`
- `src/lib/db/seed-community-kb.ts` with 50+ patterns
- `src/lib/agent/rag/community-kb.ts`
- Updated agent tools

### Phase 4: Self-Learning Loop (2-3 hours)
**Goal:** Riggins improves over time from user feedback

1. Add feedback buttons to agent responses (👍 👎)
2. Store feedback with incident resolutions
3. Weight similar incident search by past feedback
4. Auto-promote high-rated resolutions to community KB

**Deliverables:**
- `agent_response_feedback` table
- Feedback UI in agent panel
- Weighted similarity search
- Auto-promotion logic

---

## Success Metrics

**Before (Baseline):**
- Agent responses: 80% "check metrics, restart container"
- User follow-up questions: 3-5 per incident
- Resolution suggestions: Generic, no historical context
- Documentation lookups: Manual (user opens docs separately)

**After (Target):**
- Agent responses: 60% include historical context + specific fixes
- User follow-up questions: 1-2 per incident
- Resolution suggestions: Contextual, based on past success
- Documentation lookups: Automatic (agent cites relevant docs)

**KPIs:**
- **Incident resolution speed**: -40% (faster due to historical suggestions)
- **Agent usefulness rating**: 3.2 → 4.5+ (out of 5)
- **Documentation access**: +300% (agent makes it discoverable)
- **Repeat incidents**: -60% (learns from past fixes)

---

## Technical Requirements

### Dependencies
- ✅ **Ollama** (already installed) - nomic-embed-text for embeddings
- ✅ **NotebookLM** (available) - nlm CLI installed on ThinkPad
- ✅ **SQLite** (current DB) - add new tables for embeddings/patterns
- ⚠️ **nlm auth** - Requires Google One Premium login on ThinkPad

### Infrastructure
- **Storage**: +50MB for embeddings (768-dim vectors, ~3KB per incident)
- **Compute**: Ollama embedding generation (~100ms per incident)
- **Network**: NotebookLM API calls (rate limited, ~5/min safe)

### Security
- Embeddings stored in tenant DB (isolated per user)
- Community KB shared across users (public knowledge only)
- NotebookLM notebook: read-only access, no sensitive data ingested

---

## Open Questions

1. **NotebookLM auth on ThinkPad**: Does nlm CLI have saved credentials, or need re-auth?
2. **Embedding model**: nomic-embed-text:latest available on ThinkPad Ollama? (verify)
3. **Community KB curation**: Who maintains/reviews community patterns before publishing?
4. **Feedback moderation**: Should downvoted resolutions be hidden or just de-prioritized?

---

## Next Steps

1. **Validate approach** - Get Charlie's approval on architecture
2. **Check dependencies** - Verify Ollama has nomic-embed-text, nlm auth works
3. **Phase 1 spike** - Build NotebookLM RAG proof-of-concept (1 hour)
4. **Full implementation** - Execute phases 1-4 sequentially
5. **Production deploy** - ThinkPad + docs update

---

## Related

- **Feature Backlog:** F007 (Riggins RAG + Learning)
- **Agent Definition:** `src/lib/agent/memory.ts` (current identity)
- **Tools:** `src/lib/agent/tools.ts` (current 6 tools)
- **NotebookLM Reference:** `Research/NotebookLM.md`
- **Ollama Models:** ThinkPad has nomic-embed-text (verified 2026-07-26)
