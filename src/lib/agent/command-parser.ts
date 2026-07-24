/**
 * Command Parser - Direct tool execution for explicit commands
 *
 * Bypasses LLM for fast execution of clear infrastructure management commands.
 * Falls back to LLM for conversational queries.
 */

export interface CommandMatch {
  intent: 'scan_network' | 'create_monitors' | 'create_stack' | 'help' | null;
  confidence: number;
  args?: Record<string, any>;
}

/**
 * Parse user message to detect explicit commands
 */
export function parseCommand(message: string): CommandMatch {
  const lower = message.toLowerCase().trim();

  // Network scanning commands
  if (
    (lower.includes('scan') && (lower.includes('network') || lower.includes('infrastructure'))) ||
    (lower.includes('discover') && (lower.includes('device') || lower.includes('network') || lower.includes('service'))) ||
    (lower.includes('find') && (lower.includes('device') || lower.includes('service')))
  ) {
    return {
      intent: 'scan_network',
      confidence: 0.95,
    };
  }

  // Monitor creation commands
  if (
    (lower.includes('create') || lower.includes('set up') || lower.includes('setup')) &&
    (lower.includes('monitor') || lower.includes('monitoring'))
  ) {
    return {
      intent: 'create_monitors',
      confidence: 0.9,
    };
  }

  // Stack creation commands
  if (
    (lower.includes('create') || lower.includes('set up') || lower.includes('setup')) &&
    (lower.includes('stack') || lower.includes('group'))
  ) {
    return {
      intent: 'create_stack',
      confidence: 0.85,
      args: {
        // Extract stack name if present
        name: extractStackName(message),
      },
    };
  }

  // Combined scan + monitor setup
  if (
    (lower.includes('scan') || lower.includes('discover')) &&
    (lower.includes('monitor') || lower.includes('set up monitoring') || lower.includes('setup monitoring'))
  ) {
    return {
      intent: 'scan_network',
      confidence: 0.95,
      args: {
        createMonitors: true,
      },
    };
  }

  // Help/capability queries
  if (
    lower.includes('what can you do') ||
    lower.includes('how can you help') ||
    lower.includes('help')
  ) {
    return {
      intent: 'help',
      confidence: 1.0,
    };
  }

  // No clear command detected - fall back to LLM
  return {
    intent: null,
    confidence: 0,
  };
}

/**
 * Extract stack name from message
 */
function extractStackName(message: string): string | undefined {
  // Look for patterns like "create a stack called X" or "create X stack"
  const patterns = [
    /stack (?:called|named) ["']?([^"']+)["']?/i,
    /create ["']?([^"']+)["']? stack/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

/**
 * Get help text
 */
export function getHelpText(): string {
  return `I'm Riggins, your Observatory AI. I can help you manage your infrastructure:

**Network Discovery**
- "scan my network" - Discover all devices and services
- "find all devices" - Network-wide device discovery

**Monitoring**
- "set up monitoring" - Create monitors for discovered services
- "create monitors" - Auto-configure monitoring

**Infrastructure Management**
- "create a stack called X" - Create a new infrastructure stack
- "show me what's running" - View active services

**Analysis**
- Ask me about metrics, incidents, or anomalies
- "What's using CPU?" or "Explain this spike"

Just tell me what you need and I'll get it done!`;
}
