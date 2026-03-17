#!/usr/bin/env node
/**
 * Migration script: single stdout.db → central.db + per-tenant DBs.
 *
 * Usage:
 *   STDOUT_MODE=saas node scripts/migrate-to-multitenant.js
 *
 * What it does:
 *   1. Opens the existing data/stdout.db
 *   2. Creates data/central.db with auth tables + copies user/session rows
 *   3. For each user, creates data/tenants/{userId}.db with their tenant data
 *   4. Renames stdout.db → stdout.db.backup
 *
 * Idempotent: safe to run multiple times. Skips if central.db already exists.
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const SOURCE_DB = path.join(DATA_DIR, 'stdout.db');
const CENTRAL_DB = path.join(DATA_DIR, 'central.db');
const TENANTS_DIR = path.join(DATA_DIR, 'tenants');

if (!fs.existsSync(SOURCE_DB)) {
  console.error(`Source DB not found: ${SOURCE_DB}`);
  process.exit(1);
}

if (fs.existsSync(CENTRAL_DB)) {
  console.log('central.db already exists — skipping migration (idempotent).');
  process.exit(0);
}

console.log(`Migrating ${SOURCE_DB} → multi-tenant...`);

const src = new Database(SOURCE_DB, { readonly: true });

// Create central DB
const central = new Database(CENTRAL_DB);
central.pragma('journal_mode = WAL');
central.pragma('foreign_keys = ON');

central.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    subscription_status TEXT NOT NULL DEFAULT 'none',
    role TEXT NOT NULL DEFAULT 'member',
    email_verified INTEGER NOT NULL DEFAULT 0,
    email_verified_at INTEGER,
    stripe_customer_id TEXT,
    privacy_accepted_at INTEGER,
    dpa_accepted_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS email_verifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS api_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    last_used_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    action TEXT NOT NULL,
    details TEXT,
    ip TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS deletions (
    id TEXT PRIMARY KEY,
    email_hash TEXT NOT NULL,
    deleted_at INTEGER NOT NULL
  );
`);

// Copy users and sessions
const users = src.prepare('SELECT * FROM users').all();
const insertUser = central.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash, display_name, subscription_status, role, email_verified, email_verified_at, stripe_customer_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

for (const u of users) {
  insertUser.run(u.id, u.email, u.password_hash, u.display_name, u.subscription_status, u.role, u.email_verified, u.email_verified_at, u.stripe_customer_id, u.created_at, u.updated_at);
}
console.log(`  Copied ${users.length} users to central.db`);

const sessions = src.prepare('SELECT * FROM sessions').all();
const insertSession = central.prepare('INSERT OR IGNORE INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)');
for (const s of sessions) {
  insertSession.run(s.id, s.user_id, s.expires_at);
}
console.log(`  Copied ${sessions.length} sessions to central.db`);

// Copy password_resets and email_verifications if they exist
try {
  const resets = src.prepare('SELECT * FROM password_resets').all();
  const insertReset = central.prepare('INSERT OR IGNORE INTO password_resets (id, user_id, token, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  for (const r of resets) insertReset.run(r.id, r.user_id, r.token, r.expires_at, r.used_at, r.created_at);
} catch { /* table may not exist */ }

