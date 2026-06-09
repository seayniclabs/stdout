/**
 * Test-only endpoint to wipe all database data
 * WARNING: Only enabled in non-production environments
 */

import type { APIRoute } from 'astro';
import { getCentralDb, centralSchema } from '../../../../lib/db';
import fs from 'node:fs';
import path from 'node:path';

export const POST: APIRoute = async ({ request }) => {
  // Only allow in non-production (saas production specifically)
  // Self-host deployments (STDOUT_MODE=selfhost) are allowed for E2E testing
  if (process.env.STDOUT_MODE === 'saas' || process.env.STDOUT_MODE === 'production') {
    return new Response(JSON.stringify({ error: 'Not available in production' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const db = getCentralDb();

    // Delete all data from all tables (in correct order to respect foreign keys)
    db.delete(centralSchema.sessions).run();
    db.delete(centralSchema.apiTokens).run();
    db.delete(centralSchema.setupProgress).run();
    db.delete(centralSchema.users).run();

    // Delete setup_config.json if it exists
    const DATA_DIR = process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : './data';
    const setupConfigPath = path.join(DATA_DIR, 'setup_config.json');
    if (fs.existsSync(setupConfigPath)) {
      fs.unlinkSync(setupConfigPath);
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'All data wiped successfully'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[wipe-data] Error:', error);
    return new Response(JSON.stringify({
      error: 'Failed to wipe data',
      details: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
