/**
 * Observatory Degradation Mode
 *
 * Fallback behavior when Ollama is unavailable.
 * Provides heuristic-based anomaly detection without LLM analysis.
 */

import { isOllamaAvailable } from './ollama';

export interface DegradationModeStatus {
  enabled: boolean;
  reason?: string;
  capabilities: {
    anomalyDetection: boolean;
    agentAnalysis: boolean;
    knowledgeBase: boolean;
  };
}

// Global state tracking
let degradationModeEnabled = false;
let degradationReason: string | null = null;
let ollamaCheckComplete = false;

/**
 * Initialize degradation mode on startup
 *
 * Checks if Ollama is available and enables degradation if not.
 * Run this once on application startup.
 */
export async function initializeDegradationMode(): Promise<DegradationModeStatus> {
  if (ollamaCheckComplete) {
    return getStatus();
  }

  try {
    const available = await isOllamaAvailable();

    if (!available) {
      degradationModeEnabled = true;
      degradationReason =
        'Ollama not available - Observatory will operate in text-only heuristic mode';
      console.warn(
        '[Observatory] Degradation mode enabled:',
        degradationReason
      );
    } else {
      degradationModeEnabled = false;
      degradationReason = null;
      console.log('[Observatory] Ollama available - full Observatory features enabled');
    }
  } catch (error) {
    degradationModeEnabled = true;
    degradationReason = `Failed to check Ollama availability: ${error instanceof Error ? error.message : 'Unknown error'}`;
    console.error('[Observatory]', degradationReason);
  } finally {
    ollamaCheckComplete = true;
  }

  return getStatus();
}

/**
 * Get current degradation mode status
 */
export function getStatus(): DegradationModeStatus {
  return {
    enabled: degradationModeEnabled,
    reason: degradationReason || undefined,
    capabilities: {
      anomalyDetection: true, // Always available (heuristic-based)
      agentAnalysis: !degradationModeEnabled, // Requires Ollama
      knowledgeBase: true, // Always available
    },
  };
}

/**
 * Check if a specific capability is available
 */
export function isCapabilityAvailable(
  capability: 'anomalyDetection' | 'agentAnalysis' | 'knowledgeBase'
): boolean {
  const status = getStatus();
  return status.capabilities[capability];
}

/**
 * Heuristic-based anomaly detection (used when Ollama unavailable)
 *
 * Simple statistical checks without LLM analysis.
 */
export interface HeuristicAnomalyResult {
  detected: boolean;
  confidence: number; // 0-1
  metricName?: string;
  deviationSigma?: number;
  reasoning: string;
}

/**
 * Detect anomalies using simple statistical heuristics
 *
 * Looks for values deviating >2 sigma from baseline (95% confidence).
 * Returns null if no clear anomaly detected.
 */
export function detectAnomalyHeuristic(
  currentValue: number,
  baseline: { mean: number; stdDev: number },
  metricName: string
): HeuristicAnomalyResult {
  if (baseline.stdDev === 0) {
    // No variance - can't detect anomaly
    return {
      detected: false,
      confidence: 0,
      reasoning: 'No baseline variance - insufficient data',
    };
  }

  const deviationSigma = Math.abs(currentValue - baseline.mean) / baseline.stdDev;

  // 2-sigma threshold = ~95% confidence
  const threshold = 2.0;
  const detected = deviationSigma > threshold;

  const confidence = Math.min(
    (deviationSigma - 1) / 4, // Scale from 1-sigma (0%) to 5-sigma (100%)
    1.0
  );

  if (detected) {
    const direction = currentValue > baseline.mean ? 'increased' : 'decreased';
    return {
      detected: true,
      confidence,
      metricName,
      deviationSigma,
      reasoning: `${metricName} ${direction} by ${deviationSigma.toFixed(2)} standard deviations`,
    };
  }

  return {
    detected: false,
    confidence: 0,
    metricName,
    deviationSigma,
    reasoning: `${metricName} within expected range (${deviationSigma.toFixed(2)} sigma)`,
  };
}

/**
 * Multi-metric heuristic check
 *
 * Aggregates anomalies across multiple metrics to determine overall severity.
 */
export function aggregateAnomalies(
  results: HeuristicAnomalyResult[]
): {
  hasAnomalies: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  anomalyCount: number;
  overallConfidence: number;
} {
  const detected = results.filter((r) => r.detected);
  const count = detected.length;
  const avgConfidence =
    detected.length > 0
      ? detected.reduce((sum, r) => sum + r.confidence, 0) / detected.length
      : 0;

  // Severity based on count and confidence
  let severity: 'low' | 'medium' | 'high' | 'critical' = 'low';
  if (count >= 3 && avgConfidence > 0.8) {
    severity = 'critical';
  } else if (count >= 2 && avgConfidence > 0.6) {
    severity = 'high';
  } else if (count >= 1 && avgConfidence > 0.4) {
    severity = 'medium';
  }

  return {
    hasAnomalies: count > 0,
    severity,
    anomalyCount: count,
    overallConfidence: avgConfidence,
  };
}

/**
 * Force degradation mode (for testing)
 */
export function enableDegradationMode(reason: string): void {
  degradationModeEnabled = true;
  degradationReason = reason;
  console.warn('[Observatory] Degradation mode forced:', reason);
}

/**
 * Disable degradation mode (for testing)
 */
export function disableDegradationMode(): void {
  degradationModeEnabled = false;
  degradationReason = null;
  console.log('[Observatory] Degradation mode disabled');
}
