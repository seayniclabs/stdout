/**
 * Initialize Riggins Agent for Existing Deployments
 *
 * This script creates the agent_config entry for existing StdOut installations
 * that were deployed before the Observatory auto-initialization fix.
 *
 * Usage:
 *   tsx scripts/init-riggins-agent.ts
 *
 * What it does:
 * 1. Checks if agent_config entry exists for the first user
 * 2. If not, creates a default Riggins config pointing to Ollama
 * 3. Verifies Ollama is accessible
 * 4. Reports status
 */

import { getDb } from '../src/lib/db';
import { sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

async function initRigginsAgent() {
  const db = getDb();

  console.log('🔍 Checking for existing Riggins configuration...\n');

  // Get first user
  const user = await db.get(sql`SELECT id, email FROM users LIMIT 1`) as { id: string; email: string } | undefined;

  if (!user) {
    console.error('❌ No users found in database. Cannot initialize agent.');
    console.error('   Run the setup wizard first: http://localhost:8112/setup');
    process.exit(1);
  }

  console.log(`✓ Found user: ${user.email}`);

  // Check if agent_config exists
  const existingConfig = await db.get(sql`
    SELECT id, agent_name, provider, model, enabled
    FROM agent_config
    WHERE user_id = ${user.id}
  `) as any;

  if (existingConfig) {
    console.log('\n✓ Riggins agent already configured:');
    console.log(`  Name: ${existingConfig.agent_name}`);
    console.log(`  Provider: ${existingConfig.provider}`);
    console.log(`  Model: ${existingConfig.model}`);
    console.log(`  Enabled: ${existingConfig.enabled ? 'Yes' : 'No'}`);
    console.log('\nNo action needed.');
    return;
  }

  console.log('\n⚙️  Creating Riggins agent configuration...');

  // Check if Ollama is available
  const ollamaUrl = process.env.OLLAMA_URL || 'http://172.17.0.1:11434';
  let ollamaAvailable = false;

  try {
    const response = await fetch(`${ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json();
      ollamaAvailable = data.models && data.models.length > 0;

      if (ollamaAvailable) {
        console.log(`✓ Ollama is accessible at ${ollamaUrl}`);
        console.log(`  Found ${data.models.length} models:`);
        data.models.forEach((model: any) => {
          console.log(`    - ${model.name}`);
        });
      }
    }
  } catch (error) {
    console.warn(`⚠️  Ollama not accessible at ${ollamaUrl}`);
    console.warn(`   Agent will still be created but may not work until Ollama is running.`);
  }

  // Create agent_config
  const agentId = nanoid();
  const now = Date.now();

  await db.run(sql`
    INSERT INTO agent_config (
      id, user_id, agent_name, provider, endpoint, model,
      enabled, proactive_notifications, created_at, updated_at
    ) VALUES (
      ${agentId},
      ${user.id},
      'Riggins',
      'ollama',
      ${ollamaUrl},
      'qwen2.5:14b-instruct-q4_K_M',
      1,
      0,
      ${now},
      ${now}
    )
  `);

  console.log('\n✅ Riggins agent initialized successfully!');
  console.log('\nConfiguration:');
  console.log('  Name: Riggins');
  console.log('  Provider: Ollama (local, free)');
  console.log(`  Endpoint: ${ollamaUrl}`);
  console.log('  Model: qwen2.5:14b-instruct-q4_K_M');
  console.log('  Enabled: Yes');
  console.log('\n📝 Next steps:');
  console.log('  1. Open StdOut in your browser');
  console.log('  2. Click the floating agent button (bottom-right)');
  console.log('  3. Ask Riggins: "What can you help me with?"');
  console.log('\nRiggins is ready to use! 🎉');
}

// Run
initRigginsAgent()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Failed to initialize Riggins:', error);
    process.exit(1);
  });
