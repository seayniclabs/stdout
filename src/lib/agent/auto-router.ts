/**
 * Observatory Agent Auto-Router
 *
 * Automatically routes to available AI providers without configuration.
 * Tries providers in cost-effective order:
 * 1. Ollama (free, local) - qwen2.5:14b
 * 2. Claude CLI (subscription, already paid)
 * 3. Gemini CLI (subscription, already paid)
 * 4. Graceful failure message
 *
 * NO user configuration needed - just like Observatory itself.
 */

export interface AgentResponse {
  content: string;
  provider: string;
  model: string;
  degraded: boolean;
}

/**
 * Auto-route a prompt to the best available AI provider.
 * Tries Ollama first (free), falls back to subscription models, then fails gracefully.
 */
export async function autoRoute(prompt: string, context?: string): Promise<AgentResponse> {
  // Try Ollama first (free, local)
  const ollamaResult = await tryOllama(prompt, context);
  if (ollamaResult) return ollamaResult;

  // Fallback to Claude CLI (subscription)
  const claudeResult = await tryClaudeCLI(prompt, context);
  if (claudeResult) return claudeResult;

  // Fallback to Gemini CLI (subscription)
  const geminiResult = await tryGeminiCLI(prompt, context);
  if (geminiResult) return geminiResult;

  // All providers unavailable
  return {
    content: `⚠️ Observatory Agent is temporarily unavailable. No AI providers are accessible right now.\n\nYou can still use Observatory directly via the dashboard.`,
    provider: 'none',
    model: 'none',
    degraded: true,
  };
}

/**
 * Try Ollama (free, local)
 */
async function tryOllama(prompt: string, context?: string): Promise<AgentResponse | null> {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  const model = 'qwen2.5:14b'; // Same as Observatory Analyst

  try {
    const fullPrompt = context ? `${context}\n\n${prompt}` : prompt;

    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: fullPrompt,
        stream: false,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.warn('[agent-auto-router] Ollama returned', response.status);
      return null;
    }

    const data = await response.json();

    return {
      content: data.response,
      provider: 'ollama',
      model,
      degraded: false,
    };
  } catch (error) {
    console.warn('[agent-auto-router] Ollama failed:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Try Claude CLI (subscription)
 */
async function tryClaudeCLI(prompt: string, context?: string): Promise<AgentResponse | null> {
  try {
    const { spawn } = await import('child_process');
    const fullPrompt = context ? `${context}\n\n${prompt}` : prompt;

    return new Promise((resolve) => {
      const proc = spawn('claude', ['-p', fullPrompt]);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          console.warn('[agent-auto-router] Claude CLI failed:', stderr);
          resolve(null);
        } else {
          resolve({
            content: stdout.trim(),
            provider: 'claude-cli',
            model: 'sonnet',
            degraded: false,
          });
        }
      });

      // Timeout after 60s
      setTimeout(() => {
        proc.kill();
        console.warn('[agent-auto-router] Claude CLI timeout');
        resolve(null);
      }, 60000);
    });
  } catch (error) {
    console.warn('[agent-auto-router] Claude CLI error:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Try Gemini CLI (subscription)
 */
async function tryGeminiCLI(prompt: string, context?: string): Promise<AgentResponse | null> {
  try {
    const { spawn } = await import('child_process');
    const fullPrompt = context ? `${context}\n\n${prompt}` : prompt;

    return new Promise((resolve) => {
      const proc = spawn('agy', ['-p', fullPrompt]);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          console.warn('[agent-auto-router] Gemini CLI failed:', stderr);
          resolve(null);
        } else {
          resolve({
            content: stdout.trim(),
            provider: 'gemini-cli',
            model: 'gemini-2.0-flash',
            degraded: false,
          });
        }
      });

      // Timeout after 60s
      setTimeout(() => {
        proc.kill();
        console.warn('[agent-auto-router] Gemini CLI timeout');
        resolve(null);
      }, 60000);
    });
  } catch (error) {
    console.warn('[agent-auto-router] Gemini CLI error:', error instanceof Error ? error.message : String(error));
    return null;
  }
}
