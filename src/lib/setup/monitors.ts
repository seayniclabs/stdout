/**
 * Monitor Auto-Configuration
 *
 * Creates monitors for discovered data sources and stacks
 */

import type { StepResult } from './installer';

interface MonitorTemplate {
  type: string;
  name: string;
  checkInterval: number;
  thresholds: {
    warning: number;
    critical: number;
  };
  query?: string;
}

/**
 * Auto-configure monitors for discovered stacks and data sources
 */
export async function configureMonitors(
  userId: string,
  onProgress: (progress: number, message: string) => void
): Promise<StepResult> {
  const startTime = Date.now();
  const output: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  let monitorsCreated = 0;

  try {
    const { getTenantDb } = await import('../db');
    const { sql } = await import('drizzle-orm');
    const db = getTenantDb(userId);

    onProgress(10, 'Checking for existing stacks...');

    // Get all stacks
    const stacks = await db.all(sql`
      SELECT id, name, type FROM stacks WHERE user_id = ${userId}
    `) as Array<{ id: string; name: string; type: string }>;

    output.push(`Found ${stacks.length} stacks`);

    if (stacks.length === 0) {
      warnings.push('No stacks found - run scanner first to discover infrastructure');
      onProgress(100, 'No stacks to monitor');
      return {
        success: true,
        duration: Date.now() - startTime,
        output,
        warnings,
        errors
      };
    }

    onProgress(30, 'Generating monitor templates...');

    // Default monitor templates for each stack
    const templates: MonitorTemplate[] = [
      {
        type: 'health',
        name: 'Container Health',
        checkInterval: 300, // 5 minutes
        thresholds: { warning: 1, critical: 1 }
      },
      {
        type: 'cpu',
        name: 'CPU Usage',
        checkInterval: 300,
        thresholds: { warning: 70, critical: 90 }
      },
      {
        type: 'memory',
        name: 'Memory Usage',
        checkInterval: 300,
        thresholds: { warning: 80, critical: 95 }
      },
      {
        type: 'restart',
        name: 'Restart Count',
        checkInterval: 600, // 10 minutes
        thresholds: { warning: 3, critical: 5 }
      }
    ];

    onProgress(50, 'Creating monitors for each stack...');

    const progressPerStack = 40 / stacks.length;
    let currentProgress = 50;

    for (const stack of stacks) {
      for (const template of templates) {
        try {
          // Check if monitor already exists
          const existing = await db.get(sql`
            SELECT id FROM monitors
            WHERE stack_id = ${stack.id}
            AND type = ${template.type}
            AND user_id = ${userId}
          `);

          if (existing) {
            output.push(`○ Monitor already exists: ${stack.name} - ${template.name}`);
            continue;
          }

          // Create monitor
          const monitorId = `mon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

          await db.run(sql`
            INSERT INTO monitors (
              id,
              user_id,
              stack_id,
              name,
              type,
              enabled,
              check_interval_seconds,
              warning_threshold,
              critical_threshold,
              created_at
            ) VALUES (
              ${monitorId},
              ${userId},
              ${stack.id},
              ${`${stack.name} - ${template.name}`},
              ${template.type},
              1,
              ${template.checkInterval},
              ${template.thresholds.warning},
              ${template.thresholds.critical},
              ${Date.now()}
            )
          `);

          monitorsCreated++;
          output.push(`✓ Created: ${stack.name} - ${template.name}`);

        } catch (err: any) {
          warnings.push(`Failed to create monitor for ${stack.name} - ${template.name}: ${err.message}`);
        }
      }

      currentProgress += progressPerStack;
      onProgress(Math.round(currentProgress), `Configured monitors for ${stack.name}`);
    }

    onProgress(100, `Monitor configuration complete - created ${monitorsCreated} monitors`);

    return {
      success: true,
      duration: Date.now() - startTime,
      output,
      warnings,
      errors
    };

  } catch (error: any) {
    errors.push(error.message);
    return {
      success: false,
      duration: Date.now() - startTime,
      output,
      warnings,
      errors
    };
  }
}

/**
 * Get recommended monitors for a stack type
 */
export function getRecommendedMonitors(stackType: string): MonitorTemplate[] {
  const base: MonitorTemplate[] = [
    {
      type: 'health',
      name: 'Container Health',
      checkInterval: 300,
      thresholds: { warning: 1, critical: 1 }
    },
    {
      type: 'cpu',
      name: 'CPU Usage',
      checkInterval: 300,
      thresholds: { warning: 70, critical: 90 }
    },
    {
      type: 'memory',
      name: 'Memory Usage',
      checkInterval: 300,
      thresholds: { warning: 80, critical: 95 }
    }
  ];

  // Type-specific monitors
  const typeSpecific: Record<string, MonitorTemplate[]> = {
    database: [
      {
        type: 'connections',
        name: 'Active Connections',
        checkInterval: 300,
        thresholds: { warning: 80, critical: 95 }
      },
      {
        type: 'storage',
        name: 'Storage Usage',
        checkInterval: 600,
        thresholds: { warning: 80, critical: 90 }
      }
    ],
    web: [
      {
        type: 'response_time',
        name: 'Response Time',
        checkInterval: 180,
        thresholds: { warning: 1000, critical: 3000 }
      },
      {
        type: 'error_rate',
        name: 'Error Rate',
        checkInterval: 300,
        thresholds: { warning: 5, critical: 10 }
      }
    ],
    cache: [
      {
        type: 'hit_rate',
        name: 'Cache Hit Rate',
        checkInterval: 300,
        thresholds: { warning: 70, critical: 50 }
      },
      {
        type: 'evictions',
        name: 'Eviction Rate',
        checkInterval: 300,
        thresholds: { warning: 100, critical: 500 }
      }
    ]
  };

  return [...base, ...(typeSpecific[stackType] || [])];
}
