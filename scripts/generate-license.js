#!/usr/bin/env node
import crypto from 'crypto';
import { writeFileSync, readFileSync } from 'fs';

/**
 * Generates a signed StdOut license.
 * Uses Ed25519 — produces ~160 char keys vs ~750 with RSA.
 *
 * Usage: node scripts/generate-license.js <email> [--expires <days>] [--output <file>]
 */

// Load Ed25519 private key — path from env or default secrets location
const keyPath = process.env.LICENSE_PRIVATE_KEY_PATH || '/Volumes/data/secrets/stdout_license_ed25519_private_key';
let PRIVATE_KEY_PEM;
try {
  PRIVATE_KEY_PEM = readFileSync(keyPath, 'utf8');
} catch {
  console.error(`Error: Cannot read private key at ${keyPath}`);
  console.error('Set LICENSE_PRIVATE_KEY_PATH to the correct path.');
  process.exit(1);
}

const args = process.argv.slice(2);

if (args.length < 1 || args.includes('--help')) {
  console.log('Usage: node generate-license.js <email> [options]');
  console.log('');
  console.log('Options:');
  console.log('  --expires <days>       License expires in N days (default: never)');
  console.log('  --output <file>        Write license file (default: stdout.license)');
  console.log('  --max-activations <n>  Max activations (default: 1)');
  console.log('');
  console.log('Example:');
  console.log('  node generate-license.js user@example.com');
  console.log('  node generate-license.js user@example.com --expires 365');
  process.exit(0);
}

const email = args[0];
let expiresInDays = null;
let outputFile = 'stdout.license';
let maxActivations = 1;

for (let i = 1; i < args.length; i++) {
  if (args[i] === '--expires' && args[i + 1]) {
    expiresInDays = parseInt(args[i + 1]);
    i++;
  } else if (args[i] === '--output' && args[i + 1]) {
    outputFile = args[i + 1];
    i++;
  } else if (args[i] === '--max-activations' && args[i + 1]) {
    maxActivations = parseInt(args[i + 1]);
    i++;
  }
}

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Error: Invalid email address');
  process.exit(1);
}

// Compact payload — e=email, i=issued unix secs, x=expires, m=maxActivations
// Omit fields at their defaults (no expires, maxActivations=1) to keep payload tiny
const now = Math.floor(Date.now() / 1000);
const payload = {
  e: email,
  i: now,
  ...(expiresInDays ? { x: now + expiresInDays * 86400 } : {}),
  ...(maxActivations !== 1 ? { m: maxActivations } : {}),
};

const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

// Sign with Ed25519 — 64-byte signature → ~86 base64url chars
const signature = crypto.sign(null, Buffer.from(payloadB64), PRIVATE_KEY_PEM).toString('base64url');

const licenseKey = `SL-${payloadB64}.${signature}`;

writeFileSync(outputFile, JSON.stringify({
  key: licenseKey,
  email,
  product: 'stdout-self-host',
  issuedAt: now * 1000,
  expiresAt: payload.x ? payload.x * 1000 : null,
}, null, 2));

console.log('✓ License generated');
console.log(`  Email:   ${email}`);
console.log(`  Issued:  ${new Date(now * 1000).toISOString()}`);
console.log(`  Expires: ${payload.x ? new Date(payload.x * 1000).toISOString() : 'Never'}`);
console.log(`  Length:  ${licenseKey.length} chars`);
console.log('');
console.log(licenseKey);
