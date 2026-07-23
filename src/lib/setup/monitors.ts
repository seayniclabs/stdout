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
    const { getDb } = await import('../db');
    const { sql } = await import('drizzle-orm');
    const { nanoid } = await import('nanoid');
    const db = getDb();

    onProgress(5, 'Riggins is analyzing your environment...');

    // Get all stacks
    let stacks = await db.all(sql`
      SELECT id, name FROM stacks WHERE user_id = ${userId}
    `) as Array<{ id: string; name: string }>;

    output.push(`Found ${stacks.length} existing stacks`);

    // Create default stacks if none exist
    if (stacks.length === 0) {
      onProgress(10, 'Riggins is creating your infrastructure stacks...');
      const now = Date.now();

      const defaultStacks = [
        {
          name: 'Production Services',
          description: 'Core production infrastructure and services',
          tags: JSON.stringify(['production', 'core'])
        },
        {
          name: 'Monitoring & Observatory',
          description: 'StdOut, Windlass, and Observatory services',
          tags: JSON.stringify(['monitoring', 'observatory'])
        }
      ];

      for (const stackDef of defaultStacks) {
        const stackId = nanoid();
        await db.run(sql`
          INSERT INTO stacks (id, user_id, name, description, tags, created_at, updated_at)
          VALUES (${stackId}, ${userId}, ${stackDef.name}, ${stackDef.description}, ${stackDef.tags}, ${now}, ${now})
        `);
        output.push(`✓ Created stack: ${stackDef.name}`);
      }

      // Reload stacks
      stacks = await db.all(sql`
        SELECT id, name FROM stacks WHERE user_id = ${userId}
      `) as Array<{ id: string; name: string }>;
    }

    onProgress(30, 'Riggins is selecting key services to monitor...');

    // Create specific, meaningful monitors
    const initialMonitors = [
      {
        stackName: 'Monitoring & Observatory',
        name: 'StdOut Health',
        type: 'http',
        target: 'http://localhost:3000/',
        interval: 60,
        description: 'StdOut application health'
      },
      {
        stackName: 'Monitoring & Observatory',
        name: 'Windlass Scheduler',
        type: 'http',
        target: 'http://windlass:8116/health',
        interval: 300,
        description: 'Windlass task scheduler'
      }
    ];

    onProgress(50, 'Creating monitors...');

    const progressPerMonitor = 40 / initialMonitors.length;
    let currentProgress = 50;

    for (const monitorDef of initialMonitors) {
      try {
        // Find the stack
        const stack = stacks.find(s => s.name === monitorDef.stackName);
        if (!stack) {
          warnings.push(`Stack not found: ${monitorDef.stackName}`);
          continue;
        }

        // Check if monitor already exists
        const existing = await db.get(sql`
          SELECT id FROM monitors
          WHERE name = ${monitorDef.name}
          AND user_id = ${userId}
        `);

        if (existing) {
          output.push(`○ Monitor already exists: ${monitorDef.name}`);
          continue;
        }

        // Create monitor
        const monitorId = nanoid();
        const now = Date.now();

        await db.run(sql`
          INSERT INTO monitors (
            id,
            user_id,
            stack_id,
            name,
            type,
            target,
            interval_seconds,
            paused,
            current_status,
            consecutive_failures,
            created_at,
            updated_at
          ) VALUES (
            ${monitorId},
            ${userId},
            ${stack.id},
            ${monitorDef.name},
            ${monitorDef.type},
            ${monitorDef.target},
            ${monitorDef.interval},
            0,
            'unknown',
            0,
            ${now},
            ${now}
          )
        `);

        monitorsCreated++;
        output.push(`✓ Created monitor: ${monitorDef.name}`);

      } catch (error: unknown) {
        warnings.push(`Failed to create monitor ${monitorDef.name}: ${error instanceof Error ? error.message : String(error)}`);
      }

      currentProgress += progressPerMonitor;
      onProgress(Math.round(currentProgress), `Setting up ${monitorDef.name}...`);
    }

    onProgress(95, `Riggins has configured ${monitorsCreated} monitors`);

    // Create a welcome incident from Riggins
    try {
      const incidentId = nanoid();
      const now = Date.now();

      await db.run(sql`
        INSERT INTO incidents (
          id,
          user_id,
          stack_id,
          title,
          description,
          severity,
          status,
          created_at,
          updated_at
        ) VALUES (
          ${incidentId},
          ${userId},
          ${stacks[0]?.id || null},
          ${"Hello! I'm Riggins, your Observatory AI"},
          ${"I've just finished setting up your monitoring infrastructure. I created " + monitorsCreated + " monitors to watch your key services.\n\n**What I'm watching:**\n- StdOut Health (every 60 seconds)\n- Windlass Scheduler (every 5 minutes)\n\n**What I can do:**\n- Detect anomalies automatically (I check every 3 minutes)\n- Diagnose incidents when they occur\n- Learn from your resolutions to get smarter over time\n\n**Try me out:**\nCreate a test incident and click 'Get AI Diagnosis' to see how I analyze your infrastructure.\n\nI'm here 24/7, learning and watching. Let's keep your systems running smoothly together."},
          ${"low"},
          ${"active"},
          ${now},
          ${now}
        )
      `);

      output.push("✓ Riggins says hello!");
    } catch {
      // Non-fatal if welcome message fails
    }

    onProgress(100, `Setup complete - Riggins is ready!`);

    return {
      success: true,
      duration: Date.now() - startTime,
      output,
      warnings,
      errors
    };

  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error));
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
