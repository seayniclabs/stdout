/**
 * Riggins Diagnosis - LLM Router Integration
 *
 * This module replaces direct Anthropic API calls with the LLM router,
 * enabling task-based model selection (NVIDIA NIM code models for ops tasks).
 */

import { queryLLM } from './llm/router';
import { getRigginsSystemPrompt } from './riggins/system-prompt';

export interface DataSourceContext {
  type: string;
  name: string;
  enabled: boolean;
}

export interface DiagnosisResult {
  rootCauses: string[];
  suggestedCommands: string[];
  model: string;
  promptTokens: number;
  completionTokens: number;
}

const DATA_SOURCE_DESCRIPTIONS: Record<string, string> = {
  influxdb: 'InfluxDB for time-series metrics collection and querying',
  prometheus: 'Prometheus for metrics scraping and alerting',
  trivy: 'Trivy for container vulnerability scanning',
  'uptime-kuma': 'Uptime Kuma for monitoring service availability and uptime',
  loki: 'Loki for centralized log aggregation and querying',
  graylog: 'Graylog for log management, analysis, and alerting',
  crowdsec: 'CrowdSec for collaborative intrusion detection and prevention',
  pihole: 'Pi-hole for DNS filtering, ad blocking, and DNS query analytics',
};

export async function diagnoseIncident(opts: {
  stackContext: string;
  incidentDescription: string;
  pastResolutions: string[];
  tier: 'free' | 'paid';
  dataSources?: DataSourceContext[];
}): Promise<DiagnosisResult> {
  const pastResolutionsBlock = opts.pastResolutions.length > 0
    ? `\n\nPast resolutions for similar incidents:\n${opts.pastResolutions.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
    : '';

  let dataSourcesBlock = '';
  if (opts.dataSources && opts.dataSources.length > 0) {
    const lines = opts.dataSources
      .filter((ds) => ds.enabled)
      .map((ds) => {
        const desc = DATA_SOURCE_DESCRIPTIONS[ds.type] || ds.type;
        return `- ${ds.name}: ${desc}`;
      });
    if (lines.length > 0) {
      dataSourcesBlock = `\n\nThe user has the following monitoring and security tools available:\n${lines.join('\n')}\nConsider what data from these tools might help diagnose the issue, and suggest relevant queries or commands.`;
    }
  }

  // Load Riggins's persistent system prompt
  const rigginsPrompt = getRigginsSystemPrompt();

  // Append task-specific diagnosis instructions
  const systemPrompt = `${rigginsPrompt}

## CURRENT TASK: Incident Diagnosis

The user runs the following stack:
${opts.stackContext}${pastResolutionsBlock}${dataSourcesBlock}

Respond with a JSON object containing:
- "rootCauses": array of strings, ranked by likelihood (most likely first). Each should be 1-2 sentences.
- "suggestedCommands": array of shell commands to run for diagnosis.

Respond ONLY with valid JSON, no markdown fences.`;

  const userMessage = `Incident: ${opts.incidentDescription}`;

  // Use LLM router with incident_diagnosis task type
  const response = await queryLLM({
    taskType: 'incident_diagnosis',
    prompt: `${systemPrompt}\n\n${userMessage}`,
    maxTokens: 2000,
  });

  // Parse JSON response
  let parsed: { rootCauses: string[]; suggestedCommands: string[] };
  try {
    // Strip markdown fences if model added them despite instructions
    let cleaned = response.content.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\n/, '').replace(/\n```$/, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\n/, '').replace(/\n```$/, '');
    }
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error('Failed to parse diagnosis response:', response.content);
    throw new Error('Diagnosis response was not valid JSON');
  }

  return {
    rootCauses: parsed.rootCauses || [],
    suggestedCommands: parsed.suggestedCommands || [],
    model: response.modelUsed,
    // Note: Not all providers return token counts
    promptTokens: response.tokensUsed || 0,
    completionTokens: 0,
  };
}

/**
 * Analyze logs using the LLM router
 */
export async function analyzeLogs(opts: {
  logContent: string;
  context?: string;
}): Promise<{ issues: string[]; patterns: string[]; model: string }> {
  const systemPrompt = `You are analyzing system logs to identify errors, warnings, and patterns.

Extract:
1. "issues": Critical errors or warnings that need attention
2. "patterns": Recurring patterns or trends in the logs

Respond with JSON only, no markdown fences.`;

  const userMessage = opts.context
    ? `Context: ${opts.context}\n\nLogs:\n${opts.logContent}`
    : `Logs:\n${opts.logContent}`;

  const response = await queryLLM({
    taskType: 'log_analysis',
    prompt: `${systemPrompt}\n\n${userMessage}`,
    maxTokens: 1500,
  });

  let parsed: { issues: string[]; patterns: string[] };
  try {
    let cleaned = response.content.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\n/, '').replace(/\n```$/, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\n/, '').replace(/\n```$/, '');
    }
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error('Failed to parse log analysis response:', response.content);
    throw new Error('Log analysis response was not valid JSON');
  }

  return {
    issues: parsed.issues || [],
    patterns: parsed.patterns || [],
    model: response.modelUsed,
  };
}

/**
 * Parse network discovery output
 */
export async function parseNetworkDiscovery(opts: {
  nmapOutput: string;
  subnet: string;
}): Promise<{ hosts: Array<{ ip: string; hostname?: string; ports: number[]; services: string[] }>; model: string }> {
  const systemPrompt = `You are parsing nmap network discovery output.

Extract discovered hosts with:
- "ip": IP address
- "hostname": hostname if discovered (null if not)
- "ports": array of open port numbers
- "services": array of detected service names

Respond with JSON: { "hosts": [...] }`;

  const userMessage = `Subnet: ${opts.subnet}\n\nNmap output:\n${opts.nmapOutput}`;

  const response = await queryLLM({
    taskType: 'network_discovery',
    prompt: `${systemPrompt}\n\n${userMessage}`,
    maxTokens: 2000,
  });

  let parsed: { hosts: any[] };
  try {
    let cleaned = response.content.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\n/, '').replace(/\n```$/, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\n/, '').replace(/\n```$/, '');
    }
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error('Failed to parse network discovery response:', response.content);
    throw new Error('Network discovery response was not valid JSON');
  }

  return {
    hosts: parsed.hosts || [],
    model: response.modelUsed,
  };
}

/**
 * Generate remediation script
 */
export async function generateRemediationScript(opts: {
  issue: string;
  context: string;
}): Promise<{ script: string; explanation: string; model: string }> {
  const systemPrompt = `You are generating a remediation script to fix an infrastructure issue.

Provide:
- "script": Bash script to fix the issue (include error handling)
- "explanation": What the script does and why

Respond with JSON only, no markdown fences.`;

  const userMessage = `Issue: ${opts.issue}\n\nContext: ${opts.context}`;

  const response = await queryLLM({
    taskType: 'script_generation',
    prompt: `${systemPrompt}\n\n${userMessage}`,
    maxTokens: 1500,
  });

  let parsed: { script: string; explanation: string };
  try {
    let cleaned = response.content.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\n/, '').replace(/\n```$/, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\n/, '').replace(/\n```$/, '');
    }
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error('Failed to parse remediation response:', response.content);
    throw new Error('Remediation response was not valid JSON');
  }

  return {
    script: parsed.script || '',
    explanation: parsed.explanation || '',
    model: response.modelUsed,
  };
}
