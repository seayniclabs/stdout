#!/usr/bin/env node

// Standalone admin creation script - no TypeScript dependencies
// Uses only built-in Node modules and installed packages

import Database from 'better-sqlite3';

const [email, password] = process.argv.slice(2);

if (!email || !password) {
  console.error('Usage: create-admin.js <email> <password>');
  process.exit(1);
}

if (password.length < 8) {
  console.error('Error: Password must be at least 8 characters');
  process.exit(1);
}

async function hashPassword(password) {
  // Use dynamic import for bcrypt to avoid module resolution issues
  const bcrypt = await import('bcrypt');
  return bcrypt.default.hash(password, 10);
}

async function generateId() {
  // Use dynamic import for nanoid
  const { nanoid } = await import('nanoid');
  return nanoid();
}

async function createAdmin() {
  try {
    const hashedPassword = await hashPassword(password);
    const userId = await generateId();

    // Open database directly
    const DB_PATH = process.env.DB_PATH || process.env.DATABASE_PATH || '/data/stdout.db';
    const db = new Database(DB_PATH);

    // Insert admin user
    db.prepare(`
      INSERT INTO users (id, email, password, displayName, role, isActive, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      email,
      hashedPassword,
      email.split('@')[0], // Use email prefix as display name
      'admin',
      1,
      Date.now(),
      Date.now()
    );

    console.log(`✓ Admin user created: ${email}`);
    db.close();
    process.exit(0);
  } catch (error) {
    console.error('Error creating admin user:', error.message);
    process.exit(1);
  }
}

createAdmin();
