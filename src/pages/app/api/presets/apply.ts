import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../../lib/db';
import { eq } from 'drizzle-orm';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * POST /app/api/presets/apply
 * Apply a configuration preset to the user's StdOut instance
 */
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const userId = locals.workspace?.ownerId || locals.user.id;
  const db = getDb();

  try {
    const { presetId } = await request.json();

    if (!presetId) {
      return new Response(JSON.stringify({ error: 'presetId required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Load preset file
    const presetPath = path.join(process.cwd(), 'src', 'data', 'presets', `${presetId}.json`);
    const presetContent = await fs.readFile(presetPath, 'utf-8');
    const preset = JSON.parse(presetContent);

    // Apply configuration
    const config = preset.configuration;

    // 1. Update user settings with preset config
    const existingSettings = db.select()
      .from(schema.userSettings)
      .where(eq(schema.userSettings.userId, userId))
      .get();

    const newSettings = {
      ...existingSettings,
      observatoryEnabled: config.observatory?.enabled ?? true,
      observatoryInterval: config.observatory?.watcherInterval ?? 300,
      autoRemediation: config.observatory?.autoRemediation ?? false,
      slackEnabled: config.notifications?.slack?.enabled ?? false,
      updatedAt: new Date()
    };

    if (existingSettings) {
      db.update(schema.userSettings)
        .set(newSettings)
        .where(eq(schema.userSettings.userId, userId))
        .run();
    } else {
      db.insert(schema.userSettings)
        .values({ ...newSettings, userId })
        .run();
    }

    // 2. Create monitor templates (if user has no monitors yet)
    const existingMonitors = db.select()
      .from(schema.monitors)
      .where(eq(schema.monitors.userId, userId))
      .all();

    if (existingMonitors.length === 0 && config.monitors?.templates) {
      for (const template of config.monitors.templates) {
        db.insert(schema.monitors).values({
          userId,
          name: template.name,
          type: template.type,
          target: '', // User fills this in
          interval: template.interval,
          timeout: template.timeout || 10,
          status: 'paused', // Start paused, user activates after configuring
          currentStatus: 'unknown',
          createdAt: new Date(),
          updatedAt: new Date()
        }).run();
      }
    }

    // 3. Store preset metadata
    db.run(`
      INSERT OR REPLACE INTO preset_applications (user_id, preset_id, applied_at, configuration)
      VALUES (?, ?, ?, ?)
    `, [userId, presetId, new Date().toISOString(), JSON.stringify(config)]);

    return new Response(JSON.stringify({
      success: true,
      message: `${preset.name} applied successfully`,
      nextSteps: preset.postSetupSteps
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Preset Apply] Error:', message);

    return new Response(JSON.stringify({
      error: 'Failed to apply preset',
      details: message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
