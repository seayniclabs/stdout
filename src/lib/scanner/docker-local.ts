/**
 * Local Docker Scanner
 * Scans Docker containers on the local host via /var/run/docker.sock
 * Returns scan data in the same format as stdout-scanner
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

interface ContainerInfo {
  name: string;
  image: string;
  status: string;
  ports: Array<{ host: string; container: string }>;
  networks: string[];
  health?: string;
}

interface ScanResult {
  version: string;
  scanned_at: string;
  containers: ContainerInfo[];
  host?: {
    os: string;
    arch: string;
  };
}

/**
 * Scan local Docker containers
 * Returns scan data compatible with scanner import API
 */
export async function scanLocalDocker(): Promise<ScanResult> {
  try {
    // Get container list with formatting
    const { stdout } = await execAsync(
      `docker ps -a --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}|{{.Networks}}'`,
      { timeout: 10000 }
    );

    const containers: ContainerInfo[] = [];

    for (const line of stdout.trim().split('\n')) {
      if (!line) continue;

      const [name, image, status, portsStr, networksStr] = line.split('|');

      // Parse ports (format: "0.0.0.0:8080->80/tcp, 443/tcp")
      const ports: Array<{ host: string; container: string }> = [];
      if (portsStr) {
        for (const portMapping of portsStr.split(',')) {
          const match = portMapping.trim().match(/(?:([^:]+):)?(\d+)->(\d+)/);
          if (match) {
            const [, host, hostPort, containerPort] = match;
            ports.push({
              host: host || '0.0.0.0',
              container: containerPort,
            });
          }
        }
      }

      containers.push({
        name: name.startsWith('/') ? name.slice(1) : name,
        image,
        status: status.toLowerCase(),
        ports,
        networks: networksStr ? networksStr.split(',').map(n => n.trim()) : [],
      });
    }

    // Get host info
    let host: { os: string; arch: string } | undefined;
    try {
      const { stdout: infoOut } = await execAsync('docker info --format "{{.OSType}}|{{.Architecture}}"');
      const [os, arch] = infoOut.trim().split('|');
      host = { os, arch };
    } catch {
      // Host info is optional
    }

    return {
      version: '1.0.0',
      scanned_at: new Date().toISOString(),
      containers,
      host,
    };
  } catch (error: any) {
    console.error('[docker-local-scanner] scan failed:', error.message);
    throw new Error(`Docker scan failed: ${error.message}`);
  }
}
