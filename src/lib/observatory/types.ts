/**
 * Observatory Type Definitions
 *
 * Shared types across the learning layer
 */

// === Agent Personas ===

export interface AgentPersona {
  name: string;
  model: string;
  role: string;
  mission: string;
  check_interval_seconds?: number;
  trigger_severities?: string[];
  active_by_default: boolean;
  decision_criteria?: {
    alert_if: string[];
    ignore_if: string[];
  };
}

// === Standard Patterns ===

export interface StandardPattern {
  id: string;
  patternName: string;
  category: string;
  symptoms: string[];
  commonCauses: string[];
  resolutionSteps: string[];
  preventionSteps: string[];
  confidenceThreshold: number;
  source: 'stdlib' | string;
  createdAt: number;
  updatedAt: number;
}

// === Custom Patterns (learned) ===

export interface CustomPattern {
  id: string;
  userId: string;
  patternName: string;
  category: string;
  symptoms: string[];
  commonCauses: string[];
  resolutionSteps: string[];
  preventionSteps: string[];
  confidenceScore: number;
  occurrences: number;
  lastSeen: number;
  createdAt: number;
  updatedAt: number;
}

// === Baselines ===

export interface Baseline {
  stackId: string;
  metricName: string;
  baselineMean: number;
  baselineStddev: number;
  baselineP95: number;
  sampleCount: number;
  windowStart: number;
  windowEnd: number;
  createdAt: number;
  updatedAt: number;
}

// === Feedback ===

export interface Feedback {
  id: string;
  userId: string;
  agentRunId: string;
  suggestionType: 'alert' | 'diagnosis' | 'resolution';
  suggestionText: string;
  helpful: boolean;
  userComment?: string;
  createdAt: number;
}

// === Agent Runs ===

export interface AgentRun {
  id: string;
  userId: string;
  agentName: string;
  stackId?: string;
  trigger: string;
  inputContext: string; // JSON
  outputDecision: string; // JSON
  decisionMade: 'alert' | 'ignore' | 'investigate' | 'escalate';
  confidenceScore: number;
  executionTimeMs: number;
  createdAt: number;
}

// === Metric Interpretations ===

export interface MetricInterpretation {
  name: string;
  normal_range: [number, number];
  warning_threshold: number;
  critical_threshold: number;
  common_causes_high: string[];
  common_causes_low?: string[];
  investigation_steps: string[];
}

// === Initialization Results ===

export interface ObservatoryInitResult {
  success: boolean;
  ready: boolean;
  phases: {
    identity: { success: boolean; agentsLoaded: number };
    knowledge: { success: boolean; patternsAvailable: number; metricsAvailable: number };
    infrastructure: { success: boolean; stacksFound: number; hostsFound: number };
    monitors: { success: boolean; monitorsFound: number };
    activation: { success: boolean; agentsStarted: string[] };
  };
  startupLog: string[];
  errors: string[];
}

export interface ReadinessCheck {
  ready: boolean;
  missingComponents: string[];
  recommendations: string[];
}
