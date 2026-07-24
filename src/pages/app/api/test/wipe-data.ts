/**
 * Test-only endpoint to wipe all database data
 * WARNING: Only enabled in non-production environments
 */

import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../../lib/db';
import { sql } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { requireAuth } from '../../../../lib/rbac';

export const POST: APIRoute = async ({ request, locals }) => {
  // SECURITY: Require authentication
  const authError = requireAuth(locals);
  if (authError) return authError;

  // SECURITY: Require admin role
  if (locals.user?.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Admin role required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Only allow in non-production (saas production specifically)
  // Self-host deployments (STDOUT_MODE=selfhost) are allowed for E2E testing
  if (process.env.STDOUT_MODE === 'saas' || process.env.STDOUT_MODE === 'production') {
    return new Response(JSON.stringify({ error: 'Not available in production' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const db = getDb();

    // Delete all data from all tables (in correct order to respect foreign keys)
    db.delete(schema.sessions).run();
    db.delete(schema.apiTokens).run();
    db.delete(schema.setupProgress).run();
    db.delete(schema.users).run();

    // Delete tenant/user data tables
    db.delete(schema.discoveredServices).run();
    db.delete(schema.discoveredHosts).run();

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
      details: error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
