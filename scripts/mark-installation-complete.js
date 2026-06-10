#!/usr/bin/env node
import { db } from '../src/lib/db/central.js';
import { systemState } from '../src/lib/db/central-schema.js';

try {
  await db.insert(systemState)
    .values({
      key: 'installation_complete',
      value: 'true',
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: systemState.key,
      set: { value: 'true', updatedAt: new Date() },
    });

  console.log('✓ Installation marked complete');
  process.exit(0);
} catch (error) {
  console.error('Error marking installation complete:', error.message);
  process.exit(1);
}
