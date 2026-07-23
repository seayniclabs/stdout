/**
 * Test database setup - ensures clean state before tests
 */
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'stdout.db');

async function setupTestDatabase() {
  console.log('[test-setup] Preparing test database:', dbPath);

  // Ensure database exists
  if (!fs.existsSync(dbPath)) {
    console.error('[test-setup] Database not found! Run migrations first: npm run db:migrate');
    process.exit(1);
  }

  const db = new Database(dbPath);

// Clear test users from previous runs
const deleteResult = db.prepare(`
  DELETE FROM users
  WHERE email LIKE 'test_%@example.com'
     OR email LIKE 'test_playwright_%@example.com'
`).run();

console.log(`[test-setup] Deleted ${deleteResult.changes} test users from previous runs`);

// Clear test data
const tables = ['sessions', 'incidents', 'monitors', 'playbooks', 'stacks', 'docs'];
for (const table of tables) {
  try {
    // Only delete test-related data if possible
    const testCount = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
    console.log(`[test-setup] ${table}: ${testCount.count} rows`);
  } catch (err) {
    // Table might not exist or have different schema
  }
}

let userCount = db.prepare(`SELECT COUNT(*) as count FROM users`).get() as { count: number };
console.log(`[test-setup] Current users in database: ${userCount.count}`);

// If no users exist, seed one admin to skip setup wizard
if (userCount.count === 0) {
  console.log('[test-setup] No users found - seeding admin account to skip setup wizard');

  // Import argon2 for password hashing and nanoid for ID generation
  const { hash } = await import('@node-rs/argon2');
  const { nanoid } = await import('nanoid');
  const passwordHash = await hash('test_admin_password_123');
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(nanoid(), 'admin@stdout.local', passwordHash, 'Test Admin', 'admin', now, now);

  // Mark installation as complete to skip setup wizard
  db.prepare(`
    INSERT OR REPLACE INTO system_state (key, value, updated_at)
    VALUES ('installation_complete', 'true', ?)
  `).run(now);

  // Mark all setup steps as complete to prevent setup wizard redirect
  const setupSteps = [
    'welcome', 'license', 'admin', 'observatory', 'stack', 'monitors', 'integrations', 'complete'
  ];

  for (let i = 0; i < setupSteps.length; i++) {
    db.prepare(`
      INSERT OR REPLACE INTO setup_progress (id, step_number, step_name, completed, completed_at, created_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `).run(nanoid(), i + 1, setupSteps[i], now, now);
  }

  console.log('[test-setup] Seeded admin + marked installation complete + setup steps done');

  userCount = db.prepare(`SELECT COUNT(*) as count FROM users`).get() as { count: number };
}

if (userCount.count >= 8) {
  console.warn(`[test-setup] WARNING: ${userCount.count} users in database. Tests may fail if MAX_USERS_BUILTIN (10) is reached.`);
  console.warn(`[test-setup] Set STDOUT_DISABLE_USER_LIMIT=1 environment variable to bypass limit.`);
}

  db.close();

  console.log('[test-setup] Test database ready\n');
}

// Run setup
setupTestDatabase().catch((err) => {
  console.error('[test-setup] Setup failed:', err);
  process.exit(1);
});
