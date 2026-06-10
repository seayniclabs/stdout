#!/usr/bin/env node
import { db } from '../src/lib/db/central.js';
import { users } from '../src/lib/db/central-schema.js';
import bcrypt from 'bcrypt';
import { nanoid } from 'nanoid';

const [email, password] = process.argv.slice(2);

if (!email || !password) {
  console.error('Usage: create-admin.js <email> <password>');
  process.exit(1);
}

if (password.length < 8) {
  console.error('Error: Password must be at least 8 characters');
  process.exit(1);
}

try {
  const hashedPassword = await bcrypt.hash(password, 10);

  await db.insert(users).values({
    id: nanoid(),
    email,
    password: hashedPassword,
    name: 'Admin',
    role: 'admin',
    emailVerified: true,
    createdAt: new Date(),
  });

  console.log(`✓ Admin user created: ${email}`);
  process.exit(0);
} catch (error) {
  console.error('Error creating admin user:', error.message);
  process.exit(1);
}
