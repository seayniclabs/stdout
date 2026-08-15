#!/usr/bin/env node
import Database from 'better-sqlite3';
import crypto from 'crypto';

function generateId(prefix = '') {
  return prefix + crypto.randomBytes(16).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
}

try {
  const DB_PATH = process.env.DB_PATH || process.env.DATABASE_PATH || '/data/stdout.db';
  const db = new Database(DB_PATH);
  const now = Date.now();

  // Mark installation complete
  db.prepare(`
    INSERT INTO system_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run('installation_complete', 'true', now);

  const users = db.prepare('SELECT id, email FROM users').all();
  if (users.length === 0) {
    console.error('No users found');
    process.exit(1);
  }

  const user = users[0];

  // 1. Create scanner API token
  const tokenExists = db.prepare('SELECT id FROM api_tokens WHERE user_id = ? AND name = ?').get(user.id, 'Scanner');
  if (!tokenExists) {
    const tokenId = generateId();
    const tokenValue = `stdout_${crypto.randomBytes(32).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(tokenValue).digest('hex');
    db.prepare(`
      INSERT INTO api_tokens (id, user_id, name, token_hash, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(tokenId, user.id, 'Scanner', tokenHash, now);
    // Write token to file so scanner can use it
    console.log(`✓ Created scanner API token`);
    console.log(`SCANNER_TOKEN=${tokenValue}`);
  }

  // 2. Trigger initial network scan if no hosts discovered
  const hostCount = db.prepare('SELECT COUNT(*) as count FROM discovered_hosts').get().count;
  if (hostCount === 0) {
    // Enable scanner schedule (uses interval-based scheduling, not cron)
    db.prepare(`
      INSERT INTO scanner_schedule (id, user_id, enabled, interval, hour, minute, weekday, modules, updated_at)
      VALUES (?, ?, 1, 'daily', 3, 0, 0, '["docker","metrics"]', ?)
      ON CONFLICT(id) DO UPDATE SET enabled = 1, updated_at = excluded.updated_at
    `).run(generateId('sched_'), user.id, now);
    console.log('✓ Scheduled initial network scan');
  }

  // 3. Auto-sync Windlass if available
  const windlassConfig = db.prepare('SELECT id FROM windlass_config WHERE user_id = ?').get(user.id);
  if (!windlassConfig) {
    const configId = generateId('wc_');
    db.prepare(`
      INSERT INTO windlass_config (id, user_id, endpoint_url, created_at, updated_at)
      VALUES (?, ?, 'http://windlass:8116', ?, ?)
    `).run(configId, user.id, now, now);
    console.log('✓ Configured Windlass endpoint');
  }

  // 4. Dismiss onboarding in system_settings (single-instance)
  const allSteps = JSON.stringify(['license', 'environment', 'token', 'scanner', 'review', 'windlass', 'monitors', 'done']);
  db.prepare(`
    INSERT INTO system_settings (id, onboarding_dismissed, onboarding_progress, created_at, updated_at)
    VALUES ('instance', 1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      onboarding_dismissed = 1,
      onboarding_progress = excluded.onboarding_progress,
      updated_at = excluded.updated_at
  `).run(allSteps, now, now);
  console.log('✓ Onboarding dismissed');

  console.log('✓ Installation marked complete');
  process.exit(0);
} catch (error) {
  console.error('Error marking installation complete:', error.message);
  console.error(error.stack);
  process.exit(1);
}
