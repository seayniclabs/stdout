/**
 * Observatory Automated Setup
 *
 * Handles automatic installation and configuration of Observatory components:
 * - Ollama installation (if not present)
 * - Model downloads (Llama 3.2 3B, Qwen 2.5 14B)
 * - Health checks and verification
 *
 * Runs during initialization, fully automated, no manual steps required.
 */

import { isOllamaAvailable, checkRequiredModels, pullModel, listOllamaModels } from './ollama';
import { AGENT_PERSONAS } from './agents';

export interface SetupResult {
  success: boolean;
  ollamaInstalled: boolean;
  watcherModelReady: boolean;
  analystModelReady: boolean;
  errors: string[];
  warnings: string[];
  setupLog: string[];
}

/**
 * Run automated Observatory setup
 *
 * Checks for Ollama + required models, installs/downloads if missing
 */
export async function setupObservatory(): Promise<SetupResult> {
  const log: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  log.push('🔧 Observatory Automated Setup');
  log.push('');

  // Step 1: Check if Ollama is installed and running
  log.push('[1/3] Checking Ollama installation...');
  const ollamaReady = await isOllamaAvailable();

  if (!ollamaReady) {
    log.push('  ✗ Ollama not detected');
    warnings.push('Ollama not running - Observatory will use rule-based detection');
    warnings.push('To enable AI agents: Install Ollama from https://ollama.ai');

    return {
      success: true, // Not fatal - we have fallback
      ollamaInstalled: false,
      watcherModelReady: false,
      analystModelReady: false,
      errors,
      warnings,
      setupLog: log
    };
  }

  log.push('  ✓ Ollama is running');

  // Step 2: Check required models
  log.push('[2/3] Checking required models...');
  const modelStatus = await checkRequiredModels();

  log.push(`  Available models: ${modelStatus.available.length > 0 ? modelStatus.available.join(', ') : 'none'}`);

  const watcherModel = AGENT_PERSONAS.watcher.model;
  const analystModel = AGENT_PERSONAS.analyst.model;

  // Step 3: Pull missing models
  log.push('[3/3] Ensuring models are available...');

  let watcherReady = modelStatus.watcher;
  let analystReady = modelStatus.analyst;

  // Auto-pull Watcher model if missing
  if (!watcherReady) {
    log.push(`  ⬇ Pulling ${watcherModel}... (this may take a few minutes)`);
    try {
      await pullModel(watcherModel);
      log.push(`  ✓ ${watcherModel} ready`);
      watcherReady = true;
    } catch (error: unknown) {
      errors.push(`Failed to pull ${watcherModel}: ${error instanceof Error ? error.message : String(error)}`);
      log.push(`  ✗ Failed to pull ${watcherModel}`);
      warnings.push(`Watcher agent will use rule-based detection until ${watcherModel} is available`);
    }
  } else {
    log.push(`  ✓ ${watcherModel} already installed`);
  }

  // Auto-pull Analyst model if missing (but don't block startup)
  if (!analystReady) {
    log.push(`  ⬇ Pulling ${analystModel}... (large model, may take 10+ minutes)`);
    log.push(`     Continuing in background - Analyst will be ready shortly`);

    // Pull in background, don't await
    pullModel(analystModel)
      .then(() => {
        console.log(`[Observatory Setup] ✓ ${analystModel} ready`);
      })
      .catch((error) => {
        console.error(`[Observatory Setup] Failed to pull ${analystModel}:`, error);
      });

    warnings.push(`Analyst agent pending: ${analystModel} downloading in background`);
  } else {
    log.push(`  ✓ ${analystModel} already installed`);
  }

  log.push('');
  log.push('✅ Observatory setup complete');

  if (warnings.length > 0) {
    log.push('');
    log.push('⚠️ Warnings:');
    warnings.forEach(w => log.push(`  - ${w}`));
  }

  return {
    success: errors.length === 0,
    ollamaInstalled: true,
    watcherModelReady: watcherReady,
    analystModelReady: analystReady,
    errors,
    warnings,
    setupLog: log
  };
}

/**
 * Install Ollama via system package manager
 *
 * Detects OS and uses appropriate installation method
 */
export async function installOllama(): Promise<{ success: boolean; method: string; output: string }> {
  const platform = process.platform;

  if (platform === 'linux') {
    // Try Docker first (most reliable for self-hosted environments)
    try {
      const { execFileSync } = await import('child_process');

      // Check if Docker is available
      try {
        execFileSync('which', ['docker'], { encoding: 'utf-8' });
      } catch {
        throw new Error('Docker not found');
      }

      // Pull and run Ollama in Docker
      const output = execFileSync('docker', [
        'run',
        '-d',
        '--name', 'ollama',
        '-v', 'ollama:/root/.ollama',
        '-p', '11434:11434',
        'ollama/ollama'
      ], { encoding: 'utf-8' });

      return {
        success: true,
        method: 'docker',
        output
      };
    } catch (dockerError) {
      // Docker not available, try install script via sh
      try {
        const { execFileSync } = await import('child_process');

        // Download install script first
        const script = execFileSync('curl', [
          '-fsSL',
          'https://ollama.ai/install.sh'
        ], { encoding: 'utf-8' });

        // Execute via sh (no user input, static script URL)
        const output = execFileSync('sh', ['-c', script], {
          encoding: 'utf-8',
          timeout: 300000 // 5 min timeout
        });

        return {
          success: true,
          method: 'install.sh',
          output
        };
      } catch (installError: unknown) {
        return {
          success: false,
          method: 'linux',
          output: `Failed to install Ollama: ${installError.message}`
        };
      }
    }
  } else if (platform === 'darwin') {
    // macOS - user needs to download .app manually
    return {
      success: false,
      method: 'manual',
      output: 'macOS: Download Ollama.app from https://ollama.ai/download/mac'
    };
  } else {
    return {
      success: false,
      method: 'unsupported',
      output: `Unsupported platform: ${platform}`
    };
  }
}

/**
 * Get setup status for UI display
 */
export async function getSetupStatus(): Promise<{
  ollama: 'ready' | 'not_installed' | 'not_running';
  watcher: 'ready' | 'downloading' | 'missing';
  analyst: 'ready' | 'downloading' | 'missing';
  canAutoFix: boolean;
}> {
  const ollamaReady = await isOllamaAvailable();

  if (!ollamaReady) {
    return {
      ollama: 'not_running',
      watcher: 'missing',
      analyst: 'missing',
      canAutoFix: process.platform === 'linux' // Can auto-install on Linux
    };
  }

  const models = await checkRequiredModels();

  return {
    ollama: 'ready',
    watcher: models.watcher ? 'ready' : 'missing',
    analyst: models.analyst ? 'ready' : 'missing',
    canAutoFix: true // Can pull models if Ollama is running
  };
}
