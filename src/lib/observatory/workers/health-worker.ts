/**
 * Health Collection Worker
 * Periodically collects and stores system + container metrics
 */

import { collectSystemMetrics, collectContainerMetrics, saveSystemMetrics } from "./system-health";

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
      
      if (systemMetrics.cpu.usage > 90) {
        console.warn("[Health Worker] ⚠ HIGH CPU USAGE: ", systemMetrics.cpu.usage, "%");
      }
      
      if (systemMetrics.memory.usage > 90) {
        console.warn("[Health Worker] ⚠ HIGH MEMORY USAGE:", systemMetrics.memory.usage, "%");
      }
      
      if (systemMetrics.disk.usage > 90) {
        console.warn("[Health Worker] ⚠ LOW DISK SPACE:", systemMetrics.disk.usage, "%");
      }
      
    } catch (error) {
      console.error("[Health Worker] Collection error:", error);
    }
  }
}

export const healthWorker = new HealthWorker();
