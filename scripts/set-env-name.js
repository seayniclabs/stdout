#!/usr/bin/env node
import { db } from '../src/lib/db/central.js';
import { systemState } from '../src/lib/db/central-schema.js';

const [envName] = process.argv.slice(2);

if (!envName) {
  console.error('Usage: set-env-name.js <name>');
  process.exit(1);
}

try {
  await db.insert(systemState)
    .values({
      key: 'environment_name',
      value: envName,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: systemState.key,
      set: { value: envName, updatedAt: new Date() },
    });

  console.log(`✓ Environment name set: ${envName}`);
  process.exit(0);
} catch (error) {
  console.error('Error setting environment name:', error.message);
  process.exit(1);
}
