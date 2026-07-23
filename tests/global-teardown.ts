/**
 * Global teardown - cleans up test data after test run
 */
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

async function globalTeardown() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const dbPath = path.join(__dirname, '..', 'data', 'stdout.db');

  console.log('[teardown] Cleaning up test users from:', dbPath);

  const db = new Database(dbPath);

  // Delete test users created during test run
  const result = db.prepare(`
    DELETE FROM users
    WHERE email LIKE 'test_%@example.com'
       OR email LIKE 'test_playwright_%@example.com'
  `).run();

  console.log(`[teardown] Deleted ${result.changes} test users`);

  db.close();
}

export default globalTeardown;
