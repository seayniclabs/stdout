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
      
      // Discover network hosts
      console.log("[discovery] Starting network scan...");
      let networkHosts = await this.discoverNetworkHosts();
      console.log(`[discovery] Found ${networkHosts.length} network hosts`);
      
      // Profile discovered hosts (rich discovery)
      console.log("[discovery] Profiling devices (MAC/ports/services)...");
      const profiles = await profileDevices(
        networkHosts.map(h => ({ ip: h.ip, hostname: h.hostname })),
        3  // Profile 3 at a time to avoid overwhelming nmap
      );
      
      // Attach profiles to hosts
      networkHosts = networkHosts.map((host, i) => ({
        ...host,
        profile: profiles[i]
      }));
      
      console.log("[discovery] Device profiling complete");
      
      // Save network discoveries
      const netSaved = await this.saveNetworkHosts(networkHosts);
      console.log(`[discovery] ✅ Saved ${netSaved} network host discoveries to database`);
      
      // Log summary
      this.logDiscoverySummary(saved, netSaved);
      
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

    for (const container of containers) {
      try {
        const now = Date.now();
        const id = `docker-${container.id}`;
        
        // Get actual container IP from Docker
        let containerIp = "127.0.0.1";  // fallback
        try {
          const { stdout: ipResult } = await execAsync(`docker inspect ${container.id} --format "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"`);
          const fetchedIp = ipResult.trim();
          if (fetchedIp && fetchedIp !== "invalid IP") {
            containerIp = fetchedIp;
          } else {
            // Use container ID as unique identifier when no network IP
            containerIp = `container-${container.id}`;
          }
        } catch (e) {
          // Use container ID as unique identifier on error
          containerIp = `container-${container.id}`;
          console.log(`[discovery]     ⚠ Could not get IP for ${container.name}, using container ID`);
        }
        
        const stmt = rawDb.prepare(`
          INSERT INTO discovered_hosts (
            id, stack_id, ip_address, hostname, device_type, created_at, updated_at, last_seen, discovered_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET 
            last_seen = excluded.last_seen,
            updated_at = excluded.updated_at,
            ip_address = excluded.ip_address
        `);

        stmt.run(
          id,
          stackId,
          containerIp,
          container.name,
          "docker-container",
          now,
          now,
          now,
          now
        );

        saved++;
        console.log(`[discovery]     ✓ Saved ${container.name} (${containerIp}) to database (ID: ${id})`);
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
      const { stdout } = await execAsync(`nmap -sn 192.168.68.0/24 -oG - | grep Host:`);
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
        
        // Save with profile data if available
        const profile = (host as any).profile as DeviceProfile | undefined;
        
        const baseStmt = rawDb.prepare(`
          INSERT INTO discovered_hosts (
            id, stack_id, ip_address, hostname, mac_address, vendor,
            device_type, device_classification, open_ports, services, os_guess,
            created_at, updated_at, last_seen, discovered_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET 
            last_seen = excluded.last_seen,
            updated_at = excluded.updated_at,
            hostname = excluded.hostname,
            mac_address = excluded.mac_address,
            vendor = excluded.vendor,
            device_classification = excluded.device_classification,
            open_ports = excluded.open_ports,
            services = excluded.services,
            os_guess = excluded.os_guess
        `);

        baseStmt.run(
          id,
          stackId,
          host.ip,
          host.hostname || profile?.hostname || `host-${host.ip}`,
          profile?.mac || null,
          profile?.vendor || null,
          "network-host",
          profile?.deviceType || null,
          profile?.openPorts ? JSON.stringify(profile.openPorts) : null,
          profile?.services ? JSON.stringify(profile.services) : null,
          profile?.osGuess || null,
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

  /**
   * Log discovery summary
   */
  private logDiscoverySummary(containerCount: number, networkCount: number): void {
    console.log("");
    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log("║          🎯 RIGGINS DISCOVERY COMPLETE                  ║");
    console.log("╠══════════════════════════════════════════════════════════╣");
    console.log(`║  Docker Containers: ${String(containerCount).padEnd(36)}║`);
    console.log(`║  Network Hosts:     ${String(networkCount).padEnd(36)}║`);
    console.log(`║  Total Discovered:  ${String(containerCount + networkCount).padEnd(36)}║`);
    console.log("╚══════════════════════════════════════════════════════════╝");
    console.log("");
  }
}

export const discoveryWorker = new DiscoveryWorker();
