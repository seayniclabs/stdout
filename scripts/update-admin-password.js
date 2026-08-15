#!/usr/bin/env node

/**
 * Updates admin user password from environment variables
 * Called by init-setup.sh when admin user exists but password needs updating
 *
 * Required env vars:
 * - ADMIN_EMAIL: Email for admin account
 * - ADMIN_PASSWORD: New password for admin account
 */

import Database from 'better-sqlite3';
import { hash } from '@node-rs/argon2';

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

if (!email || !password) {
  console.error('[init] Error: ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required');
  process.exit(1);
}

if (password.length < 8) {
  console.error('[init] Error: ADMIN_PASSWORD must be at least 8 characters');
  process.exit(1);
}

async function hashPassword(password) {
  return hash(password);
}

async function updateAdminPassword() {
  try {
    const hashedPassword = await hashPassword(password);

    // Must match the app's DB resolution (src/lib/db/index.ts):
    // self-host uses a single combined DB at DB_PATH (default ./data/stdout.db).
    const dbPath = process.env.DB_PATH || '/data/stdout.db';
    const db = new Database(dbPath);
    console.log(`[init] update-admin-password using DB: ${dbPath}`);

    // Update password for existing admin user
    const result = db.prepare(`
      UPDATE users
      SET password_hash = ?,
          updated_at = ?
      WHERE email = ?
    `).run(
      hashedPassword,
      Date.now(),
      email
    );

    if (result.changes === 0) {
      console.error(`[init] Error: No user found with email ${email}`);
      db.close();
      process.exit(1);
    }

    console.log(`[init] ✓ Admin password updated for: ${email}`);
    db.close();
    process.exit(0);
  } catch (error) {
    console.error('[init] Error updating admin password:', error.message);
    process.exit(1);
  }
}

updateAdminPassword();
