/**
 * Simplified System Health - avoids complex shell escaping
 */

export interface SystemMetrics {
  timestamp: number;
  cpu: { usage: number; loadAverage: number[] };
  memory: { total: number; used: number; free: number; usage: number };
  disk: { total: number; used: number; free: number; usage: number };
  network: { bytesReceived: number; bytesSent: number };
}

export async function collectSystemMetrics(): Promise<SystemMetrics> {
  const { readFileSync } = await import("fs");
  
  // Load average from /proc/loadavg
  const loadavg = readFileSync("/proc/loadavg", "utf-8").trim().split(" ").slice(0, 3).map(parseFloat);
  
  // CPU from /proc/stat (simplified - use 0 for now, real impl needs delta calculation)
  const cpu = { usage: 0, loadAverage: loadavg };
  
  // Memory from /proc/meminfo
  let memory = { total: 0, used: 0, free: 0, usage: 0 };
  try {
    const meminfo = readFileSync("/proc/meminfo", "utf-8");
    const memTotal = parseInt(meminfo.match(/MemTotal:\\s+(\\d+)/)?.[1] || "0") * 1024;
    const memFree = parseInt(meminfo.match(/MemFree:\\s+(\\d+)/)?.[1] || "0") * 1024;
    const memUsed = memTotal - memFree;
    memory = { total: memTotal, used: memUsed, free: memFree, usage: (memUsed / memTotal) * 100 };
  } catch (e) {}
  
  // Disk usage (hardcoded root for now)
  const disk = { total: 0, used: 0, free: 0, usage: 0 };
  
  // Network stats
  let network = { bytesReceived: 0, bytesSent: 0 };
  try {
    const netdev = readFileSync("/proc/net/dev", "utf-8");
    const eth0 = netdev.split("\\n").find(l => l.includes("eth0"));
    if (eth0) {
      const parts = eth0.trim().split(/\\s+/);
      network = { bytesReceived: parseInt(parts[1]), bytesSent: parseInt(parts[9]) };
    }
  } catch (e) {}
  
  return { timestamp: Date.now(), cpu, memory, disk, network };
}

export async function collectContainerMetrics() {
  return [];  // Simplified for now
}

export async function saveSystemMetrics(metrics: SystemMetrics): Promise<void> {
  // Implementation stays the same
  const { getDb } = await import("../../db");
  const db = getDb();
  const rawDb = (db as any).$client;
  
  try {
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS system_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        cpu_usage REAL, cpu_load_1m REAL, cpu_load_5m REAL, cpu_load_15m REAL,
        memory_total INTEGER, memory_used INTEGER, memory_usage REAL,
        disk_total INTEGER, disk_used INTEGER, disk_usage REAL,
        network_rx INTEGER, network_tx INTEGER
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
      metrics.timestamp, metrics.cpu.usage, metrics.cpu.loadAverage[0], metrics.cpu.loadAverage[1], metrics.cpu.loadAverage[2],
      metrics.memory.total, metrics.memory.used, metrics.memory.usage,
      metrics.disk.total, metrics.disk.used, metrics.disk.usage,
      metrics.network.bytesReceived, metrics.network.bytesSent
    );
    
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
    rawDb.prepare("DELETE FROM system_metrics WHERE timestamp < ?").run(cutoff);
  } catch (error) {
    console.error("[System Health] Failed to save metrics:", error);
  }
}
