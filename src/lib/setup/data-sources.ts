/**
 * Data Source Discovery
 *
 * Auto-detect monitoring tools and data sources in the environment:
 * - Prometheus
 * - InfluxDB
 * - Grafana
 * - Uptime Kuma
 * - Netdata
 * - Loki
 * - PostgreSQL
 * - MySQL
 * - Redis
 */

import { execFileSync } from 'child_process';
import type { StepResult } from './installer';

interface DiscoveredSource {
  type: string;
  name: string;
  url: string;
  port: number;
  discovered_via: string;
}

/**
 * Discover data sources via Docker labels and network scanning
 */
export async function discoverDataSources(
  onProgress: (progress: number, message: string) => void
): Promise<StepResult> {
  const startTime = Date.now();
  const output: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const discovered: DiscoveredSource[] = [];

  try {
    onProgress(10, 'Checking Docker availability...');

    // Check if Docker is available
    try {
      execFileSync('which', ['docker'], { encoding: 'utf-8' });
      output.push('✓ Docker available');
    } catch {
      warnings.push('Docker not found - skipping container discovery');
      return {
        success: true,
        duration: Date.now() - startTime,
        output,
        warnings,
        errors
      };
    }

    onProgress(30, 'Scanning running containers...');

    // Get all running containers
    const psOutput = execFileSync('docker', [
      'ps',
      '--format', '{{.Names}}\t{{.Image}}\t{{.Ports}}'
    ], { encoding: 'utf-8' });

    const containers = psOutput.trim().split('\n').filter(Boolean);
    output.push(`Found ${containers.length} running containers`);

    onProgress(50, 'Detecting data sources...');

    // Known patterns for common monitoring tools
    const patterns = [
      { image: 'prom/prometheus', type: 'prometheus', defaultPort: 9090 },
      { image: 'influxdb', type: 'influxdb', defaultPort: 8086 },
      { image: 'grafana/grafana', type: 'grafana', defaultPort: 3000 },
      { image: 'louislam/uptime-kuma', type: 'uptime-kuma', defaultPort: 3001 },
      { image: 'netdata/netdata', type: 'netdata', defaultPort: 19999 },
      { image: 'grafana/loki', type: 'loki', defaultPort: 3100 },
      { image: 'postgres', type: 'postgresql', defaultPort: 5432 },
      { image: 'mysql', type: 'mysql', defaultPort: 3306 },
      { image: 'redis', type: 'redis', defaultPort: 6379 },
      { image: 'victoriametrics/victoria-metrics', type: 'victoriametrics', defaultPort: 8428 }
    ];

    for (const line of containers) {
      const [name, image, ports] = line.split('\t');

      for (const pattern of patterns) {
        if (image.includes(pattern.image)) {
          // Extract port from Docker ports column (e.g., "0.0.0.0:9090->9090/tcp")
          const portMatch = ports.match(/0\.0\.0\.0:(\d+)->/);
          const port = portMatch ? parseInt(portMatch[1]) : pattern.defaultPort;

          discovered.push({
            type: pattern.type,
            name,
            url: `http://localhost:${port}`,
            port,
            discovered_via: 'docker_image'
          });

          output.push(`✓ Found ${pattern.type}: ${name} on port ${port}`);
        }
      }
    }

    onProgress(70, 'Checking for labeled containers...');

    // Check for containers with StdOut discovery labels
    const labeledOutput = execFileSync('docker', [
      'ps',
      '--filter', 'label=stdout.datasource.type',
      '--format', '{{.Names}}\t{{.Label "stdout.datasource.type"}}\t{{.Label "stdout.datasource.url"}}'
    ], { encoding: 'utf-8' });

    const labeled = labeledOutput.trim().split('\n').filter(Boolean);

    for (const line of labeled) {
      const [name, type, url] = line.split('\t');
      if (type && url) {
        const urlObj = new URL(url);
        const port = parseInt(urlObj.port) || 80;

        discovered.push({
          type,
          name,
          url,
          port,
          discovered_via: 'docker_label'
        });

        output.push(`✓ Found labeled ${type}: ${name} at ${url}`);
      }
    }

    onProgress(90, 'Saving discovered sources...');

    // Save to database
    const { getDb } = await import('../db');
    const { sql } = await import('drizzle-orm');
    const db = getDb();

    for (const source of discovered) {
      try {
        const sourceId = `ds_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        await db.run(sql`
          INSERT INTO data_sources (
            id, type, name, url, port, discovered_via, enabled, created_at
          ) VALUES (
            ${sourceId},
            ${source.type},
            ${source.name},
            ${source.url},
            ${source.port},
            ${source.discovered_via},
            1,
            ${Date.now()}
          )
          ON CONFLICT (url) DO UPDATE SET
            type = ${source.type},
            name = ${source.name},
            port = ${source.port},
            discovered_via = ${source.discovered_via},
            updated_at = ${Date.now()}
        `);
      } catch (err: any) {
        warnings.push(`Failed to save ${source.name}: ${err.message}`);
      }
    }

    onProgress(100, `Discovery complete - found ${discovered.length} sources`);

    if (discovered.length === 0) {
      warnings.push('No data sources found - you can add them manually later');
    }

    return {
      success: true,
      duration: Date.now() - startTime,
      output,
      warnings,
      errors
    };

  } catch (error: any) {
    errors.push(error.message);
    return {
      success: false,
      duration: Date.now() - startTime,
      output,
      warnings,
      errors
    };
  }
}

/**
 * Verify a data source is accessible
 */
export async function verifyDataSource(url: string, timeout: number = 5000): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeout),
      method: 'HEAD'
    });
    return response.ok;
  } catch {
    return false;
  }
}
