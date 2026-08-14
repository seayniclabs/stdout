/**
 * Auto-Monitor Creator
 * Automatically creates monitors for discovered devices based on their services
 */

export interface MonitorConfig {
  hostId: string;
  type: "http" | "https" | "ping" | "docker" | "tcp" | "database";
  name: string;
  config: Record<string, any>;
  interval: number;  // seconds
  enabled: boolean;
}

/**
 * Create monitors for a discovered device based on its profile
 */
export function createMonitorsForDevice(device: {
  id: string;
  ip: string;
  hostname?: string;
  deviceType?: string;
  openPorts?: number[];
  services?: Array<{ port: number; service: string }>;
}): MonitorConfig[] {
  const monitors: MonitorConfig[] = [];
  const name = device.hostname || device.ip;
  
  // Always create ping monitor for network hosts
  if (!device.id.startsWith("docker-")) {
    monitors.push({
      hostId: device.id,
      type: "ping",
      name: `${name} - Ping`,
      config: { host: device.ip },
      interval: 60,
      enabled: true,
    });
  }
  
  // Docker container health check
  if (device.id.startsWith("docker-")) {
    monitors.push({
      hostId: device.id,
      type: "docker",
      name: `${name} - Container Health`,
      config: { containerId: device.id.replace("docker-", "") },
      interval: 30,
      enabled: true,
    });
  }
  
  // HTTP/HTTPS monitors based on open ports
  const httpPorts = [80, 8080, 3000, 8000, 5000];
  const httpsPorts = [443, 8443, 3443];
  
  for (const port of device.openPorts || []) {
    if (httpPorts.includes(port)) {
      monitors.push({
        hostId: device.id,
        type: "http",
        name: `${name} - HTTP :${port}`,
        config: { url: `http://${device.ip}:${port}` },
        interval: 60,
        enabled: true,
      });
    } else if (httpsPorts.includes(port)) {
      monitors.push({
        hostId: device.id,
        type: "https",
        name: `${name} - HTTPS :${port}`,
        config: { url: `https://${device.ip}:${port}`, allowSelfSigned: true },
        interval: 60,
        enabled: true,
      });
    }
  }
  
  // Service-specific monitors
  for (const svc of device.services || []) {
    const service = svc.service.toLowerCase();
    
    // Database monitors
    if (service.includes("mysql") || service.includes("mariadb")) {
      monitors.push({
        hostId: device.id,
        type: "database",
        name: `${name} - MySQL`,
        config: { 
          type: "mysql",
          host: device.ip,
          port: svc.port,
          // Manual config required for credentials
        },
        interval: 300,
        enabled: false,  // Requires manual config
      });
    }
    
    if (service.includes("postgres")) {
      monitors.push({
        hostId: device.id,
        type: "database",
        name: `${name} - PostgreSQL`,
        config: { 
          type: "postgresql",
          host: device.ip,
          port: svc.port,
        },
        interval: 300,
        enabled: false,
      });
    }
    
    // TCP port check for other services
    if (!httpPorts.includes(svc.port) && !httpsPorts.includes(svc.port)) {
      monitors.push({
        hostId: device.id,
        type: "tcp",
        name: `${name} - ${service} :${svc.port}`,
        config: { host: device.ip, port: svc.port },
        interval: 120,
        enabled: true,
      });
    }
  }
  
  return monitors;
}

/**
 * Save monitors to database
 */
export async function saveMonitors(monitors: MonitorConfig[], userId: string): Promise<number> {
  const { getDb } = await import("../../db");
  const db = getDb();
  const rawDb = (db as any).$client;
  
  let saved = 0;
  
  for (const monitor of monitors) {
    try {
      const now = Date.now();
      const id = `monitor-${monitor.hostId}-${monitor.type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const stmt = rawDb.prepare(`
        INSERT INTO monitors (
          id, name, type, config, interval_seconds, user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run(
        id,
        monitor.name,
        monitor.type,
        JSON.stringify(monitor.config),
        monitor.interval,
        monitor.enabled ? 1 : 0,
        userId,
        now,
        now
      );
      
      saved++;
      console.log(`[Monitor Creator]   ✓ Created ${monitor.type} monitor for ${monitor.name}`);
    } catch (error) {
      console.error(`[Monitor Creator]   ✗ Failed to create monitor for ${monitor.name}:`, error.message);
    }
  }
  
  return saved;
}
