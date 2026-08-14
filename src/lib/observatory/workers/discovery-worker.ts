/**
 * Autonomous Discovery Worker
 * 
 * Riggins' autonomous network & infrastructure discovery engine.
 * Starts on boot, discovers everything, logs findings.
 */

import { exec } from "child_process";
import { promisify } from "util";

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
      
      // Log what was discovered (don't try to create monitors yet due to schema issues)
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
      const { stdout } = await execAsync('docker ps --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.State}}|{{.Ports}}"');
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
}

export const discoveryWorker = new DiscoveryWorker();
