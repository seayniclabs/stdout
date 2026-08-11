/**
 * Import a Community Knowledge Pack
 *
 * Phase 3.2: Community Knowledge Packs
 *
 * Usage: npx tsx scripts/import-pack.ts <pack-name>
 * Example: npx tsx scripts/import-pack.ts docker-troubleshooting
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { importPack } from '../src/lib/open-notebook/pack-importer';

async function main() {
  const packName = process.argv[2];

  if (!packName) {
    console.error('Usage: npx tsx scripts/import-pack.ts <pack-name>');
    process.exit(1);
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

    if (result.errors.length > 0) {
      console.log('\nErrors:');
      result.errors.forEach(e => console.log(`  - ${e.docId}: ${e.error}`));
      process.exit(1);
    }

    if (result.imported.length > 0) {
      console.log('\n✓ Pack imported successfully');
    } else if (result.skipped.length > 0) {
      console.log('\n⚠ All docs already exist in knowledge base');
    }
  } catch (error) {
    console.error('[Pack Import] Error:', error);
    process.exit(1);
  }
}

main();
