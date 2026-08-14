/**
 * Autonomous Discovery Worker
 * 
 * Riggins autonomous network & infrastructure discovery engine.
 * Starts on boot, discovers everything, SAVES TO DATABASE.
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
      console.log(`[discovery] Saved ${saved} discoveries to database`);
      
      // Log what was discovered
      for (const container of containers) {
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

      for (const line of stdout.trim().split("\\n").filter((l) => l)) {
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

    for (const container of containers) {
      try {
        // Insert into discovered_hosts using raw SQL (bypass Drizzle to avoid schema issues)
        const stmt = rawDb.prepare(`
          INSERT OR REPLACE INTO discovered_hosts (
            id, ip, hostname, discovered_at, last_seen, source, metadata, user_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const id = nanoid();
        const now = Date.now();
        const metadata = JSON.stringify({
          containerName: container.name,
          image: container.image,
          state: container.state,
          ports: container.ports,
          type: "docker-container"
        });

        stmt.run(
          id,
          "127.0.0.1",  // Docker containers are local
          container.name,
          now,
          now,
          "riggins-discovery",
          metadata,
          null  // Will be set by trigger or application logic
        );

        saved++;
      } catch (error) {
        console.error(`[discovery] Failed to save ${container.name}:`, error);
      }
    }

    return saved;
  }
}

export const discoveryWorker = new DiscoveryWorker();
