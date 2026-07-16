/**
 * Observatory Agent System Prompts
 *
 * These prompts inject agent identity, mission, and decision frameworks
 * into every local ML model call. They reference standard patterns and learned knowledge.
 */

import { AGENT_PERSONAS, type AgentPersona } from './agents';
import { METRIC_INTERPRETATIONS, interpretMetric } from './metrics-guide';
import { retrieveKnowledge, formatKnowledgeForPrompt } from './retrieval';

export interface WatcherContext {
  stackName: string;
  stackId: string;
  currentMetrics: Record<string, number>;
  baselines: Record<string, { mean: number; stdDev: number; sampleCount: number }>;
  recentIncidents: Array<{
    id: string;
    title: string;
    severity: string;
    createdAt: Date;
  }>;
  standardPatterns: Array<{
    id: string;
    patternName: string;
    category: string;
    symptoms: string[];
  }>;
  githubIntegrations: {
    endpoint: string;
    token: string;
  };
}

export interface AnalystContext {
  incident: {
    id: string;
    title: string;
    description: string;
    severity: string;
    createdAt: Date;
    metrics?: Record<string, number>;
  };
  stackConfig: {
    id: string;
    name: string;
    description: string;
    containerCount?: number;
  };
  similarIncidents: Array<{
    id: string;
    title: string;
    resolution: string;
    resolvedAt: Date;
    similarity: number;
  }>;
  standardPatterns: Array<{
    id: string;
    patternName: string;
    category: string;
    symptoms: string[];
    commonCauses: string[];
    resolutionSteps: string[];
  }>;
  relevantDocs?: Array<{
    title: string;
    content: string;
  }>;
  githubIntegrations: {
    endpoint: string;
    token: string;
  };
}

/**
 * Build system prompt for Watcher agent with retrieved knowledge
 */
export async function buildWatcherPromptWithKnowledge(
  userId: string,
  context: WatcherContext
): Promise<string> {
  // Retrieve relevant knowledge from the learning layer
  const symptoms = detectSymptoms(context);
  const knowledge = await retrieveKnowledge(userId, {
    stackId: context.stackId,
    stackName: context.stackName,
    symptoms,
    timeWindowHours: 24
  });

  const basePrompt = buildWatcherPrompt(context);
  const knowledgeSection = formatKnowledgeForPrompt(knowledge);

  return `${basePrompt}

# RETRIEVED KNOWLEDGE
${knowledgeSection}

Remember: This knowledge comes from both standard patterns (library) and your past observations (custom patterns). Use it to inform your decision.
`;
}

/**
 * Build system prompt for Watcher agent (without knowledge retrieval)
 * Use buildWatcherPromptWithKnowledge for production
 */
export function buildWatcherPrompt(context: WatcherContext): string {
  const persona = AGENT_PERSONAS.watcher;

  const metricsWithInterpretation = Object.entries(context.currentMetrics)
    .map(([name, value]) => {
      const baseline = context.baselines[name];
      const interpretation = interpretMetric(name, value);
      const deviation = baseline
        ? ((value - baseline.mean) / baseline.stdDev).toFixed(2)
        : 'N/A';

      return `  ${name}: ${value.toFixed(2)} ${interpretation.level === 'high' || interpretation.level === 'critical' ? '⚠️' : ''}
    Baseline: ${baseline ? `${baseline.mean.toFixed(2)} ± ${baseline.stdDev.toFixed(2)} (deviation: ${deviation}σ)` : 'Not yet established'}
    Status: ${interpretation.message}`;
    })
    .join('\n\n');

  return `You are ${persona.name}, a ${persona.role}.

# YOUR MISSION
${persona.mission}

# YOUR OBJECTIVES
${persona.objectives.map((obj, i) => `${i + 1}. ${obj}`).join('\n')}

# CURRENT SITUATION
**Stack:** ${context.stackName} (${context.stackId})
**Time:** ${new Date().toISOString()}
**Check Interval:** Every ${persona.check_interval_seconds} seconds

## Current Metrics
${metricsWithInterpretation}

## Recent Incidents (last 24h)
${context.recentIncidents.length > 0
    ? context.recentIncidents
        .map(
          (inc) =>
            `- [${inc.severity.toUpperCase()}] ${inc.title} (${new Date(inc.createdAt).toLocaleString()})`
        )
        .join('\n')
    : '  No recent incidents'}

## Standard Patterns to Consider
${context.standardPatterns.length > 0
    ? context.standardPatterns
        .slice(0, 5)
        .map((p) => `- ${p.patternName} (${p.category})\n  Symptoms: ${p.symptoms.slice(0, 2).join('; ')}`)
        .join('\n\n')
    : '  Loading standard patterns...'}

# DECISION FRAMEWORK

## Alert IF:
${persona.decision_criteria.alert_if?.map((rule) => `✓ ${rule}`).join('\n')}

## Ignore IF:
${persona.decision_criteria.ignore_if?.map((rule) => `✗ ${rule}`).join('\n')}

# YOUR TASK

Analyze the current metrics against baselines and recent history.

**If you detect an anomaly:**
1. Calculate deviation from baseline (in standard deviations)
2. Check if this matches any standard patterns
3. Review if similar incidents occurred recently
4. Decide: Create incident OR ignore

**Output Format (JSON only, no additional text):**
\`\`\`json
{
  "anomaly_detected": boolean,
  "metric_name": string | null,
  "current_value": number | null,
  "baseline": { "mean": number, "std_dev": number } | null,
  "deviation_sigma": number | null,
  "matched_pattern": string | null,
  "confidence": number, // 0.0-1.0
  "reasoning": string,
  "recommended_action": "create_incident" | "monitor" | "ignore",
  "suggested_severity": "low" | "medium" | "high" | "critical" | null,
  "suggested_title": string | null
}
\`\`\`

**If no anomaly detected, return:**
\`\`\`json
{
  "anomaly_detected": false,
  "confidence": 1.0,
  "reasoning": "All metrics within normal range"
}
\`\`\`

Be conservative - false positives erode user trust. Only alert on sustained anomalies (>2 checks) with clear evidence.
`;
}

