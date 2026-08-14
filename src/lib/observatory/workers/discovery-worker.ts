/**
 * Autonomous Discovery Worker
 * 
 * Riggins autonomous network & infrastructure discovery engine.
 * Discovers Docker containers and saves them to discovered_hosts.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { nanoid } from "nanoid";

const execAsync = promisify(exec);

interface DiscoveredContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  ports: Array<{ internal: number; external?: number }>;
}

export class DiscoveryWorker {
  private isRunning = false;

  async startAutonomous() {
    console.log("[discovery] Starting autonomous discovery...");
    await this.runFullDiscovery();
    console.log("[discovery] Autonomous discovery active");
  }

  async runFullDiscovery() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const containers = await this.discoverDockerContainers();
      console.log(`[discovery] Found ${containers.length} containers`);
      
      // Save discoveries to database
      const saved = await this.saveDiscoveries(containers);
      console.log(`[discovery] ✅ Saved ${saved} discoveries to database`);
      
      // Log what was discovered
      for (let index = 0; index < containers.length; index++) {
      const container = containers[index];
        console.log(`[discovery]   - ${container.name} (${container.image})`);
        for (const port of container.ports) {
          if (port.external) {
            console.log(`[discovery]     Port: ${port.external} -> ${port.internal}`);
          }
        }
      }
    } catch (error) {
      console.error("[discovery] Failed:", error);
    } finally {
      this.isRunning = false;
    }
  }

  private async discoverDockerContainers(): Promise<DiscoveredContainer[]> {
    try {
      const { stdout } = await execAsync("docker ps --format \"{{.ID}}|{{.Names}}|{{.Image}}|{{.State}}|{{.Ports}}\"");
      const containers: DiscoveredContainer[] = [];

      for (const line of stdout.trim().split("\n").filter((l) => l)) {
        const [id, name, image, state, portsStr] = line.split("|");
        const ports: Array<{ internal: number; external?: number }> = [];

        // Parse ports
        const portMatches = portsStr.matchAll(/(\d+)->(\d+)/g);
        for (const match of portMatches) {
          ports.push({ external: parseInt(match[1]), internal: parseInt(match[2]) });
        }

        containers.push({ id: id.substring(0, 12), name, image, state, ports });
      }

      return containers;
    } catch {
      return [];
    }
  }

  private async saveDiscoveries(containers: DiscoveredContainer[]): Promise<number> {
    let saved = 0;
    const { getDb } = await import("../../db");
    const db = getDb();
    const rawDb = (db as any).$client;

    // Get or create default stack
    let stackId = "default-docker";
    try {
      const stack = rawDb.prepare("SELECT id FROM stacks LIMIT 1").get();
      if (stack) stackId = stack.id;
    } catch (e) {
      console.log("[discovery] No stacks found, using default");
    }

    for (let index = 0; index < containers.length; index++) {
      const container = containers[index];
      try {
        const now = Date.now();
        
        // Use correct column names: ip_address, stack_id, created_at, updated_at, last_seen
        const stmt = rawDb.prepare(`
          INSERT INTO discovered_hosts (
            id, stack_id, ip_address, hostname, device_type, created_at, updated_at, last_seen, discovered_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET 
            last_seen = excluded.last_seen,
            updated_at = excluded.updated_at
        `);

        const id = `docker-${container.id}`;
        
        stmt.run(
          id,
          stackId,
          `127.0.0.${index + 1}`,  // Unique IP per container to avoid UNIQUE constraint
          container.name,
          "docker-container",
          now,
          now,
          now,
          now
        );

        saved++;
        console.log(`[discovery]     ✓ Saved ${container.name} to database (ID: ${id})`);
      } catch (error) {
        console.error(`[discovery]     ✗ Failed to save ${container.name}:`, error.message);
      }
    }

    return saved;
  }

  /**
   * Discover network hosts using nmap
   */
  private async discoverNetworkHosts(): Promise<Array<{ip: string; hostname?: string; ports: number[]}>> {
    try {
      // Scan local network for live hosts
      const { stdout } = await execAsync("nmap -sn 192.168.68.0/24 -oG - | grep Host:");
      const hosts: Array<{ip: string; hostname?: string; ports: number[]}> = [];

      for (const line of stdout.trim().split("\n").filter((l) => l)) {
        const ipMatch = line.match(/Host: ([\d.]+)/);
        const hostnameMatch = line.match(/\((.*?)\)/);
        
        if (ipMatch) {
          hosts.push({
            ip: ipMatch[1],
            hostname: hostnameMatch ? hostnameMatch[1] : undefined,
            ports: []
          });
        }
      }

      return hosts;
    } catch (error) {
      console.error("[discovery] Network scan failed:", error);
      return [];
    }
  }

  /**
   * Save network hosts to database
   */
  private async saveNetworkHosts(hosts: Array<{ip: string; hostname?: string; ports: number[]}>): Promise<number> {
    let saved = 0;
    const { getDb } = await import("../../db");
    const db = getDb();
    const rawDb = (db as any).$client;

    // Get or create default stack
    let stackId = "default-network";
    try {
      const stack = rawDb.prepare("SELECT id FROM stacks LIMIT 1").get();
      if (stack) stackId = stack.id;
    } catch (e) {
      console.log("[discovery] No stacks found, using default");
    }

    for (const host of hosts) {
      try {
        const now = Date.now();
        const stmt = rawDb.prepare(`
          INSERT INTO discovered_hosts (
            id, stack_id, ip_address, hostname, device_type, created_at, updated_at, last_seen, discovered_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET 
            last_seen = excluded.last_seen,
            updated_at = excluded.updated_at,
            hostname = excluded.hostname
        `);

        const id = `network-${host.ip.replace(/\./g, "-")}`;
        
        stmt.run(
          id,
          stackId,
          host.ip,
          host.hostname || `host-${host.ip}`,
          "network-host",
          now,
          now,
          now,
          now
        );

        saved++;
        console.log(`[discovery]     ✓ Saved ${host.ip} ${host.hostname ? `(${host.hostname})` : ""} to database`);
      } catch (error) {
        console.error(`[discovery]     ✗ Failed to save ${host.ip}:`, error.message);
      }
    }

    return saved;
  }

}

export const discoveryWorker = new DiscoveryWorker();
