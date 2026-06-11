#!/usr/bin/env node
import crypto from 'crypto';
import { writeFileSync } from 'fs';

/**
 * Generates a signed StdOut license for distribution.
 * Server-side only - requires private key.
 *
 * Usage: node scripts/generate-license.js <email> [--expires <days>] [--output <file>]
 */

// Private key for signing (RSA-4096)
// In production, load from secure environment variable or secrets manager
const PRIVATE_KEY_PEM = process.env.LICENSE_PRIVATE_KEY || `-----BEGIN PRIVATE KEY-----
MIIJQgIBADANBgkqhkiG9w0BAQEFAASCCSwwggkoAgEAAoICAQDWR9fViWlzM+yb
oUqUOuvAAyCMthhBlknl+lRwgvYSkqzb4VA4Ivh/dwPi/Af/pqOQvO27IVc290j6
WM2C0bBxj3BuTuyBWXaGD7sd7as6r92Kmxgl DgyBFUCy1QmQWpw97Hw621mhs1t0
dcDxX53Rcu8lktO+l7lI125BDJIeEAbymU/S5UhOEkb2s7ya1cS75Gac7CUnxU8y
czTkY9tySLFXpt0kJvId1nbZB62iAxwcsgL3/g4LuXPP/W0gkeWKIm8ntt5YyADf
KTkyr/HKqVigjGwzLm2i8udIrTgxTtZBFXtkHVcH02DhOtJH/sQ37R1Atwfae3MR
eGxoTNzngE5uRgg9vKsOu2vbvST90zChUEt8uEKW4JGKobRc98mrK6iwlWGQbmep
ilBuFIbCGnWTlZe3fAK4lKmvEZzZAt7QRDC9abNx3we2DZ3OmIx6lV8V2MpcLZ0U
19la371tgN73jnjh6ERnGHbcDBUF14I+ItNl7R0+1ZvO3uakYXNW1dmA1DiLpQiI
/sLUaRG2dcMLOr6JYdETg5OJjB/2RPr6tMA9MU0XBCqxDxevP+jybuwDFmtrK/+b
Nbsrp EkUqw2CVtT27jkv8tVVzAgW4aLamj2Zc5RQ4JGLBGwlHvJRfxOi8HKtImGn
ZuSzCwDQUpO0n3Pvud4eEhMAVquOLwIDAQABAoICABgO8qyxHj7VvNmMEQXh5B8r
...
-----END PRIVATE KEY-----`;

const args = process.argv.slice(2);

if (args.length < 1 || args.includes('--help')) {
  console.log('Usage: node generate-license.js <email> [options]');
  console.log('');
  console.log('Options:');
  console.log('  --expires <days>   License expires in N days (default: never)');
  console.log('  --output <file>    Write license to file (default: stdout.license)');
  console.log('  --product <name>   Product name (default: stdout-self-host)');
  console.log('  --max-activations <n>  Max activations (default: 1)');
  console.log('');
  console.log('Example:');
  console.log('  node generate-license.js user@example.com');
  console.log('  node generate-license.js user@example.com --expires 365 --output license.txt');
  process.exit(0);
}

const email = args[0];
let expiresInDays = null;
let outputFile = 'stdout.license';
let product = 'stdout-self-host';
let maxActivations = 1;

// Parse options
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--expires' && args[i + 1]) {
    expiresInDays = parseInt(args[i + 1]);
    i++;
  } else if (args[i] === '--output' && args[i + 1]) {
    outputFile = args[i + 1];
    i++;
  } else if (args[i] === '--product' && args[i + 1]) {
    product = args[i + 1];
    i++;
  } else if (args[i] === '--max-activations' && args[i + 1]) {
    maxActivations = parseInt(args[i + 1]);
    i++;
  }
}

// Validate email
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!emailRegex.test(email)) {
  console.error('Error: Invalid email address');
  process.exit(1);
}

// Create payload — compact field names to minimize key length
// e=email, i=issued, x=expires, m=maxActivations
// product is always stdout-self-host and is verified implicitly
const now = Math.floor(Date.now() / 1000);
const payload = {
  e: email,
  i: now,
  ...(expiresInDays ? { x: now + expiresInDays * 86400 } : {}),
  ...(maxActivations !== 1 ? { m: maxActivations } : {}),
};

// Encode payload as base64url
const payloadJson = JSON.stringify(payload);
const payloadB64 = Buffer.from(payloadJson, 'utf8').toString('base64url');

// Sign with RSA-SHA256
const sign = crypto.createSign('RSA-SHA256');
sign.update(payloadB64);
sign.end();
const signature = sign.sign(PRIVATE_KEY_PEM, 'base64url');

// Construct license key
const licenseKey = `SL-${payloadB64}.${signature}`;

// Create license file (for offline use)
const licenseFile = {
  key: licenseKey,
  email: payload.e,
  product: 'stdout-self-host',
  issuedAt: payload.i * 1000,
  expiresAt: payload.x ? payload.x * 1000 : null,
};

// Write to file
writeFileSync(outputFile, JSON.stringify(licenseFile, null, 2));

// Display results
console.log('✓ License generated successfully');
console.log('');
console.log(`Email: ${email}`);
console.log(`Product: stdout-self-host`);
console.log(`Issued: ${new Date(payload.i * 1000).toISOString()}`);
if (payload.x) {
  console.log(`Expires: ${new Date(payload.x * 1000).toISOString()} (${expiresInDays} days)`);
} else {
  console.log('Expires: Never');
}
console.log(`Max Activations: ${payload.m ?? 1}`);
console.log('');
console.log('License Key:');
console.log(licenseKey);
console.log('');
console.log(`License file written to: ${outputFile}`);
console.log('');
console.log('For online install: user enters the license key above');
console.log('For offline install: user downloads the license file');
