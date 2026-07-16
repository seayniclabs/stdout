/**
 * Auto-Monitor Creation
 * Observatory AI automatically creates monitors from discovered infrastructure
 */

import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

export interface DiscoveredService {
  name: string;
  type: 'web' | 'api' | 'database' | 'cache' | 'message-queue' | 'host' | 'unknown';
  target: string;
  port?: number;
  protocol?: 'http' | 'https' | 'tcp' | 'ping';
  stackId?: string;
}

export interface MonitorSuggestion {
  name: string;
  type: 'http' | 'tcp' | 'ping' | 'output-freshness';
  target: string;
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatus?: number;
  retries: number;
  stackId?: string;
  reasoning: string;
}

/**
 * Classify a service and determine monitoring strategy
 */
export function classifyService(name: string, port?: number, image?: string): DiscoveredService['type'] {
  const nameLower = name.toLowerCase();
  const imageLower = (image || '').toLowerCase();

  // Web services
  if (nameLower.includes('nginx') || nameLower.includes('apache') || nameLower.includes('traefik')) return 'web';
  if (imageLower.includes('nginx') || imageLower.includes('httpd') || imageLower.includes('caddy')) return 'web';
  if (port === 80 || port === 443 || port === 8080) return 'web';

  // APIs
  if (nameLower.includes('api') || nameLower.includes('backend') || nameLower.includes('graphql')) return 'api';
  if (imageLower.includes('node') || imageLower.includes('fastapi') || imageLower.includes('express')) return 'api';
  if (port && port >= 3000 && port <= 9000) return 'api';

  // Databases
  if (nameLower.includes('postgres') || nameLower.includes('mysql') || nameLower.includes('mongo')) return 'database';
  if (nameLower.includes('redis') || nameLower.includes('memcached')) return 'cache';
  if (imageLower.includes('postgres') || imageLower.includes('mysql') || imageLower.includes('mariadb')) return 'database';
  if (imageLower.includes('redis') || imageLower.includes('memcached') || imageLower.includes('valkey')) return 'cache';

  // Message queues
  if (nameLower.includes('rabbitmq') || nameLower.includes('kafka') || nameLower.includes('nats')) return 'message-queue';

  // Default based on port
  if (port && port < 1024) return 'host';

  return 'unknown';
}

/**
 * Generate intelligent monitor configuration based on service type
 */
export function generateMonitorConfig(service: DiscoveredService): MonitorSuggestion {
  const base = {
    name: service.name,
    target: service.target,
    stackId: service.stackId,
    retries: 3,
  };

  switch (service.type) {
    case 'web':
      return {
        ...base,
        type: 'http',
        intervalSeconds: 60,
        timeoutMs: 5000,
        expectedStatus: 200,
        reasoning: 'Web service: 60s interval for user-facing availability, 5s timeout for responsiveness'
      };

    case 'api':
      return {
        ...base,
        type: 'http',
        intervalSeconds: 30,
        timeoutMs: 3000,
        expectedStatus: 200,
        reasoning: 'API service: 30s interval for critical backend, 3s timeout for performance'
      };

    case 'database':
      return {
        ...base,
        type: 'tcp',
        intervalSeconds: 120,
        timeoutMs: 10000,
        reasoning: 'Database: 120s interval to avoid overhead, 10s timeout for connection establishment'
      };

    case 'cache':
      return {
        ...base,
        type: 'tcp',
        intervalSeconds: 60,
        timeoutMs: 2000,
        reasoning: 'Cache service: 60s interval for availability, 2s timeout for fast response'
      };

    case 'message-queue':
      return {
        ...base,
        type: 'tcp',
        intervalSeconds: 90,
        timeoutMs: 5000,
        reasoning: 'Message queue: 90s interval for async service, 5s timeout'
      };

    case 'host':
      return {
        ...base,
        type: 'ping',
        intervalSeconds: 60,
        timeoutMs: 2000,
        reasoning: 'Host: 60s ping interval for network availability, 2s timeout'
      };

    default:
      return {
        ...base,
        type: service.protocol === 'http' || service.protocol === 'https' ? 'http' : 'tcp',
        intervalSeconds: 120,
        timeoutMs: 5000,
        expectedStatus: service.protocol === 'http' || service.protocol === 'https' ? 200 : undefined,
        reasoning: 'Unknown service type: conservative 120s interval, 5s timeout'
      };
  }
}

/**
 * Infer port from service name or image for well-known services
 */
function inferPortFromService(name: string, image: string): { port: number; protocol: 'http' | 'https' } | null {
  const nameLower = name.toLowerCase();
  const imageLower = image.toLowerCase();

  // Well-known service ports
  const serviceMap: Record<string, { port: number; protocol: 'http' | 'https' }> = {
    'stdout': { port: 8112, protocol: 'http' },
    'windlass': { port: 8116, protocol: 'http' },
    'prometheus': { port: 9090, protocol: 'http' },
    'grafana': { port: 3000, protocol: 'http' },
    'loki': { port: 3100, protocol: 'http' },
    'tempo': { port: 3200, protocol: 'http' },
    'influxdb': { port: 8086, protocol: 'http' },
    'postgres': { port: 5432, protocol: 'http' }, // health check endpoint if available
    'redis': { port: 6379, protocol: 'http' },
    'mongodb': { port: 27017, protocol: 'http' },
  };

  for (const [key, value] of Object.entries(serviceMap)) {
    if (nameLower.includes(key) || imageLower.includes(key)) {
      return value;
    }
  }

  return null;
}

