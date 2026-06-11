#!/usr/bin/env node

/**
 * Creates admin user from environment variables
 * Called by init-setup.sh when database exists but has no users
 *
 * Required env vars:
 * - ADMIN_EMAIL: Email for admin account
 * - ADMIN_PASSWORD: Password for admin account
 */

import Database from 'better-sqlite3';
import { hash } from '@node-rs/argon2';
import { nanoid } from 'nanoid';

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

function generateId() {
  return nanoid();
}

async function createAdmin() {
  try {
    const hashedPassword = await hashPassword(password);
    const userId = await generateId();

    const db = new Database('/data/central.db');

    db.prepare(`
      INSERT INTO users (id, email, password_hash, display_name, role, email_verified, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      email,
      hashedPassword,
      email.split('@')[0],
      'admin',
      1,
      Date.now(),
      Date.now()
    );

    console.log(`[init] ✓ Admin user created: ${email}`);
    db.close();
    process.exit(0);
  } catch (error) {
    console.error('[init] Error creating admin user:', error.message);
    process.exit(1);
  }
}

createAdmin();
