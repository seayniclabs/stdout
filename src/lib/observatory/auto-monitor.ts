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
 * Create monitors from scan results
 */
export function createMonitorsFromScan(
  db: Database,
  userId: string,
  scanData: any,
  stackId?: string
): MonitorSuggestion[] {
  const suggestions: MonitorSuggestion[] = [];

  // Process containers
  if (scanData.containers) {
    for (const container of scanData.containers) {
      const name = container.name || container.Names?.[0]?.replace('/', '') || 'Unknown';
      const ports = container.ports || container.Ports || [];

      // Skip if no accessible ports
      if (!ports.length) continue;

      // Get primary port
      const primaryPort = ports[0];
      const port = primaryPort.PublicPort || primaryPort.PrivatePort;
      const isPublic = !!primaryPort.PublicPort;

      if (!port) continue;

      // Classify service
      const type = classifyService(name, port, container.image || container.Image);

      // Determine target
      let target: string;
      let protocol: 'http' | 'https' | 'tcp' | 'ping' = 'tcp';

      if (isPublic) {
        // Public port - use localhost or scan host
        if (port === 80 || port === 443 || (port >= 3000 && port <= 9000)) {
          protocol = port === 443 ? 'https' : 'http';
          target = `${protocol}://localhost:${port}`;
        } else {
          target = `localhost:${port}`;
        }
      } else {
        // Internal port - use container IP if available
        const ip = container.ip || container.NetworkSettings?.IPAddress;
        if (ip) {
          if (port === 80 || port === 443 || (port >= 3000 && port <= 9000)) {
            protocol = port === 443 ? 'https' : 'http';
            target = `${protocol}://${ip}:${port}`;
          } else {
            target = `${ip}:${port}`;
          }
        } else {
          continue; // Skip if no accessible target
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
 */
export function executeMonitorCreation(
  db: Database,
  userId: string,
  suggestions: MonitorSuggestion[]
): { created: number; errors: string[] } {
  const errors: string[] = [];
  let created = 0;

  for (const suggestion of suggestions) {
    try {
      const now = new Date().toISOString();

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
    } catch (error: any) {
      errors.push(`${suggestion.name}: ${error.message}`);
    }
  }

  return { created, errors };
}
