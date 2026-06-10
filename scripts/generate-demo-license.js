#!/usr/bin/env node
/**
 * Generates a DEMO license for testing StdOut installation.
 * This creates a simple license record that bypasses signature verification in dev mode.
 *
 * For production licenses, use the server-side license generation API with the private key.
 */

import { writeFileSync } from 'fs';
import crypto from 'crypto';

const email = process.argv[2] || 'demo@example.com';
const outputFile = process.argv[3] || 'demo-license.json';

// Create a demo license (format matches what the app expects)
const license = {
  key: `DEMO-${crypto.randomBytes(8).toString('hex').toUpperCase()}`,
  email: email,
  issuedAt: Date.now(),
  expiresAt: null, // Never expires
  signature: 'demo-signature-not-validated-in-dev-mode',
};

writeFileSync(outputFile, JSON.stringify(license, null, 2));

console.log('✓ Demo license generated');
console.log('');
console.log(`Email: ${email}`);
console.log(`Key: ${license.key}`);
console.log(`File: ${outputFile}`);
console.log('');
console.log('⚠️  This is a DEMO license for testing only');
console.log('   It will only work in development mode (NODE_ENV=development)');
console.log('');
console.log('For production testing, you need:');
console.log('1. A real signed license from generate-license.js (requires private key)');
console.log('2. Or set NODE_ENV=development to bypass license validation');
