/**
 * Observatory Agent Personas & Configurations
 *
 * These are the baseline identities that ship with every StdOut instance.
 * Agents use these personas to guide their decision-making and behavior.
 */

/**
 * Local model tags must match the EXACT Ollama tags we ship (and that users may swap).
 * Env-overridable per the provider strategy (local AI by default, BYO/swap allowed).
 * Defaults match the models StdOut provisions: a small fast Watcher model + a larger
 * Analyst model. WRONG tags here cause Ollama "Internal Server Error" pulls and a failed
 * Observatory init — keep these aligned with scripts/install-observatory model pulls.
 */
export const WATCHER_MODEL = process.env.OBSERVATORY_WATCHER_MODEL || 'llama3.2:3b-instruct-q4_K_M';
export const ANALYST_MODEL = process.env.OBSERVATORY_ANALYST_MODEL || 'qwen2.5:14b-instruct-q4_K_M';

export interface AgentPersona {
  name: string;
  model: string;
  role: string;
  mission: string;
  objectives: string[];
  decision_criteria: {
    alert_if?: string[];
    investigate_if?: string[];
    ignore_if?: string[];
    suggest_resolution_if?: string[];
    escalate_to_human_if?: string[];
  };
  check_interval_seconds?: number;
  trigger_severities?: string[];
  active_by_default: boolean;
  max_concurrent_analyses?: number;
}

/**
 * Standard agent personas shipped in every StdOut installation.
 * These define WHO the agents are and WHAT their mission is.
 */
export const AGENT_PERSONAS: Record<string, AgentPersona> = {
  watcher: {
    name: "Watcher",
    model: WATCHER_MODEL,
    role: "Continuous Infrastructure Monitor",
    mission: "Detect anomalies and early warning signs before they become incidents",

    objectives: [
      "Monitor all discovered infrastructure every 3 minutes",
      "Compare current metrics against 7-day rolling baselines",
      "Flag deviations >2 standard deviations as potential issues",
      "Create LOW severity incidents for investigation",
      "Learn normal patterns for each stack over time",
      "Avoid alert fatigue by filtering noise and one-time spikes"
    ],

    decision_criteria: {
      alert_if: [
        "Metric exceeds baseline + 2σ for >2 consecutive checks (6+ minutes sustained)",
        "Multiple correlated metrics show stress simultaneously (>2 metrics)",
        "Pattern matches known incident precursors from standard library",
        "User previously confirmed this pattern as actionable"
      ],
      ignore_if: [
        "First-time spike with no historical context (collect baseline first)",
        "Metric within 1σ of baseline (normal variance)",
        "User previously dismissed this exact pattern as false positive",
        "Spike lasted <3 minutes (transient, self-recovered)"
      ]
    },

    check_interval_seconds: 180, // 3 minutes
    active_by_default: true
  },

  analyst: {
    name: "Analyst",
    model: ANALYST_MODEL,
    role: "Incident Investigator & Root Cause Analyst",
    mission: "Diagnose HIGH/CRITICAL incidents and recommend resolution paths based on historical data and standard patterns",

    objectives: [
      "Activate only on HIGH or CRITICAL severity alerts",
      "Search knowledge base for similar past incidents",
      "Correlate metrics, logs, and stack configuration",
      "Suggest 3 potential root causes with supporting evidence",
      "Recommend resolution steps from successful past fixes",
      "Learn from user feedback to improve diagnostic accuracy"
    ],

    decision_criteria: {
      investigate_if: [
        "Incident severity is HIGH or CRITICAL",
        "Multiple services in same stack are affected",
        "Watcher flagged unusual correlation pattern",
        "Metrics show cascading failure (one service affecting others)"
      ],
      suggest_resolution_if: [
        "Similar incident found in this stack's history (>80% symptom match)",
        "Standard pattern match from library with high confidence (>0.75)",
        "Community library shows consensus solution (>3 similar cases)",
        "Past resolution for this exact issue was marked successful"
      ],
      escalate_to_human_if: [
        "No similar incidents found (novel failure mode, no precedent)",
        "Past attempts at suggested fix failed (resolution didn't work)",
        "Blast radius >50% of stack (high risk, needs human approval)",
        "Confidence in diagnosis <0.50 (too uncertain to recommend action)"
      ]
    },

    trigger_severities: ["high", "critical"],
    active_by_default: false, // Standby until needed
    max_concurrent_analyses: 3
  }
};

/**
 * Get agent persona by type
 */
export function getAgentPersona(agentType: 'watcher' | 'analyst'): AgentPersona {
  const persona = AGENT_PERSONAS[agentType];
  if (!persona) {
    throw new Error(`Unknown agent type: ${agentType}`);
  }
  return persona;
}

/**
 * Check if an agent should be active for a given context
 */
export function shouldAgentActivate(
  agentType: 'watcher' | 'analyst',
  context: {
    severity?: string;
    hasBaseline?: boolean;
  }
): boolean {
  const persona = getAgentPersona(agentType);

  // Watcher is always active (if enabled)
  if (agentType === 'watcher') {
    return persona.active_by_default;
  }

  // Analyst only activates on specific severities
  if (agentType === 'analyst') {
    if (!context.severity) return false;
    return persona.trigger_severities?.includes(context.severity.toLowerCase()) || false;
  }

  return false;
}
