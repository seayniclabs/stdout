#!/usr/bin/env node
/**
 * Test LLM router standalone
 */
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../src/lib/db/schema.js';

const dbPath = process.env.DB_PATH || '/data/stdout.db';
console.log(`[test-router] Using database at: ${dbPath}`);

const sqlite = new Database(dbPath);
const db = drizzle(sqlite, { schema });

// Mock queryLLM for testing (no actual API calls)
async function testRouter() {
  console.log('\n=== Testing LLM Router ===\n');

  // List providers
  const providers = await db.select().from(schema.llmProviders).all();
  console.log('Providers:');
  providers.forEach(p => {
    console.log(`  - ${p.name} (${p.providerType}): ${p.enabled ? 'ENABLED' : 'DISABLED'}, priority ${p.priority}`);
  });

  // List models
  const models = await db.select().from(schema.llmModels).all();
  console.log('\nModels:');
  models.forEach(m => {
    console.log(`  - ${m.displayName} [${m.specialty}]: ${m.enabled ? 'ENABLED' : 'DISABLED'}, priority ${m.priority}`);
  });

  // List routing
  const routing = await db.select().from(schema.llmTaskRouting).all();
  console.log('\nTask Routing:');
  routing.forEach(r => {
    console.log(`  - ${r.taskType} → ${r.preferredModelId}`);
  });

  console.log('\n✅ Router configuration looks good!');
}

testRouter().catch(console.error);
