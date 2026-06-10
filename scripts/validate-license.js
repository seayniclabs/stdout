#!/usr/bin/env node
import { validateLicenseAtStartup, exitWithLicenseError } from '../dist/lib/license.js';

async function main() {
  const result = await validateLicenseAtStartup();

  if (!result.valid) {
    exitWithLicenseError(result.error || 'License validation failed');
  }

  console.log('[License] Validation passed');
  process.exit(0);
}

main().catch((err) => {
  console.error('[License] Validation error:', err);
  process.exit(1);
});
