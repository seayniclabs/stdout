#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const files = [
  'src/pages/app/api/account.ts',
  'src/pages/app/api/comms/inbound/webhook.ts',
  'src/pages/app/api/contribute.ts',
  'src/pages/app/api/docs/embeddings.ts',
  'src/pages/app/api/network/import.ts',
  'src/pages/app/api/network/scan-services.ts',
  'src/pages/app/api/observatory/add-targets.ts',
  'src/pages/app/api/observatory/status.ts',
  'src/pages/app/api/satellite/nodes.ts',
  'src/pages/app/api/satellite/report.ts',
  'src/pages/app/api/search.ts',
  'src/pages/app/api/similar.ts',
  'src/pages/app/api/test/wipe-data.ts',
  'src/pages/app/api/ticketing/sync.ts',
  'src/pages/app/api/windlass/weekly-digest.ts',
  'src/pages/app/index.astro',
  'src/pages/app/infrastructure.astro',
  'src/pages/app/llm.txt.ts',
  'src/pages/app/login.astro',
  'src/pages/app/register.astro',
  'src/pages/app/settings/ticketing.astro',
  'src/pages/healthz.ts',
  'src/pages/status/[slug].astro',
];

files.forEach(file => {
  try {
    let content = readFileSync(file, 'utf-8');

    // Replace all variations of imports
    content = content.replace(
      /import\s*{\s*(getCentralDb|getTenantDb|centralSchema|tenantSchema|evictTenantDb)\s*,?\s*}?\s*from\s*['"](\.\.\/)+lib\/db['"];?/g,
      (match) => {
        // Extract the path depth
        const pathMatch = match.match(/(['"])(\.\.\/)+lib\/db\1/);
        if (!pathMatch) return match;
        const path = pathMatch[0].slice(1, -1); // Remove quotes
        return `import { getDb, schema } from '${path}';`;
      }
    );

    // Replace multiline imports
    content = content.replace(
      /import\s*{\s*([^}]*(?:getCentralDb|getTenantDb|centralSchema|tenantSchema|evictTenantDb)[^}]*)\s*}\s*from\s*['"](\.\.\/)+lib\/db['"];?/g,
      (match, imports, pathPrefix) => {
        const path = pathPrefix + 'lib/db';
        return `import { getDb, schema } from '${path}';`;
      }
    );

    // Handle dynamic imports
    content = content.replace(
      /const\s*{\s*(getCentralDb|getTenantDb|centralSchema|tenantSchema)[^}]*}\s*=\s*await\s*import\(['"](\.\.\/)+lib\/db['"]\)/g,
      (match, _, pathPrefix) => {
        const path = pathPrefix + 'lib/db';
        return `const { getDb, schema } = await import('${path}')`;
      }
    );

    writeFileSync(file, content);
    console.log(`✓ ${file}`);
  } catch (err) {
    console.error(`✗ ${file}:`, err.message);
  }
});
