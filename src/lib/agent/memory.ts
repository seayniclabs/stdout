/**
 * Observatory Agent Memory Service
 *
 * 4-Tier Memory Architecture:
 * Layer 1: Identity (static, agent persona)
 * Layer 2: Context (customer's infrastructure - stacks, data sources)
 * Layer 3: Conversations (last 10 exchanges from DB)
 * Layer 4: Working Memory (session-only, in-memory)
 */

import { getDb, getSqlite } from '../db';
import { eq, desc } from 'drizzle-orm';
import { stacks } from '../db/tenant-schema';
import { dataSources } from '../db/tenant-schema';
import { agentConversations } from '../db/central-schema';
import type { ConversationMessage } from './types';

export interface Memory {
  identity: string;
  context: string;
  conversations: Array<{ role: string; content: string }>;
  working: Map<string, any>;
}

const IDENTITY_MD = `# Steer — Observatory Agent Identity

You are Steer, the Observatory Agent built into StdOut infrastructure monitoring.

## Your Role
- Help users understand their infrastructure metrics
- Explain anomalies and baselines detected by Observatory Watcher/Sentinel
- Execute operations based on user permissions (read-only, operator, or admin)
- Be honest about your skill level and limitations

## Your Capabilities
Governed by the user's Observatory access level:
- **Read-only**: Query metrics, explain baselines, interpret data
- **Operator**: + Acknowledge incidents, restart containers, trigger manual checks
- **Admin**: + Modify data sources, change baselines, configure monitors

Available Observatory APIs you can call:
- /api/observatory/metrics — read live metrics from Prometheus
- /api/observatory/baselines — query established baselines
- /api/observatory/runs — view Watcher/Sentinel detection runs
- /api/observatory/incidents — read/acknowledge incidents
- /api/stacks/:id/containers/:name/restart — restart container (operator+)

## Your Constraints
- Never perform destructive actions without explicit user confirmation
- Always explain what you're about to do before doing it
- If you can't answer with confidence, say so and suggest alternatives
- When your model is too small for complex reasoning, tell the user honestly

## Communication Style
- Direct and technical (users are DevOps/SRE professionals)
- Lead with facts: "Memory is at 87% (baseline: 45%)"
- Suggest actions: "Should I restart prod-worker?"
- Explain limits: "My current model (${MODEL_NAME}) can't diagnose this fully. Consider connecting Claude or Gemini for deeper analysis."

## Graceful Degradation
If your model is small and the query is complex:
1. Answer what you CAN answer with the data available
2. Be explicit about what you CANNOT determine
3. Suggest what AI upgrade would help:
   - Larger Ollama model (qwen2.5:14b, deepseek-r1:14b)
   - Anthropic API (Claude Sonnet for deep reasoning)
   - Gemini API (large context, fast responses)
`;

/**
 * Load full 4-tier memory for agent context
 */
export async function loadMemory(
  userId: string,
  conversationLimit = 10
): Promise<Memory> {
  const central = getSqlite();
  const tenant = getDb();

  // Layer 1: Identity (static)
  const identity = IDENTITY_MD;

  // Layer 2: Context (customer's infrastructure)
  const context = await buildContextString(userId, tenant);

  // Layer 3: Conversations (last N from DB)
  const conversations = await loadConversationHistory(userId, central, conversationLimit);

  // Layer 4: Working memory (empty, populated during session)
  const working = new Map<string, any>();

  return { identity, context, conversations, working };
}

/**
 * Build context string from customer's stacks and data sources
 */
async function buildContextString(userId: string, tenant: any): Promise<string> {
  let context = '## Customer Infrastructure\n\n';

  // Load stacks
  const customerStacks = await tenant
    .select()
    .from(stacks)
    .where(eq(stacks.userId, userId));

  if (customerStacks.length === 0) {
    context += 'No stacks configured yet.\n';
  } else {
    context += `### Stacks (${customerStacks.length})\n`;
    for (const stack of customerStacks) {
      const containers = JSON.parse(stack.containers || '[]');
      context += `- **${stack.name}**: ${containers.length} containers\n`;
    }
  }

  // Load data sources
  const sources = await tenant
    .select()
    .from(dataSources)
    .where(eq(dataSources.userId, userId));

  if (sources.length > 0) {
    context += `\n### Data Sources (${sources.length})\n`;
    for (const source of sources) {
      context += `- ${source.name} (${source.type}) at ${source.url}\n`;
    }
  }

  context += '\n---\n';
  return context;
}

/**
 * Load recent conversation history from DB
 */
async function loadConversationHistory(
  userId: string,
  central: any,
  limit: number
): Promise<Array<{ role: string; content: string }>> {
  const rows = central.prepare(`
    SELECT role, content
    FROM agent_conversations
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit);

  // Reverse to chronological order (oldest first)
  return rows.reverse().map((row: any) => ({
    role: row.role,
    content: row.content,
  }));
}

/**
 * Build full context prompt from loaded memory for AI routing
 */
export function buildPromptContext(memory: Memory): string {
  let context = memory.identity + '\n\n';
  context += '## Your Context\n' + memory.context + '\n\n';

  if (memory.conversations.length > 0) {
    context += '## Recent Conversation History\n';
    for (const msg of memory.conversations) {
      context += `${msg.role === 'user' ? 'User' : 'You'}: ${msg.content}\n`;
    }
    context += '\n';
  }

  return context;
}

/**
 * Save a conversation message to DB
 */
export async function saveConversation(
  userId: string,
  role: 'user' | 'assistant',
  content: string,
  metadata?: any
): Promise<void> {
  const central = getSqlite();
  const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const now = Date.now();

  central.prepare(`
    INSERT INTO agent_conversations (id, user_id, role, content, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    userId,
    role,
    content,
    metadata ? JSON.stringify(metadata) : null,
    now
  );
}

/**
 * Clear conversation history for a user (user-invoked via /memory clear)
 */
export async function clearConversationHistory(userId: string): Promise<void> {
  const central = getSqlite();

  central.prepare(`
    DELETE FROM agent_conversations
    WHERE user_id = ?
  `).run(userId);
}
