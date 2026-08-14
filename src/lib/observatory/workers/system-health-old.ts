/**
 * System Health Collector
 * Gathers CPU/memory/disk/network metrics for localhost and containers
 */

import { execAsync } from "../exec";

export interface SystemMetrics {
  timestamp: number;
  cpu: {
    usage: number;        // percentage
    loadAverage: number[];  // 1min, 5min, 15min
  };
  memory: {
    total: number;        // bytes
    used: number;
    free: number;
    usage: number;        // percentage
  };
  disk: {
    total: number;
    used: number;
    free: number;
    usage: number;
  };
  network: {
    bytesReceived: number;
    bytesSent: number;
  };
}

export interface ContainerMetrics {
  id: string;
  name: string;
  cpu: number;
  memory: {
    used: number;
    limit: number;
    usage: number;
  };
  network: {
    rx: number;
    tx: number;
  };
}

/**
 * Get system CPU usage
 */
async function getCpuMetrics(): Promise<{ usage: number; loadAverage: number[] }> {
  try {
    // Get load average from /proc/loadavg
    const { stdout: loadavg } = await execAsync("cat /proc/loadavg");
    const loads = loadavg.trim().split(" ").slice(0, 3).map(parseFloat);
    
    // Get CPU usage from /proc/stat
    const { stdout: cpuInfo } = await execAsync("grep 'cpu ' /proc/stat | awk '{usage=($2+$4)*100/($2+$4+$5)} END {print usage}'");
    const usage = parseFloat(cpuInfo.trim()) || 0;
    
    return { usage, loadAverage: loads };
  } catch (e) {
    return { usage: 0, loadAverage: [0, 0, 0] };
  }
}

/**
 * Get memory usage
 */
async function getMemoryMetrics(): Promise<{ total: number; used: number; free: number; usage: number }> {
  try {
    const { stdout } = await execAsync("free -b | grep Mem:");
    const parts = stdout.trim().split(/\\s+/);
    const total = parseInt(parts[1]);
    const used = parseInt(parts[2]);
    const free = parseInt(parts[3]);
    const usage = (used / total) * 100;
    
    return { total, used, free, usage };
  } catch (e) {
    return { total: 0, used: 0, free: 0, usage: 0 };
  }
}

/**
 * Get disk usage
 */
async function getDiskMetrics(): Promise<{ total: number; used: number; free: number; usage: number }> {
  try {
    const { stdout } = await execAsync("df -B1 / | tail -1");
    const parts = stdout.trim().split(/\\s+/);
    const total = parseInt(parts[1]);
    const used = parseInt(parts[2]);
    const free = parseInt(parts[3]);
    const usage = parseFloat(parts[4].replace("%", ""));
    
    return { total, used, free, usage };
  } catch (e) {
    return { total: 0, used: 0, free: 0, usage: 0 };
  }
}

/**
 * Get network usage
 */
async function getNetworkMetrics(): Promise<{ bytesReceived: number; bytesSent: number }> {
  try {
    const { stdout } = await execAsync("cat /proc/net/dev | grep eth0:");
    const parts = stdout.trim().split(/\\s+/);
    const bytesReceived = parseInt(parts[1]);
    const bytesSent = parseInt(parts[9]);
    
    return { bytesReceived, bytesSent };
  } catch (e) {
    return { bytesReceived: 0, bytesSent: 0 };
  }
}

/**
 * Collect all system metrics
 */
export async function collectSystemMetrics(): Promise<SystemMetrics> {
  const [cpu, memory, disk, network] = await Promise.all([
    getCpuMetrics(),
    getMemoryMetrics(),
    getDiskMetrics(),
    getNetworkMetrics(),
  ]);
  
  return {
    timestamp: Date.now(),
    cpu,
    memory,
    disk,
    network,
  };
}

/**
 * Get container metrics using docker stats
 */
export async function collectContainerMetrics(): Promise<ContainerMetrics[]> {
  try {
    const { stdout } = await execAsync(
      `docker stats --no-stream --format "{{.ID}}|{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}"`
    );
    
    const containers: ContainerMetrics[] = [];
    
    for (const line of stdout.trim().split("\\n").filter(l => l)) {
      const [id, name, cpuStr, memStr, netStr] = line.split("|");
      
      // Parse CPU: "1.23%"
      const cpu = parseFloat(cpuStr.replace("%", ""));
      
      // Parse memory: "100MiB / 1GiB"
      const memParts = memStr.split(" / ");
      const used = parseMemory(memParts[0]);
      const limit = parseMemory(memParts[1]);
      const usage = (used / limit) * 100;
      
      // Parse network: "1.2kB / 3.4kB"
      const netParts = netStr.split(" / ");
      const rx = parseBytes(netParts[0]);
      const tx = parseBytes(netParts[1]);
      
      containers.push({
        id: id.substring(0, 12),
        name,
        cpu,
        memory: { used, limit, usage },
        network: { rx, tx },
      });
    }
    
    return containers;
  } catch (e) {
    console.error("[System Health] Failed to collect container metrics:", e);
    return [];
  }
}

/**
 * Parse memory string to bytes
 */
function parseMemory(str: string): number {
  const num = parseFloat(str);
  if (str.includes("GiB")) return num * 1024 * 1024 * 1024;
  if (str.includes("MiB")) return num * 1024 * 1024;
  if (str.includes("KiB")) return num * 1024;
  return num;
}

/**
 * Parse bytes string
 */
function parseBytes(str: string): number {
  const num = parseFloat(str);
  if (str.includes("GB")) return num * 1000 * 1000 * 1000;
  if (str.includes("MB")) return num * 1000 * 1000;
  if (str.includes("kB") || str.includes("KB")) return num * 1000;
  if (str.includes("B")) return num;
  return num;
}

/**
 * Save metrics to database (time series)
 */
export async function saveSystemMetrics(metrics: SystemMetrics): Promise<void> {
  const { getDb } = await import("../../db");
  const db = getDb();
  const rawDb = (db as any).$client;
  
  try {
    // Create metrics table if it doesn't exist
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS system_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        cpu_usage REAL,
        cpu_load_1m REAL,
        cpu_load_5m REAL,
        cpu_load_15m REAL,
        memory_total INTEGER,
        memory_used INTEGER,
        memory_usage REAL,
        disk_total INTEGER,
        disk_used INTEGER,
        disk_usage REAL,
        network_rx INTEGER,
        network_tx INTEGER
      );
      
      CREATE INDEX IF NOT EXISTS idx_system_metrics_timestamp ON system_metrics(timestamp);
    `);
    
    const stmt = rawDb.prepare(`
      INSERT INTO system_metrics (
        timestamp, cpu_usage, cpu_load_1m, cpu_load_5m, cpu_load_15m,
        memory_total, memory_used, memory_usage,
        disk_total, disk_used, disk_usage,
        network_rx, network_tx
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      metrics.timestamp,
      metrics.cpu.usage,
      metrics.cpu.loadAverage[0],
      metrics.cpu.loadAverage[1],
      metrics.cpu.loadAverage[2],
      metrics.memory.total,
      metrics.memory.used,
      metrics.memory.usage,
      metrics.disk.total,
      metrics.disk.used,
      metrics.disk.usage,
      metrics.network.bytesReceived,
      metrics.network.bytesSent
    );
    
    // Clean up old metrics (keep last 7 days)
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
    rawDb.prepare("DELETE FROM system_metrics WHERE timestamp < ?").run(cutoff);
  } catch (error) {
    console.error("[System Health] Failed to save metrics:", error);
  }
}
