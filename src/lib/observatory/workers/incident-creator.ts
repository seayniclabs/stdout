/**
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
 * Incident Auto-Creator
 * Detects issues and automatically creates incidents for Riggins to diagnose
 */

export interface IncidentTrigger {
  type: "service_down" | "high_cpu" | "high_memory" | "low_disk" | "container_stopped";
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  affectedEntity?: string;
  metadata?: Record<string, any>;
}

/**
 * Create incident in database
 */
export async function createIncident(trigger: IncidentTrigger, userId: string): Promise<string | null> {
  const { getDb } = await import("../../db");
  const db = getDb();
  const rawDb = (db as any).$client;
  
  try {
    const now = Date.now();
    const id = `incident-${now}-${Math.random().toString(36).substr(2, 9)}`;
    
    const stmt = rawDb.prepare(`
      INSERT INTO incidents (
        id, title, description, severity, status, user_id, 
        created_at, updated_at, detected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      id,
      trigger.title,
      trigger.description,
      trigger.severity,
      "open",
      userId,
      now,
      now,
      now
    );
    
    console.log(`[Incident Creator] ✅ Created ${trigger.severity} incident: ${trigger.title}`);
    
    // TODO: Trigger Riggins auto-diagnosis
    // triggerRigginsDiagnosis(id);
    
    return id;
  } catch (error) {
    console.error("[Incident Creator] Failed to create incident:", error);
    return null;
  }
}

/**
 * Check system health and create incidents if needed
 */
export async function checkSystemHealth(metrics: {
  cpu: { usage: number };
  memory: { usage: number };
  disk: { usage: number };
}, userId: string): Promise<void> {
  
  // High CPU
  if (metrics.cpu.usage > 90) {
    await createIncident({
      type: "high_cpu",
      severity: "high",
      title: "High CPU Usage Detected",
      description: `System CPU usage is at ${metrics.cpu.usage.toFixed(1)}% (threshold: 90%)`,
      metadata: { cpuUsage: metrics.cpu.usage },
    }, userId);
  }
  
  // High Memory
  if (metrics.memory.usage > 90) {
    await createIncident({
      type: "high_memory",
      severity: "high",
      title: "High Memory Usage Detected",
      description: `System memory usage is at ${metrics.memory.usage.toFixed(1)}% (threshold: 90%)`,
      metadata: { memoryUsage: metrics.memory.usage },
    }, userId);
  }
  
  // Low Disk
  if (metrics.disk.usage > 90) {
    await createIncident({
      type: "low_disk",
      severity: "critical",
      title: "Low Disk Space",
      description: `Disk usage is at ${metrics.disk.usage.toFixed(1)}% (threshold: 90%)`,
      metadata: { diskUsage: metrics.disk.usage },
    }, userId);
  }
}

/**
 * Check monitor status and create incidents for failures
 */
export async function checkMonitorStatus(userId: string): Promise<void> {
  const { getDb } = await import("../../db");
  const db = getDb();
  const rawDb = (db as any).$client;
  
  try {
    // Get all failing monitors
    const failing = rawDb.prepare(`
      SELECT id, name, type, config, last_check_status, last_check_at
      FROM monitors
      WHERE enabled = 1 AND last_check_status = 'down'
    `).all();
    
    for (const monitor of failing) {
      // Check if incident already exists for this monitor
      const existing = rawDb.prepare(`
        SELECT id FROM incidents
        WHERE title LIKE ? AND status IN ('open', 'investigating')
        LIMIT 1
      `).get(`%${monitor.name}%`);
      
      if (!existing) {
        await createIncident({
          type: "service_down",
          severity: "critical",
          title: `Service Down: ${monitor.name}`,
          description: `Monitor "${monitor.name}" (${monitor.type}) is reporting DOWN status`,
          affectedEntity: monitor.id,
          metadata: {
            monitorId: monitor.id,
            monitorType: monitor.type,
            config: JSON.parse(monitor.config || "{}"),
          },
        }, userId);
      }
    }
  } catch (error) {
    console.error("[Incident Creator] Failed to check monitors:", error);
  }
}

/**
 * Check container health and create incidents for stopped containers
 */
export async function checkContainerHealth(userId: string): Promise<void> {
  
  try {
    // Get all containers and their status
    const { stdout } = await execAsync(`docker ps -a --format "{{.ID}}|{{.Names}}|{{.Status}}"`);
    
    for (const line of stdout.trim().split("\\n").filter(l => l)) {
      const [id, name, status] = line.split("|");
      
      // Check if container is stopped/unhealthy
      if (status.toLowerCase().includes("exited") || status.toLowerCase().includes("dead")) {
        // Check if incident already exists
        const { getDb } = await import("../../db");
        const db = getDb();
        const rawDb = (db as any).$client;
        
        const existing = rawDb.prepare(`
          SELECT id FROM incidents
          WHERE title LIKE ? AND status IN ('open', 'investigating')
          LIMIT 1
        `).get(`%${name}%`);
        
        if (!existing) {
          await createIncident({
            type: "container_stopped",
            severity: "high",
            title: `Container Stopped: ${name}`,
            description: `Docker container "${name}" has stopped unexpectedly (status: ${status})`,
            affectedEntity: id,
            metadata: {
              containerId: id,
              containerName: name,
              containerStatus: status,
            },
          }, userId);
        }
      }
    }
  } catch (error) {
    console.error("[Incident Creator] Failed to check containers:", error);
  }
}