/**
 * Build system prompt for Analyst agent with retrieved knowledge
 */
export async function buildAnalystPromptWithKnowledge(
  userId: string,
  context: AnalystContext
): Promise<string> {
  // Extract symptoms from incident description
  const symptoms = [
    ...context.incident.title.toLowerCase().split(/\s+/),
    ...context.incident.description.toLowerCase().split(/\s+/)
  ].filter(word => word.length > 4); // Filter out short words

  // Retrieve relevant knowledge
  const knowledge = await retrieveKnowledge(userId, {
    stackId: context.stackConfig.id,
    stackName: context.stackConfig.name,
    symptoms: symptoms.slice(0, 10), // Top 10 keywords
    timeWindowHours: 168 // 7 days
  });

  const basePrompt = buildAnalystPrompt(context);
  const knowledgeSection = formatKnowledgeForPrompt(knowledge);

  return `${basePrompt}

# RETRIEVED KNOWLEDGE
${knowledgeSection}

Use this knowledge to inform your diagnosis. Similar past incidents show what worked before. Baselines help you understand if metrics are truly abnormal.
`;
}

/**
 * Build system prompt for Analyst agent (without knowledge retrieval)
 * Use buildAnalystPromptWithKnowledge for production
 */
export function buildAnalystPrompt(context: AnalystContext): string {
  const persona = AGENT_PERSONAS.analyst;

  return `You are ${persona.name}, a ${persona.role}.

# YOUR MISSION
${persona.mission}

# YOUR OBJECTIVES
${persona.objectives.map((obj, i) => `${i + 1}. ${obj}`).join('\n')}

# INCIDENT TO INVESTIGATE
**ID:** ${context.incident.id}
**Title:** ${context.incident.title}
**Severity:** ${context.incident.severity.toUpperCase()}
**Created:** ${new Date(context.incident.createdAt).toLocaleString()}

**Description:**
${context.incident.description}

${context.incident.metrics
    ? `**Current Metrics:**
${Object.entries(context.incident.metrics)
      .map(([name, value]) => `  ${name}: ${value}`)
      .join('\n')}`
    : ''}

# STACK CONFIGURATION
**Name:** ${context.stackConfig.name}
**Description:**
${context.stackConfig.description}

${context.stackConfig.containerCount ? `**Containers:** ${context.stackConfig.containerCount}` : ''}

# SIMILAR PAST INCIDENTS
${context.similarIncidents.length > 0
    ? context.similarIncidents
        .map(
          (inc) =>
            `## ${inc.title} (${(inc.similarity * 100).toFixed(0)}% match)
**Resolved:** ${new Date(inc.resolvedAt).toLocaleString()}
**Resolution:**
${inc.resolution}`
        )
        .join('\n\n')
    : 'No similar incidents found in this stack\'s history.'}

# STANDARD PATTERNS TO CONSIDER
${context.standardPatterns.length > 0
    ? context.standardPatterns
        .map(
          (p) =>
            `## ${p.patternName} (${p.category})
**Symptoms:**
${p.symptoms.map((s) => `- ${s}`).join('\n')}

**Common Causes:**
${p.commonCauses.map((c) => `- ${c}`).join('\n')}

**Resolution Steps:**
${p.resolutionSteps.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
        )
        .join('\n\n')
    : 'No matching standard patterns found.'}

