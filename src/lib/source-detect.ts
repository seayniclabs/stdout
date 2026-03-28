/**
 * Source detection module — matches discovered containers/services
 * against known data source patterns to auto-detect monitoring,
 * security, and observability tools.
 */

export type DataSourceType =
  | 'influxdb'
  | 'prometheus'
  | 'trivy'
  | 'uptime-kuma'
  | 'loki'
  | 'graylog'
  | 'crowdsec'
  | 'pihole';

export interface DetectedSource {
  type: DataSourceType;
  name: string;
  url: string;
  confidence: 'high' | 'medium' | 'low';
  containerName: string;
}

interface ContainerInfo {
  name: string;
  image?: string;
  ports?: Array<{ host?: number; container?: number }>;
}

interface DetectionRule {
  type: DataSourceType;
  /** Substrings to match against the container image (lowercased) */
  imagePatterns: string[];
  /** Default port for URL generation */
  defaultPort: number;
  /** Human-readable label */
  label: string;
}

const DETECTION_RULES: DetectionRule[] = [
  {
    type: 'prometheus',
    imagePatterns: ['prom/prometheus', 'prometheus'],
    defaultPort: 9090,
    label: 'Prometheus',
  },
  {
    type: 'influxdb',
    imagePatterns: ['influxdb'],
    defaultPort: 8086,
    label: 'InfluxDB',
  },
  {
    type: 'trivy',
    imagePatterns: ['trivy', 'aquasec/trivy'],
    defaultPort: 8080,
    label: 'Trivy',
  },
  {
    type: 'uptime-kuma',
    imagePatterns: ['uptime-kuma'],
    defaultPort: 3001,
    label: 'Uptime Kuma',
  },
  {
    type: 'loki',
    imagePatterns: ['grafana/loki', 'loki'],
    defaultPort: 3100,
    label: 'Loki',
  },
  {
    type: 'graylog',
    imagePatterns: ['graylog'],
    defaultPort: 9000,
    label: 'Graylog',
  },
  {
    type: 'crowdsec',
    imagePatterns: ['crowdsec'],
    defaultPort: 8080,
    label: 'CrowdSec',
  },
  {
    type: 'pihole',
    imagePatterns: ['pihole'],
    defaultPort: 80,
    label: 'Pi-hole',
  },
];

/**
 * Detect data sources from a list of discovered containers.
 * Matches container images against known patterns and returns
 * structured detection results with guessed URLs.
 */
export function detectSources(containers: ContainerInfo[]): DetectedSource[] {
  const results: DetectedSource[] = [];
  const seen = new Set<string>(); // prevent duplicates per type

  for (const container of containers) {
    const imageLower = (container.image || '').toLowerCase();
    const nameLower = (container.name || '').toLowerCase();

    for (const rule of DETECTION_RULES) {
      if (seen.has(rule.type)) continue;

      const matched = rule.imagePatterns.some(
        (pattern) => imageLower.includes(pattern) || nameLower.includes(pattern),
      );

      if (!matched) continue;

      // Determine port: prefer mapped host port, fall back to default
      let port = rule.defaultPort;
      if (container.ports && container.ports.length > 0) {
        // Find the host port mapped to the default container port
        const mapped = container.ports.find(
          (p) => p.container === rule.defaultPort && p.host,
        );
        if (mapped?.host) {
          port = mapped.host;
        } else if (container.ports[0]?.host) {
          // Fall back to first available host port
          port = container.ports[0].host;
        }
      }

      const confidence = rule.imagePatterns.some((p) => imageLower.includes(p))
        ? 'high'
        : 'medium';

      results.push({
        type: rule.type,
        name: `${rule.label} (auto-detected)`,
        url: `http://${container.name}:${port}`,
        confidence,
        containerName: container.name,
      });

      seen.add(rule.type);
    }
  }

  return results;
}
