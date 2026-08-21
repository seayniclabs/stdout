/**
 * Integration Type Detection
 *
 * Detects integration types based on open ports, service banners, and HTTP headers
 * Follows Home Assistant discovery pattern
 */

export interface IntegrationType {
  type: string;
  name: string;
  ports: number[];
  requiresAuth: boolean;
  defaultConfig?: Record<string, any>;
}

export const INTEGRATION_TYPES: IntegrationType[] = [
  // Monitoring & Observability
  {
    type: 'prometheus',
    name: 'Prometheus',
    ports: [9090],
    requiresAuth: false,
  },
  {
    type: 'grafana',
    name: 'Grafana',
    ports: [3000],
    requiresAuth: true,
    defaultConfig: { username: 'admin' },
  },
  {
    type: 'alertmanager',
    name: 'Alertmanager',
    ports: [9093],
    requiresAuth: false,
  },
  {
    type: 'loki',
    name: 'Loki',
    ports: [3100],
    requiresAuth: false,
  },
  {
    type: 'netdata',
    name: 'Netdata',
    ports: [19999],
    requiresAuth: false,
  },
  {
    type: 'uptime-kuma',
    name: 'Uptime Kuma',
    ports: [3001],
    requiresAuth: true,
  },

  // Databases
  {
    type: 'mysql',
    name: 'MySQL',
    ports: [3306],
    requiresAuth: true,
    defaultConfig: { username: 'root' },
  },
  {
    type: 'postgresql',
    name: 'PostgreSQL',
    ports: [5432],
    requiresAuth: true,
    defaultConfig: { username: 'postgres' },
  },
  {
    type: 'redis',
    name: 'Redis',
    ports: [6379],
    requiresAuth: false,
  },
  {
    type: 'mongodb',
    name: 'MongoDB',
    ports: [27017],
    requiresAuth: true,
    defaultConfig: { username: 'admin' },
  },
  {
    type: 'elasticsearch',
    name: 'Elasticsearch',
    ports: [9200, 9300],
    requiresAuth: false,
  },

  // Container & Orchestration
  {
    type: 'docker',
    name: 'Docker API',
    ports: [2375, 2376],
    requiresAuth: false,
  },

  // Infrastructure
  {
    type: 'ssh',
    name: 'SSH Server',
    ports: [22],
    requiresAuth: true,
    defaultConfig: { username: 'root' },
  },
  {
    type: 'snmp',
    name: 'SNMP',
    ports: [161],
    requiresAuth: true,
    defaultConfig: { community: 'public' },
  },

  // Web Services
  {
    type: 'http',
    name: 'HTTP Server',
    ports: [80, 8080, 8081, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089, 8090],
    requiresAuth: false,
  },
  {
    type: 'https',
    name: 'HTTPS Server',
    ports: [443, 8443],
    requiresAuth: false,
  },
];

/**
 * Detect integration type based on open ports
 */
export function detectIntegrationType(openPorts: number[]): IntegrationType | null {
  // Find exact port match first
  for (const integration of INTEGRATION_TYPES) {
    const hasPort = integration.ports.some(port => openPorts.includes(port));
    if (hasPort) {
      return integration;
    }
  }

  return null;
}

/**
 * Generate unique ID for discovered device (for ignore tracking)
 */
export function generateUniqueId(ipAddress: string, macAddress?: string): string {
  if (macAddress) {
    return `${ipAddress}:${macAddress}`;
  }
  return ipAddress;
}

/**
 * Check if device should be ignored
 */
export function shouldIgnore(uniqueId: string, ignoredDevices: Set<string>): boolean {
  return ignoredDevices.has(uniqueId);
}