${context.relevantDocs && context.relevantDocs.length > 0
    ? `# RELEVANT DOCUMENTATION
${context.relevantDocs
      .map(
        (doc) =>
          `## ${doc.title}
${doc.content.substring(0, 500)}${doc.content.length > 500 ? '...' : ''}`
      )
      .join('\n\n')}`
    : ''}

# DECISION FRAMEWORK

## Investigate IF:
${persona.decision_criteria.investigate_if?.map((rule) => `✓ ${rule}`).join('\n')}

## Suggest Resolution IF:
${persona.decision_criteria.suggest_resolution_if?.map((rule) => `✓ ${rule}`).join('\n')}

## Escalate to Human IF:
${persona.decision_criteria.escalate_to_human_if?.map((rule) => `⚠️ ${rule}`).join('\n')}

# YOUR TASK

Investigate this incident and provide a diagnosis with recommended resolution.

**Output Format (JSON only, no additional text):**
\`\`\`json
{
  "diagnosis": {
    "primary_cause": string,
    "confidence": number, // 0.0-1.0
    "supporting_evidence": string[]
  },
  "alternative_causes": [
    { "cause": string, "confidence": number, "reasoning": string }
  ],
  "recommended_resolution": {
    "steps": string[],
    "estimated_time": string,
    "rollback_plan": string,
    "risks": string[]
  },
  "matched_pattern": string | null,
  "requires_human": boolean,
  "reasoning": string
}
\`\`\`

Provide actionable, specific steps. Reference past successful resolutions when available. Be honest about uncertainty - escalate to human if confidence is low.
`;
}

/**
 * Detect symptoms from current metrics vs baselines
 *
 * Translates metric deviations into searchable symptom keywords
 */
function detectSymptoms(context: WatcherContext): string[] {
  const symptoms: string[] = [];

  for (const [metricName, value] of Object.entries(context.currentMetrics)) {
    const baseline = context.baselines[metricName];
    if (!baseline) continue;

    const deviation = (value - baseline.mean) / baseline.stdDev;

    // High deviation symptoms
    if (Math.abs(deviation) > 2) {
      if (metricName.includes('cpu')) {
        symptoms.push('high cpu usage', 'cpu spike');
      } else if (metricName.includes('memory')) {
        symptoms.push('memory leak', 'high memory usage');
      } else if (metricName.includes('disk')) {
        symptoms.push('disk space exhaustion', 'high disk usage');
      } else if (metricName.includes('network')) {
        symptoms.push('network errors', 'connectivity issues');
      } else if (metricName.includes('response_time')) {
        symptoms.push('slow response', 'high latency');
      }
    }

    // Direction-specific symptoms
    if (deviation > 3) {
      symptoms.push('resource exhaustion', 'performance degradation');
    }
  }

  return [...new Set(symptoms)]; // Deduplicate
}

/**
 * Format agent output for storage and display
 */
export function formatAgentOutput(
  agentType: 'watcher' | 'analyst',
  rawOutput: string
): {
  parsed: Record<string, unknown>;
  displaySummary: string;
} {
  try {
    // Extract JSON from markdown code blocks if present
    const jsonMatch = rawOutput.match(/```json\n([\s\S]+?)\n```/) || rawOutput.match(/```\n([\s\S]+?)\n```/);
    const jsonString = jsonMatch ? jsonMatch[1] : rawOutput;

    const parsed = JSON.parse(jsonString);

    let displaySummary = '';

    if (agentType === 'watcher') {
      if (parsed.anomaly_detected) {
        displaySummary = `⚠️ Anomaly detected in ${parsed.metric_name}: ${parsed.current_value} (${parsed.deviation_sigma}σ from baseline). ${parsed.reasoning}`;
      } else {
        displaySummary = `✓ No anomalies detected. ${parsed.reasoning}`;
      }
    } else if (agentType === 'analyst') {
      displaySummary = `Diagnosis: ${parsed.diagnosis.primary_cause} (${(parsed.diagnosis.confidence * 100).toFixed(0)}% confidence). ${parsed.requires_human ? '⚠️ Human review recommended.' : '✓ Resolution available.'}`;
    }

    return {
      parsed,
      displaySummary
    };
  } catch (error) {
    return {
      parsed: null,
      displaySummary: `Error parsing agent output: ${error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)}`
    };
  }
}
