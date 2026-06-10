#!/usr/bin/env node
import { storeLicense, verifyLicenseSignature, isValidLicenseKeyFormat } from '../dist/lib/license.js';

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
if (!isValidLicenseKeyFormat(licenseKey)) {
  console.error('Error: Invalid license key format');
  console.error('License keys must be in format: SL-XXXX-YYYY or SL-<payload>.<signature>');
  process.exit(1);
}

// Validate email
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!emailRegex.test(email)) {
  console.error('Error: Invalid email address');
  process.exit(1);
}

// Verify signature if it's a signed license
const verification = verifyLicenseSignature(licenseKey);
if (!verification.valid && !licenseKey.startsWith('SL-') && licenseKey.includes('-')) {
  // Legacy format - allow but warn
  console.warn('Warning: Legacy license format detected - requires online validation');
} else if (!verification.valid) {
  console.error(`Error: License validation failed - ${verification.reason}`);
  process.exit(1);
}

// Store in database
try {
  storeLicense(licenseKey, email, 'self-host');
  console.log('✓ License activated successfully');
  console.log(`  Email: ${email}`);
  console.log(`  Key: ${licenseKey.substring(0, 15)}...`);

  if (verification.payload) {
    console.log(`  Product: ${verification.payload.product}`);
    if (verification.payload.expires) {
      const expiryDate = new Date(verification.payload.expires * 1000);
      console.log(`  Expires: ${expiryDate.toLocaleDateString()}`);
    } else {
      console.log('  Expires: Never');
    }
  }
} catch (err) {
  console.error('Error: Failed to store license');
  console.error(err.message);
  process.exit(1);
}