try {
  const verifs = src.prepare('SELECT * FROM email_verifications').all();
  const insertVerif = central.prepare('INSERT OR IGNORE INTO email_verifications (id, user_id, token, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  for (const v of verifs) insertVerif.run(v.id, v.user_id, v.token, v.expires_at, v.used_at, v.created_at);
} catch { /* table may not exist */ }

central.close();

// Create tenant DBs
if (!fs.existsSync(TENANTS_DIR)) fs.mkdirSync(TENANTS_DIR, { recursive: true });

const tenantDDL = `
  CREATE TABLE IF NOT EXISTS stacks (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, stack_id TEXT, title TEXT NOT NULL,
    description TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'active',
    tags TEXT, resolved_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS resolutions (
    id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, user_id TEXT NOT NULL, content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS diagnoses (
    id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, root_causes TEXT NOT NULL,
    suggested_commands TEXT, matched_incident_ids TEXT, model TEXT NOT NULL,
    prompt_tokens INTEGER, completion_tokens INTEGER, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS stack_imports (
    id TEXT PRIMARY KEY, raw_json TEXT NOT NULL, rendered_markdown TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS incidents_fts USING fts5(
    title, description, tags, content='incidents', content_rowid='rowid'
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS resolutions_fts USING fts5(
    content, content='resolutions', content_rowid='rowid'
  );
`;

for (const user of users) {
  const tenantPath = path.join(TENANTS_DIR, `${user.id}.db`);
  const tenant = new Database(tenantPath);
  tenant.pragma('journal_mode = WAL');
  tenant.pragma('foreign_keys = ON');
  tenant.exec(tenantDDL);

  // Copy stacks
  const stacks = src.prepare('SELECT * FROM stacks WHERE user_id = ?').all(user.id);
  const insertStack = tenant.prepare('INSERT OR IGNORE INTO stacks (id, user_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
  for (const s of stacks) insertStack.run(s.id, s.user_id, s.name, s.description, s.created_at, s.updated_at);

  // Copy incidents
  const incidents = src.prepare('SELECT * FROM incidents WHERE user_id = ?').all(user.id);
  const insertIncident = tenant.prepare('INSERT OR IGNORE INTO incidents (id, user_id, stack_id, title, description, severity, status, tags, resolved_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const i of incidents) insertIncident.run(i.id, i.user_id, i.stack_id, i.title, i.description, i.severity, i.status, i.tags, i.resolved_at, i.created_at, i.updated_at);

  // Copy resolutions
  const resolutions = src.prepare('SELECT * FROM resolutions WHERE user_id = ?').all(user.id);
  const insertRes = tenant.prepare('INSERT OR IGNORE INTO resolutions (id, incident_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)');
  for (const r of resolutions) insertRes.run(r.id, r.incident_id, r.user_id, r.content, r.created_at);

  // Copy diagnoses
  const diagnoses = src.prepare(`SELECT d.* FROM diagnoses d JOIN incidents i ON d.incident_id = i.id WHERE i.user_id = ?`).all(user.id);
  const insertDiag = tenant.prepare('INSERT OR IGNORE INTO diagnoses (id, incident_id, root_causes, suggested_commands, matched_incident_ids, model, prompt_tokens, completion_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const d of diagnoses) insertDiag.run(d.id, d.incident_id, d.root_causes, d.suggested_commands, d.matched_incident_ids, d.model, d.prompt_tokens, d.completion_tokens, d.created_at);

  // Rebuild FTS indexes
  for (const i of incidents) {
    try { tenant.prepare('INSERT INTO incidents_fts(rowid, title, description, tags) SELECT rowid, title, description, tags FROM incidents WHERE id = ?').run(i.id); } catch {}
  }
  for (const r of resolutions) {
    try { tenant.prepare('INSERT INTO resolutions_fts(rowid, content) SELECT rowid, content FROM resolutions WHERE id = ?').run(r.id); } catch {}
  }

  tenant.close();
  console.log(`  Tenant ${user.id} (${user.email}): ${stacks.length} stacks, ${incidents.length} incidents, ${resolutions.length} resolutions, ${diagnoses.length} diagnoses`);
}

src.close();

// Rename source DB
const backupPath = SOURCE_DB + '.backup';
fs.renameSync(SOURCE_DB, backupPath);
if (fs.existsSync(SOURCE_DB + '-wal')) fs.renameSync(SOURCE_DB + '-wal', backupPath + '-wal');
if (fs.existsSync(SOURCE_DB + '-shm')) fs.renameSync(SOURCE_DB + '-shm', backupPath + '-shm');

console.log(`\nMigration complete.`);
console.log(`  Backup: ${backupPath}`);
console.log(`  Central: ${CENTRAL_DB}`);
console.log(`  Tenants: ${TENANTS_DIR}/`);
console.log(`\nSet STDOUT_MODE=saas and restart the container.`);