/**
 * Create monitors from scan results
 */
export function createMonitorsFromScan(
  db: Database,
  userId: string,
  scanData: unknown,
  stackId?: string
): MonitorSuggestion[] {
  const suggestions: MonitorSuggestion[] = [];

  // Process containers
  if (scanData.containers) {
    for (const container of scanData.containers) {
      const name = container.name || container.Names?.[0]?.replace('/', '') || 'Unknown';
      const image = container.image || container.Image || '';
      const ports = container.ports || container.Ports || [];
      const networks = container.networks || container.Networks || [];
      const isHostNetwork = networks.includes('host');

      let port: number | undefined;
      let isPublic = false;
      let protocol: 'http' | 'https' | 'tcp' | 'ping' = 'tcp';

      // Try to get port from scan data first
      if (ports.length > 0) {
        const primaryPort = ports[0];
        port = primaryPort.PublicPort || primaryPort.PrivatePort;
        isPublic = !!primaryPort.PublicPort;
      }

      // If no port found but it's a known service, infer the port
      if (!port) {
        const inferred = inferPortFromService(name, image);
        if (inferred) {
          port = inferred.port;
          protocol = inferred.protocol;
          // Host network services are accessible on localhost
          isPublic = isHostNetwork;
        }
      }

      // Skip if still no port
      if (!port) continue;

      // Classify service
      const type = classifyService(name, port, image);

      // Determine target based on network mode and port
      let target: string;

      // If protocol wasn't set by inferPortFromService, determine it
      if (protocol === 'tcp' && (port === 80 || port === 443 || (port >= 3000 && port <= 9000))) {
        protocol = port === 443 ? 'https' : 'http';
      }

      if (isPublic || isHostNetwork) {
        // Public port or host network - use localhost
        if (protocol === 'http' || protocol === 'https') {
          target = `${protocol}://localhost:${port}`;
        } else {
          target = `localhost:${port}`;
        }
      } else {
        // Internal port - use container IP if available
        const ip = container.ip || container.NetworkSettings?.IPAddress;
        if (ip) {
          if (protocol === 'http' || protocol === 'https') {
            target = `${protocol}://${ip}:${port}`;
          } else {
            target = `${ip}:${port}`;
          }
        } else {
          // No IP and not on host network - skip
          continue;
        }
      }

      const service: DiscoveredService = {
        name,
        type,
        target,
        port,
        protocol,
        stackId
      };

      suggestions.push(generateMonitorConfig(service));
    }
  }

  // Process discovered hosts
  if (scanData.discovered_hosts) {
    for (const host of scanData.discovered_hosts) {
      const ip = host.ip || host.host;
      const hostname = host.hostname || ip;

      const service: DiscoveredService = {
        name: hostname,
        type: 'host',
        target: ip,
        protocol: 'ping',
        stackId
      };

      suggestions.push(generateMonitorConfig(service));
    }
  }

  // Process network devices
  if (scanData.network_devices) {
    for (const device of scanData.network_devices) {
      const ip = device.ip;
      const name = device.hostname || device.vendor || ip;

      const service: DiscoveredService = {
        name,
        type: 'host',
        target: ip,
        protocol: 'ping',
        stackId
      };

      suggestions.push(generateMonitorConfig(service));
    }
  }

  return suggestions;
}

/**
 * Execute monitor creation (actually insert into database)
 * Updates existing monitors instead of creating duplicates
 */
export function executeMonitorCreation(
  db: Database,
  userId: string,
  suggestions: MonitorSuggestion[]
): { created: number; updated: number; errors: string[] } {
  const errors: string[] = [];
  let created = 0;
  let updated = 0;

  for (const suggestion of suggestions) {
    try {
      // Check for existing monitor with same target
      const existing = db.prepare(`
        SELECT id FROM monitors
        WHERE user_id = ? AND target = ?
        LIMIT 1
      `).get(userId, suggestion.target) as { id: string } | undefined;

      const now = new Date().toISOString();

      if (existing) {
        // Update existing monitor with AI-recommended settings
        db.prepare(`
          UPDATE monitors
          SET name = ?,
              type = ?,
              interval_seconds = ?,
              timeout_ms = ?,
              expected_status = ?,
              retries = ?,
              updated_at = ?
          WHERE id = ?
        `).run(
          suggestion.name,
          suggestion.type,
          suggestion.intervalSeconds,
          suggestion.timeoutMs,
          suggestion.expectedStatus || null,
          suggestion.retries,
          now,
          existing.id
        );

        console.log(`[auto-monitor] Updated existing: ${suggestion.name} (${suggestion.target})`);
        updated++;
      } else {
        // Create new monitor
        db.prepare(`
          INSERT INTO monitors (
            id, user_id, name, type, target, interval_seconds, timeout_ms,
            expected_status, retries, stack_id, paused, maintenance,
            current_status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'unknown', ?, ?)
        `).run(
          nanoid(),
          userId,
          suggestion.name,
          suggestion.type,
          suggestion.target,
          suggestion.intervalSeconds,
          suggestion.timeoutMs,
          suggestion.expectedStatus || null,
          suggestion.retries,
          suggestion.stackId || null,
          now,
          now
        );

        created++;
      }
    } catch (error: unknown) {
      errors.push(`${suggestion.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { created, updated, errors };
}
