/**
 * API Catalog Generator for StdOut
 * Scans src/pages/app/api/ and builds complete endpoint inventory
 * Output: tests/api/api-catalog.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Endpoint {
  path: string;
  methods: string[];
  requiresAuth: boolean;
  rateLimit?: string;
  category: string;
  description?: string;
}

const catalog: Endpoint[] = [];

function scanDirectory(dir: string, baseRoute: string = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      scanDirectory(fullPath, `${baseRoute}/${entry.name}`);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.astro')) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const filename = entry.name.replace(/\.(ts|astro)$/, '');
      
      // Extract HTTP methods from file content (Astro APIRoute pattern)
      const methods: string[] = [];
      if (content.match(/export const GET\s*:/)) methods.push('GET');
      if (content.match(/export const POST\s*:/)) methods.push('POST');
      if (content.match(/export const PUT\s*:/)) methods.push('PUT');
      if (content.match(/export const DELETE\s*:/)) methods.push('DELETE');
      if (content.match(/export const PATCH\s*:/)) methods.push('PATCH');
      
      // Determine auth requirement
      const requiresAuth = content.includes('requireAuth') || 
                          content.includes('authMiddleware') ||
                          content.includes('getSessionUser');
      
      // Extract rate limit if present
      let rateLimit: string | undefined;
      const rateLimitMatch = content.match(/rateLimit\(['"](\d+)\s*\/\s*(\d+)\s*(min|hour)['"]\)/);
      if (rateLimitMatch) {
        rateLimit = `${rateLimitMatch[1]}/${rateLimitMatch[2]}${rateLimitMatch[3]}`;
      }
      
      // Categorize by path
      let category = 'uncategorized';
      if (baseRoute.includes('/monitors')) category = 'monitors';
      else if (baseRoute.includes('/incidents')) category = 'incidents';
      else if (baseRoute.includes('/docs')) category = 'docs';
      else if (baseRoute.includes('/setup')) category = 'setup';
      else if (baseRoute.includes('/admin')) category = 'admin';
      else if (baseRoute.includes('/backup')) category = 'backup';
      else if (baseRoute.includes('/integrations')) category = 'integrations';
      else if (baseRoute.includes('/dashboard')) category = 'dashboard';
      else if (baseRoute.includes('/users')) category = 'users';
      else if (baseRoute.includes('/registry')) category = 'registry';
      else if (baseRoute.includes('/settings')) category = 'settings';
      
      const routePath = `${baseRoute}/${filename}`.replace(/\/index$/, '');
      
      catalog.push({
        path: routePath || '/',
        methods,
        requiresAuth,
        rateLimit,
        category
      });
    }
  }
}

const apiRoot = path.resolve(__dirname, '../../src/pages/app/api');
scanDirectory(apiRoot, '/app/api');

// Sort by category then path
catalog.sort((a, b) => {
  if (a.category !== b.category) return a.category.localeCompare(b.category);
  return a.path.localeCompare(b.path);
});

// Write catalog
const outputPath = path.join(__dirname, 'api-catalog.json');
fs.writeFileSync(outputPath, JSON.stringify(catalog, null, 2));

console.log(`✅ Generated catalog with ${catalog.length} endpoints`);
console.log(`📁 Output: ${outputPath}`);
console.log(`\nBreakdown by category:`);
const counts = catalog.reduce((acc, ep) => {
  acc[ep.category] = (acc[ep.category] || 0) + 1;
  return acc;
}, {} as Record<string, number>);
Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
  console.log(`  ${cat}: ${count}`);
});
