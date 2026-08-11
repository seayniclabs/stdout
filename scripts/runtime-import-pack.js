/**
 * Runtime Pack Import Script
 *
 * Phase 3.2: Community Knowledge Packs
 *
 * Works in production containers (uses dist/ not src/)
 * Usage: node scripts/runtime-import-pack.js <pack-name>
 */

import { readFileSync } from 'fs';
import { join } from 'path';

async function main() {
  const packName = process.argv[2];

  if (!packName) {
    console.error('Usage: node scripts/runtime-import-pack.js <pack-name>');
    process.exit(1);
  }

  // Import from dist (production) or src (development)
  let importPack;
  try {
    const module = await import('../dist/server/chunks/pack-importer.mjs');
    importPack = module.importPack;
  } catch {
    // Fallback to source in development
    const module = await import('../src/lib/open-notebook/pack-importer.ts');
    importPack = module.importPack;
  }

  const packPath = join(process.cwd(), 'community-packs', packName, 'pack.json');

  try {
    const packJson = readFileSync(packPath, 'utf-8');
    const pack = JSON.parse(packJson);

    console.log('[Pack Import] Importing:', pack.pack.title);
    const result = await importPack(pack);

    console.log('[Pack Import] Complete:');
    console.log(`  Imported: ${result.imported} docs`);
    console.log(`  Skipped: ${result.skipped} docs (already exist)`);
    console.log(`  Errors: ${result.errors}`);

    if (result.errors > 0) {
      console.log('\nErrors:');
      result.details.errors.forEach(e => console.log(`  - ${e.docId}: ${e.error}`));
      process.exit(1);
    }

    if (result.imported > 0) {
      console.log('\n✓ Pack imported successfully');
    } else if (result.skipped > 0) {
      console.log('\n⚠ All docs already exist in knowledge base');
    }
  } catch (error) {
    console.error('[Pack Import] Error:', error);
    process.exit(1);
  }
}

main();
