/**
 * Health Collection Worker
 * Periodically collects and stores system + container metrics
 */

import { collectSystemMetrics, collectContainerMetrics, saveSystemMetrics } from "./system-health";
import { checkSystemHealth, checkMonitorStatus, checkContainerHealth } from "./incident-creator";

class HealthWorker {
  private intervalId: NodeJS.Timeout | null = null;
  private running = false;

  /**
   * Start collecting metrics every 60 seconds
   */
  async start(): Promise<void> {
    if (this.running) return;
    
    console.log("[Health Worker] Starting (60s interval)...");
    this.running = true;
    
    // Collect immediately
    await this.collect();
    
    // Then every 60 seconds
    this.intervalId = setInterval(() => {
      this.collect().catch(err => {
        console.error("[Health Worker] Collection failed:", err);
      });
    }, 60000);
  }

  /**
   * Stop collecting metrics
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
    console.log("[Health Worker] Stopped");
  }

  /**
   * Collect and save metrics
   */
  private async collect(): Promise<void> {
    try {
      // Collect system metrics
      const systemMetrics = await collectSystemMetrics();
      await saveSystemMetrics(systemMetrics);
      
      // Collect container metrics
      const containerMetrics = await collectContainerMetrics();
      
      console.log(
        `[Health Worker] ` +
        `CPU: ${systemMetrics.cpu.usage.toFixed(1)}% | ` +
        `MEM: ${systemMetrics.memory.usage.toFixed(1)}% | ` +
        `DISK: ${systemMetrics.disk.usage.toFixed(1)}% | ` +
        `Containers: ${containerMetrics.length}`
      );
      
      // TODO: Check for issues and create incidents
      // - High CPU (> 90%)
      // - High memory (> 90%)
      // - Low disk space (> 90%)
      // - Container stopped/unhealthy
      
      // Auto-create incidents for issues
      const { getDb } = await import("../../db");
      const centralDb = getDb("central");
      const rawCentral = (centralDb as any).$client;
      const firstUser = rawCentral.prepare("SELECT id FROM users LIMIT 1").get() as { id: string } | undefined;
      
      if (firstUser) {
        await checkSystemHealth(systemMetrics, firstUser.id);
        await checkMonitorStatus(firstUser.id);
        await checkContainerHealth(firstUser.id);
      }
      
    } catch (error) {
      console.error("[Health Worker] Collection error:", error);
    }
  }
}

export const healthWorker = new HealthWorker();
