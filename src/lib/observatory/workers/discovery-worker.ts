/**
 * Autonomous Discovery Worker
 * 
 * Riggins' autonomous network & infrastructure discovery engine.
 * Starts on boot, discovers everything, creates monitors automatically.
 */

import { getDb, schema } from '../../db';
import { eq } from 'drizzle-orm';
import { exec } from 'child_process';
import { promisify } from 'util';
import { nanoid } from 'nanoid';

const execAsync = promisify(exec);

interface DiscoveredContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  ports: Array<{ internal: number; external?: number }>;
}

export class DiscoveryWorker {
  private db = getDb();
  private isRunning = false;

  async startAutonomous() {
    console.log('[discovery] Starting autonomous discovery...');
    await this.runFullDiscovery();
    console.log('[discovery] Autonomous discovery active');
  }

  async runFullDiscovery() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const containers = await this.discoverDockerContainers();
      console.log(`[discovery] Found ${containers.length} containers`);
      
      const created = await this.createAutoMonitors(containers);
      console.log(`[discovery] Auto-created ${created} monitors`);
    } catch (error) {
      console.error('[discovery] Failed:', error);
    } finally {
      this.isRunning = false;
    }
  }

  private async discoverDockerContainers(): Promise<DiscoveredContainer[]> {
    try {
      const { stdout } = await execAsync('docker ps --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.State}}|{{.Ports}}"');
      const containers: DiscoveredContainer[] = [];

      for (const line of stdout.trim().split('\n').filter(l => l)) {
        const [id, name, image, state, portsStr] = line.split('|');
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

  private async createAutoMonitors(containers: DiscoveredContainer[]): Promise<number> {
    let created = 0;

    for (const container of containers) {
      for (const port of container.ports) {
        if (port.external) {
          const url = `http://localhost:${port.external}`;
          const existing = this.db.select().from(schema.monitors).where(eq(schema.monitors.url, url)).get();

          if (!existing) {
            this.db.insert(schema.monitors).values({
              id: nanoid(),
              name: `${container.name}:${port.external}`,
              url,
              method: 'GET',
              interval: 60,
              timeout: 10,
              enabled: true,
              status: 'pending',
              metadata: JSON.stringify({ container: container.name, autoCreated: true }),
              createdAt: new Date(),
              updatedAt: new Date(),
            }).run();
            created++;
          }
        }
      }
    }

    return created;
  }
}

export const discoveryWorker = new DiscoveryWorker();
