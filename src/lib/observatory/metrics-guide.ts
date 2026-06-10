/**
 * Metric Interpretation Guide
 *
 * Standard definitions for how to interpret common infrastructure metrics.
 * Ships with every StdOut instance to provide baseline understanding.
 */

export interface MetricInterpretation {
  name: string;
  unit: string;
  normal_range: [number, number];
  warning_threshold: number;
  critical_threshold: number;
  interpretation: {
    low: string;
    medium: string;
    high: string;
    critical: string;
  };
  common_causes_high: string[];
  common_causes_low?: string[];
}

/**
 * Standard metric interpretations for common infrastructure monitoring
 */
export const METRIC_INTERPRETATIONS: Record<string, MetricInterpretation> = {
  cpu_percent: {
    name: 'CPU Usage',
    unit: '%',
    normal_range: [0, 70],
    warning_threshold: 80,
    critical_threshold: 95,
    interpretation: {
      low: 'CPU idle - normal operation',
      medium: 'CPU busy but within capacity',
      high: 'CPU saturated - investigate workload',
      critical: 'CPU exhausted - immediate action required'
    },
    common_causes_high: [
      'Runaway process or infinite loop',
      'Insufficient CPU resources allocated',
      'DDoS attack or traffic spike',
      'Background job processing without rate limiting',
      'Crypto mining malware'
    ]
  },

  memory_percent: {
    name: 'Memory Usage',
    unit: '%',
    normal_range: [0, 75],
    warning_threshold: 85,
    critical_threshold: 95,
    interpretation: {
      low: 'Memory available',
      medium: 'Normal memory usage',
      high: 'Memory pressure - monitor closely',
      critical: 'OOM imminent - restart or scale'
    },
    common_causes_high: [
      'Memory leak (unclosed connections, circular refs)',
      'Cache growing unbounded',
      'Too many concurrent connections',
      'Large dataset loaded into memory',
      'Insufficient memory allocation'
    ]
  },

  disk_percent: {
    name: 'Disk Usage',
    unit: '%',
    normal_range: [0, 80],
    warning_threshold: 90,
    critical_threshold: 95,
    interpretation: {
      low: 'Disk space available',
      medium: 'Disk usage normal',
      high: 'Disk filling up - clean soon',
      critical: 'Disk almost full - urgent cleanup'
    },
    common_causes_high: [
      'Log files not rotated',
      'Temporary files accumulating',
      'Database not vacuumed or optimized',
      'Docker images and volumes piling up',
      'Backup files not cleaned'
    ]
  },

  response_time_ms: {
    name: 'Response Time',
    unit: 'ms',
    normal_range: [0, 500],
    warning_threshold: 1000,
    critical_threshold: 5000,
    interpretation: {
      low: 'Fast response - healthy',
      medium: 'Acceptable response time',
      high: 'Slow response - degraded performance',
      critical: 'Very slow or timing out'
    },
    common_causes_high: [
      'Database query slow or not indexed',
      'External API call slow or timing out',
      'High concurrent load overwhelming server',
      'Network latency or packet loss',
      'Resource exhaustion (CPU/memory)'
    ]
  },

  error_rate_percent: {
    name: 'Error Rate',
    unit: '%',
    normal_range: [0, 1],
    warning_threshold: 5,
    critical_threshold: 10,
    interpretation: {
      low: 'Negligible errors - healthy',
      medium: 'Some errors but acceptable',
      high: 'High error rate - investigate',
      critical: 'Majority of requests failing'
    },
    common_causes_high: [
      'Service dependency down or unreachable',
      'Bad deployment with bugs',
      'Configuration error after change',
      'Database connection pool exhausted',
      'Rate limiting or quota exceeded'
    ],
    common_causes_low: [
      'Service healthy',
      'Proper error handling in place',
      'Dependencies available'
    ]
  },

  network_bandwidth_mbps: {
    name: 'Network Bandwidth',
    unit: 'Mbps',
    normal_range: [0, 80], // % of available
    warning_threshold: 90,
    critical_threshold: 98,
    interpretation: {
      low: 'Network idle',
      medium: 'Normal network usage',
      high: 'High network utilization',
      critical: 'Network saturated'
    },
    common_causes_high: [
      'Large file transfer or backup',
      'DDoS attack',
      'Media streaming or download',
      'Database replication lag',
      'Misconfigured service flooding network'
    ]
  },

  connection_count: {
    name: 'Active Connections',
    unit: 'count',
    normal_range: [0, 100],
    warning_threshold: 200,
    critical_threshold: 500,
    interpretation: {
      low: 'Few active connections',
      medium: 'Normal connection count',
      high: 'Many connections - approaching limits',
      critical: 'Connection pool exhausted'
    },
    common_causes_high: [
      'Connection leak (not properly closed)',
      'Traffic spike or DDoS',
      'Connection pool too small',
      'Slow queries holding connections',
      'Keep-alive timeout too long'
    ]
  },

  queue_depth: {
    name: 'Queue Depth',
    unit: 'items',
    normal_range: [0, 100],
    warning_threshold: 500,
    critical_threshold: 1000,
    interpretation: {
      low: 'Queue empty or processing well',
      medium: 'Normal queue backlog',
      high: 'Queue backing up - slow processing',
      critical: 'Queue overwhelmed - data loss risk'
    },
    common_causes_high: [
      'Worker capacity insufficient',
      'Downstream service slow or down',
      'Message processing has bug/hang',
      'Sudden traffic spike',
      'Queue not being consumed'
    ]
  }
};

/**
 * Get interpretation for a metric value
 */
export function interpretMetric(
  metricName: string,
  currentValue: number
): {
  level: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  causes: string[];
} {
  const guide = METRIC_INTERPRETATIONS[metricName];

  if (!guide) {
    return {
      level: 'medium',
      message: 'Unknown metric',
      causes: []
    };
  }

  let level: 'low' | 'medium' | 'high' | 'critical';

  if (currentValue >= guide.critical_threshold) {
    level = 'critical';
  } else if (currentValue >= guide.warning_threshold) {
    level = 'high';
  } else if (currentValue >= guide.normal_range[1]) {
    level = 'high';
  } else if (currentValue >= guide.normal_range[0]) {
    level = 'medium';
  } else {
    level = 'low';
  }

  return {
    level,
    message: guide.interpretation[level],
    causes: level === 'high' || level === 'critical' ? guide.common_causes_high : []
  };
}

/**
 * Calculate severity level from metric value and baseline
 */
export function calculateSeverity(
  metricName: string,
  currentValue: number,
  baseline?: { mean: number; stdDev: number }
): 'low' | 'medium' | 'high' | 'critical' {
  const guide = METRIC_INTERPRETATIONS[metricName];

  if (!guide) {
    return 'low';
  }

  // Use absolute thresholds first
  if (currentValue >= guide.critical_threshold) {
    return 'critical';
  }

  if (currentValue >= guide.warning_threshold) {
    return 'high';
  }

  // If we have baseline data, use statistical deviation
  if (baseline) {
    const deviation = Math.abs(currentValue - baseline.mean) / baseline.stdDev;

    if (deviation > 3) {
      return 'critical'; // >3σ extremely abnormal
    } else if (deviation > 2) {
      return 'high'; // >2σ significantly abnormal
    } else if (deviation > 1.5) {
      return 'medium'; // >1.5σ somewhat abnormal
    }
  }

  // Default to medium if within normal range
  if (currentValue >= guide.normal_range[0] && currentValue <= guide.normal_range[1]) {
    return 'medium';
  }

  return 'low';
}
