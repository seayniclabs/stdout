/**
 * Observatory Agent Tool Definitions
 *
 * Tools the agent can use to interact with infrastructure.
 * Each tool maps to an Observatory API endpoint.
 */

export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required: string[];
  };
}

export const OBSERVATORY_TOOLS: Tool[] = [
  {
    name: 'get_metrics',
    description: 'Get current metrics for all stacks or a specific stack. Returns CPU, memory, disk, network stats.',
    parameters: {
      type: 'object',
      properties: {
        stack_id: {
          type: 'string',
          description: 'Optional stack ID to filter metrics. Omit to get all stacks.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_baselines',
    description: 'Get established baselines for metrics. Shows normal ranges for CPU, memory, disk usage.',
    parameters: {
      type: 'object',
      properties: {
        stack_id: {
          type: 'string',
          description: 'Stack ID to get baselines for',
        },
      },
      required: ['stack_id'],
    },
  },
  {
    name: 'get_incidents',
    description: 'List recent incidents detected by Observatory. Can filter by status and severity.',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Filter by status',
          enum: ['active', 'investigating', 'monitoring', 'resolved'],
        },
        severity: {
          type: 'string',
          description: 'Filter by severity',
          enum: ['critical', 'high', 'medium', 'low'],
        },
      },
      required: [],
    },
  },
  {
    name: 'get_stacks',
    description: 'List all configured stacks (Docker Compose projects, VMs, etc.)',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'restart_container',
    description: 'Restart a specific container in a stack. Requires operator or admin permission. Use for external stacks only - use restart_stdout_service for StdOut itself.',
    parameters: {
      type: 'object',
      properties: {
        stack_id: {
          type: 'string',
          description: 'Stack ID containing the container',
        },
        container_name: {
          type: 'string',
          description: 'Name of the container to restart',
        },
      },
      required: ['stack_id', 'container_name'],
    },
  },
  {
    name: 'restart_stdout_service',
    description: 'SELF-HEALING: Restart StdOut itself or its internal services. No approval needed - this is self-healing.',
    parameters: {
      type: 'object',
      properties: {
        service: {
          type: 'string',
          description: 'Which service to restart',
          enum: ['container', 'watcher', 'monitors'],
        },
      },
      required: ['service'],
    },
  },
  {
    name: 'clear_stdout_cache',
    description: 'SELF-HEALING: Clear StdOut internal caches. No approval needed.',
    parameters: {
      type: 'object',
      properties: {
        cache_type: {
          type: 'string',
          description: 'Which cache to clear',
          enum: ['metrics', 'baselines', 'all'],
        },
      },
      required: ['cache_type'],
    },
  },
  {
    name: 'query_documentation',
    description: 'Search StdOut documentation, runbooks, and troubleshooting guides for answers to user questions. Use when user asks "how to" or you need context beyond current metrics.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question to ask the documentation (e.g. "How do I configure Prometheus integration?")',
        },
      },
      required: ['question'],
    },
  },
];

/**
 * Execute a tool call by making the appropriate API request
 * Uses localhost:3000 (internal to container) for self-contained execution
 */
export async function executeTool(
  toolName: string,
  parameters: Record<string, any>,
  userId: string
): Promise<{ success: boolean; result: any; error?: string }> {
  const BASE_URL = 'http://localhost:3000'; // Internal to StdOut container

  try {
    switch (toolName) {
      case 'get_metrics': {
        const url = parameters.stack_id
          ? `${BASE_URL}/app/api/observatory/metrics?stack_id=${parameters.stack_id}`
          : `${BASE_URL}/app/api/observatory/metrics`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return { success: true, result: data };
      }

      case 'get_baselines': {
        const url = `${BASE_URL}/app/api/observatory/baselines?stack_id=${parameters.stack_id}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return { success: true, result: data };
      }

      case 'get_incidents': {
        const params = new URLSearchParams();
        if (parameters.status) params.set('status', parameters.status);
        if (parameters.severity) params.set('severity', parameters.severity);
        const url = `${BASE_URL}/app/api/observatory/incidents?${params.toString()}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return { success: true, result: data };
      }

      case 'get_stacks': {
        const res = await fetch(`${BASE_URL}/app/api/stacks`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return { success: true, result: data };
      }

      case 'restart_container': {
        const url = `${BASE_URL}/app/api/stacks/${parameters.stack_id}/containers/${parameters.container_name}/restart`;
        const res = await fetch(url, { method: 'POST' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return { success: true, result: data };
      }

      case 'restart_stdout_service': {
        // Self-healing: restart StdOut's own services
        const { service } = parameters;

        if (service === 'container') {
          // Restart the entire StdOut container (via Windlass if available)
          const res = await fetch(`${BASE_URL}/app/api/windlass/exec`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              command: 'docker restart stdout',
            }),
          });
          if (!res.ok) throw new Error(`Failed to restart container: HTTP ${res.status}`);
          return { success: true, result: { restarted: 'stdout container' } };
        }

        if (service === 'watcher') {
          // Restart Observatory Watcher (via internal API)
          const res = await fetch(`${BASE_URL}/app/api/observatory/watcher/restart`, {
            method: 'POST',
          });
          if (!res.ok) throw new Error(`Failed to restart watcher: HTTP ${res.status}`);
          return { success: true, result: { restarted: 'Observatory Watcher' } };
        }

        if (service === 'monitors') {
          // Restart all monitors
          const res = await fetch(`${BASE_URL}/app/api/monitors/restart-all`, {
            method: 'POST',
          });
          if (!res.ok) throw new Error(`Failed to restart monitors: HTTP ${res.status}`);
          return { success: true, result: { restarted: 'all monitors' } };
        }

        return { success: false, result: null, error: `Unknown service: ${service}` };
      }

      case 'clear_stdout_cache': {
        // Self-healing: clear internal caches
        const { cache_type } = parameters;
        const res = await fetch(`${BASE_URL}/app/api/observatory/cache/clear`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: cache_type }),
        });

        if (!res.ok) throw new Error(`Failed to clear cache: HTTP ${res.status}`);
        const data = await res.json();
        return { success: true, result: data };
      }

      case 'query_documentation': {
        // RAG: Search StdOut documentation via NotebookLM
        const { queryDocs } = await import('./rag/notebooklm');
        const result = await queryDocs(parameters.question);

        if (!result.available) {
          return {
            success: false,
            result: null,
            error: result.error || 'Documentation search unavailable'
          };
        }

        return {
          success: true,
          result: {
            answer: result.answer,
            source: 'StdOut Documentation (NotebookLM)'
          }
        };
      }

      default:
        return {
          success: false,
          result: null,
          error: `Unknown tool: ${toolName}`,
        };
    }
  } catch (error) {
    return {
      success: false,
      result: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
