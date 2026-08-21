import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../../lib/db';
import { eq } from 'drizzle-orm';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireAuth, checkRBAC } from '../../../../lib/rbac';

/**
 * POST /app/api/presets/apply
 * Apply a configuration preset to the user's StdOut instance
 */
export const POST: APIRoute = async ({ locals, request, cookies }) => {
  // Auth check
  const authError = requireAuth(locals);
  if (authError) return authError;

  // RBAC check - applying presets modifies system configuration
  const rbacError = checkRBAC(locals, 'manage_settings');
  if (rbacError) return rbacError;

  const db = getDb();

  try {
    const body = await request.json();
    const { presetId } = body;

    // CSRF check
    const { validateCsrf } = await import('../../../../middleware');
    const csrfToken = request.headers.get('x-csrf-token') || body._csrf;
    if (!validateCsrf(csrfToken, cookies)) {
      return new Response(JSON.stringify({ error: 'CSRF token validation failed' }), { status: 403 });
    }

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

    // 1. Update system settings with preset config
    const existingSettings = db.select()
      .from(schema.systemSettings)
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
      db.update(schema.systemSettings)
        .set(newSettings)
        .run();
    } else {
      db.insert(schema.systemSettings)
        .values({ id: 'instance', ...newSettings })
        .run();
    }

    // 2. Create monitor templates (if no monitors exist yet)
    const existingMonitors = db.select()
      .from(schema.monitors)
      .all();

    if (existingMonitors.length === 0 && config.monitors?.templates) {
      const { nanoid } = await import('nanoid');
      for (const template of config.monitors.templates) {
        db.insert(schema.monitors).values({
          id: nanoid(),
          name: template.name,
          type: template.type,
          target: '', // User fills this in
          intervalSeconds: template.interval || 60,
          timeoutMs: (template.timeout || 10) * 1000,
          paused: true, // Start paused, user activates after configuring
          currentStatus: 'unknown',
          createdAt: new Date(),
          updatedAt: new Date()
        }).run();
      }
    }

    // 3. Store preset metadata
    db.run(`
      INSERT OR REPLACE INTO preset_applications (preset_id, applied_at, configuration)
      VALUES (?, ?, ?)
    `, [presetId, new Date().toISOString(), JSON.stringify(config)]);

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
