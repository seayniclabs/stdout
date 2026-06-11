#!/usr/bin/env node
import Database from 'better-sqlite3';

/**
 * Stores a license key in the database.
 * Usage: node scripts/set-license.js <license-key> <email>
 */

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: node scripts/set-license.js <license-key> <email>');
  console.error('');
  console.error('Example:');
  console.error('  node scripts/set-license.js "SL-abc123.def456" "user@example.com"');
  process.exit(1);
}

const [licenseKey, email] = args;

// Validate format
if (!licenseKey.startsWith('SL-')) {
  console.error('Error: Invalid license key format');
  console.error('License keys must start with SL-');
  process.exit(1);
}

// Validate email
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!emailRegex.test(email)) {
  console.error('Error: Invalid email address');
  process.exit(1);
}

// Store in database
try {
  const db = new Database('/data/central.db');

  const now = Date.now();
  db.prepare(`
    INSERT INTO license (key, email, edition, activated_at)
    VALUES (?, ?, 'self-host', ?)
    ON CONFLICT(key) DO UPDATE SET
      email = excluded.email,
      activated_at = excluded.activated_at
  `).run(licenseKey, email, now);

  console.log('✓ License activated successfully');
  console.log(`  Email: ${email}`);
  console.log(`  Key: ${licenseKey.substring(0, 15)}...`);

  db.close();
  process.exit(0);
} catch (err) {
  console.error('Error: Failed to store license');
  console.error(err.message);
  process.exit(1);
}
