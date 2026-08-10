import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const DATA_DIR = process.env.DB_PATH
  ? path.dirname(process.env.DB_PATH)
  : './data';

const MAX_BACKUPS = 3;

export interface BackupInfo {
  filename: string;
  createdAt: string; // ISO timestamp extracted from filename
  sizeBytes: number;
}

// --- Key derivation ---

function getMasterKey(): Buffer {
  const keyPath = process.env.BACKUP_MASTER_KEY_FILE || '/run/secrets/backup_master_key';
  try {
    const hex = fs.readFileSync(keyPath, 'utf8').trim();
    return Buffer.from(hex, 'hex');
  } catch {
    throw new Error('Backup master key not found. Set BACKUP_MASTER_KEY_FILE or mount the secret.');
  }
}

function deriveKey(_userId: string = 'instance'): Buffer {
  const masterKey = getMasterKey();
  return crypto.hkdfSync('sha256', masterKey, 'stdout-instance', 'stdout-backup', 32) as unknown as Buffer;
}

// --- Encryption ---

function encrypt(data: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag(); // 16 bytes
  // Format: [iv (12)] [authTag (16)] [encrypted data]
  return Buffer.concat([iv, authTag, encrypted]);
}

function decrypt(payload: Buffer, key: Buffer): Buffer {
  const iv = payload.subarray(0, 12);
  const authTag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

// --- Paths ---

function getBackupDir(_userId: string = 'instance'): string {
  return path.join(DATA_DIR, 'backups');
}

function getTenantDbPath(_userId?: string): string {
  return process.env.DB_PATH || path.join(DATA_DIR, 'stdout.db');
}

// --- Public API ---

/**
 * Create an encrypted backup of the database.
 * Uses SQLite's backup API for a safe, consistent snapshot.
 * Keeps max 3 backups, prunes oldest.
 */
export function createBackup(userId: string = 'instance'): BackupInfo {
  const srcPath = getTenantDbPath(userId);
  if (!fs.existsSync(srcPath)) {
    throw new Error('Database not found.');
  }

  const backupDir = getBackupDir(userId);
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const tmpPath = path.join(backupDir, `_tmp_${Date.now()}.db`);

  // Use VACUUM INTO which creates a clean copy
  const db = new Database(srcPath, { readonly: true });
  db.exec(`VACUUM INTO '${tmpPath.replace(/'/g, "''")}'`);
  db.close();

  // Encrypt the snapshot
  const rawData = fs.readFileSync(tmpPath);
  const key = deriveKey(userId);
  const encrypted = encrypt(rawData, key);

  // Write encrypted backup
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}.db.enc`;
  const destPath = path.join(backupDir, filename);
  fs.writeFileSync(destPath, encrypted);

  // Clean up temp file
  fs.unlinkSync(tmpPath);

  // Prune old backups (keep newest MAX_BACKUPS)
  pruneBackups(userId);

  return {
    filename,
    createdAt: new Date().toISOString(),
    sizeBytes: encrypted.length,
  };
}

/**
 * List available backups.
 */
export function listBackups(userId: string = 'instance'): BackupInfo[] {
  const backupDir = getBackupDir(userId);
  if (!fs.existsSync(backupDir)) return [];

  const files = fs.readdirSync(backupDir)
    .filter(f => f.endsWith('.db.enc'))
    .sort()
    .reverse(); // Newest first

  return files.map(filename => {
    const filePath = path.join(backupDir, filename);
    const stats = fs.statSync(filePath);
    const tsRaw = filename.replace('.db.enc', '').replace(/-(\d{2})-(\d{2})-(\d{3})Z/, ':$1:$2.$3Z');
    return {
      filename,
      createdAt: tsRaw,
      sizeBytes: stats.size,
    };
  });
}

/**
 * Restore database from an encrypted backup.
 */
export function restoreBackup(userId: string = 'instance', filename: string): void {
  const backupDir = getBackupDir(userId);
  const backupPath = path.join(backupDir, filename);

  if (!fs.existsSync(backupPath)) {
    throw new Error('Backup file not found.');
  }

  // Validate filename to prevent path traversal
  if (filename.includes('/') || filename.includes('..')) {
    throw new Error('Invalid backup filename.');
  }

  // Decrypt
  const encrypted = fs.readFileSync(backupPath);
  const key = deriveKey(userId);
  let decrypted: Buffer;
  try {
    decrypted = decrypt(encrypted, key);
  } catch {
    throw new Error('Failed to decrypt backup. Key mismatch or corrupted file.');
  }

  // Validate it's a valid SQLite file (magic bytes: "SQLite format 3\0")
  if (decrypted.length < 16 || decrypted.toString('utf8', 0, 15) !== 'SQLite format 3') {
    throw new Error('Decrypted data is not a valid SQLite database.');
  }

  // Replace the tenant DB
  const tenantPath = getTenantDbPath(userId);
  const walPath = tenantPath + '-wal';
  const shmPath = tenantPath + '-shm';

  // Remove WAL/SHM files first
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

  // Write the restored DB
  fs.writeFileSync(tenantPath, decrypted);
}

/**
 * Delete all backups.
 */
export function deleteAllBackups(userId: string = 'instance'): void {
  const backupDir = getBackupDir(userId);
  if (!fs.existsSync(backupDir)) return;

  const files = fs.readdirSync(backupDir);
  for (const f of files) {
    fs.unlinkSync(path.join(backupDir, f));
  }
  fs.rmdirSync(backupDir);
}

// --- Internal ---

function pruneBackups(userId: string = 'instance'): void {
  const backupDir = getBackupDir(userId);
  if (!fs.existsSync(backupDir)) return;

  const files = fs.readdirSync(backupDir)
    .filter(f => f.endsWith('.db.enc'))
    .sort()
    .reverse();

  // Delete everything after MAX_BACKUPS
  for (let i = MAX_BACKUPS; i < files.length; i++) {
    fs.unlinkSync(path.join(backupDir, files[i]));
  }
}
