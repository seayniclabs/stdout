#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('Running database migrations...');

// Run the schema application script
try {
  execFileSync('node', [join(__dirname, 'apply-schema.js')], {
    stdio: 'inherit',
    env: process.env
  });
} catch (error) {
  console.error('Migration failed:', error.message);
  process.exit(1);
}

console.log('✓ Database migrations complete');
