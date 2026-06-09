/**
 * Migration: Add stack_id column to discovered_hosts table
 *
 * This links discovered hosts to stacks, enabling proper infrastructure grouping.
 * For existing installations, this will link all discovered hosts to the first stack.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Determine database path
const isDocker = process.env.STDOUT_MODE === 'selfhost' || process.env.DB_PATH;
const dbPath = process.env.DB_PATH || join(__dirname, '../data/stdout.db');

console.log('[migrate] Database path:', dbPath);

const db = new Database(dbPath);

try {
  // Check if column already exists
  const tableInfo = db.prepare("PRAGMA table_info(discovered_hosts)").all() as any[];
  const hasStackId = tableInfo.some((col: any) => col.name === 'stack_id');

  if (hasStackId) {
    console.log('[migrate] ✓ stack_id column already exists, skipping migration');
    process.exit(0);
  }

  console.log('[migrate] Adding stack_id column to discovered_hosts...');

  // Add the column
  db.prepare('ALTER TABLE discovered_hosts ADD COLUMN stack_id TEXT').run();

  console.log('[migrate] ✓ Column added successfully');

  // Link existing hosts to the first stack (if any)
  const stacks = db.prepare('SELECT id, user_id FROM stacks LIMIT 1').all() as any[];

  if (stacks.length > 0) {
    const stackId = stacks[0].id;
    const userId = stacks[0].user_id;

    console.log(`[migrate] Linking existing hosts to stack: ${stackId}`);

    const result = db.prepare(
      'UPDATE discovered_hosts SET stack_id = ? WHERE user_id = ? AND stack_id IS NULL'
    ).run(stackId, userId);

    console.log(`[migrate] ✓ Linked ${result.changes} hosts to stack`);
  } else {
    console.log('[migrate] No stacks found, hosts will remain unlinked');
  }

  console.log('[migrate] Migration complete!');
} catch (error) {
  console.error('[migrate] Migration failed:', error);
  process.exit(1);
} finally {
  db.close();
}
