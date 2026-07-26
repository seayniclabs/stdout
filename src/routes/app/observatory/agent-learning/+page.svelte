<script lang="ts">
  import { onMount } from 'svelte';

  let settings = {
    docs_rag_enabled: true,
    incident_learning_enabled: true,
    community_kb_enabled: true,
    community_sharing_enabled: false,
    custom_notebook_id: '',
    proactive_suggestions: false
  };

  let capabilities = {
    nlm_available: false,
    ollama_available: false,
    embedding_model_available: false
  };

  let saving = false;
  let checking = false;

  onMount(async () => {
    await loadSettings();
    await checkCapabilities();
  });

  async function loadSettings() {
    try {
      const res = await fetch('/app/api/observatory/agent-learning/settings');
      if (res.ok) {
        const data = await res.json();
        settings = { ...settings, ...data.settings };
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  async function checkCapabilities() {
    checking = true;
    try {
      const res = await fetch('/app/api/observatory/agent-learning/capabilities');
      if (res.ok) {
        const data = await res.json();
        capabilities = data;
      }
    } catch (error) {
      console.error('Failed to check capabilities:', error);
    } finally {
      checking = false;
    }
  }

  async function saveSettings() {
    saving = true;
    try {
      const res = await fetch('/app/api/observatory/agent-learning/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });

      if (res.ok) {
        alert('Settings saved successfully!');
      } else {
        alert('Failed to save settings');
      }
    } catch (error) {
      console.error('Save failed:', error);
      alert('Failed to save settings');
    } finally {
      saving = false;
    }
  }
</script>

<div class="agent-learning-settings">
  <header>
    <h1>Agent Learning & RAG</h1>
    <p>Configure how Riggins learns from documentation, incident history, and community knowledge.</p>
  </header>

  <div class="capabilities-status">
    <h2>System Capabilities {#if checking}(Checking...){/if}</h2>
    <div class="capability-grid">
      <div class="capability" class:available={capabilities.nlm_available}>
        <span class="icon">{capabilities.nlm_available ? '✓' : '✗'}</span>
        <div>
          <strong>NotebookLM (nlm CLI)</strong>
          <p>{capabilities.nlm_available ? 'Available - Docs RAG enabled' : 'Not installed or not authenticated'}</p>
        </div>
      </div>
      <div class="capability" class:available={capabilities.ollama_available}>
        <span class="icon">{capabilities.ollama_available ? '✓' : '✗'}</span>
        <div>
          <strong>Ollama</strong>
          <p>{capabilities.ollama_available ? 'Running - Embeddings available' : 'Not running or not reachable'}</p>
        </div>
      </div>
      <div class="capability" class:available={capabilities.embedding_model_available}>
        <span class="icon">{capabilities.embedding_model_available ? '✓' : '✗'}</span>
        <div>
          <strong>Embedding Model (nomic-embed-text)</strong>
          <p>{capabilities.embedding_model_available ? 'Installed - Incident learning ready' : 'Not installed (run: ollama pull nomic-embed-text)'}</p>
        </div>
      </div>
    </div>
  </div>

  <div class="settings-section">
    <h2>Documentation Search (NotebookLM)</h2>
    <p>Allow Riggins to search StdOut documentation, runbooks, and troubleshooting guides.</p>

    <label>
      <input type="checkbox" bind:checked={settings.docs_rag_enabled} disabled={!capabilities.nlm_available} />
      Enable Documentation Search
    </label>

    {#if !capabilities.nlm_available}
      <div class="warning">
        NotebookLM CLI not available. Install with: <code>pipx install notebooklm-mcp-cli</code> then run <code>nlm login</code>
      </div>
    {/if}

    <div class="input-group">
      <label for="notebook-id">Custom Notebook ID (optional)</label>
      <input
        type="text"
        id="notebook-id"
        bind:value={settings.custom_notebook_id}
        placeholder="Leave empty to use default stdout-docs"
        disabled={!settings.docs_rag_enabled}
      />
      <small>Use your own NotebookLM notebook instead of the default</small>
    </div>
  </div>

  <div class="settings-section">
    <h2>Incident History Learning</h2>
    <p>Allow Riggins to learn from past incidents using embeddings for similarity search.</p>

    <label>
      <input type="checkbox" bind:checked={settings.incident_learning_enabled} disabled={!capabilities.embedding_model_available} />
      Enable Incident Learning
    </label>

    {#if !capabilities.embedding_model_available}
      <div class="warning">
        Embedding model not available. Install with: <code>ollama pull nomic-embed-text</code>
      </div>
    {/if}

    <div class="info">
      <strong>How it works:</strong> Resolved incidents are embedded using Ollama (local inference). When Riggins sees a new problem, it searches past incidents for similar issues and suggests solutions that worked before.
    </div>
  </div>

  <div class="settings-section">
    <h2>Community Knowledge Base</h2>
    <p>Allow Riggins to reference curated patterns for common infrastructure problems.</p>

    <label>
      <input type="checkbox" bind:checked={settings.community_kb_enabled} />
      Enable Community Knowledge
    </label>

    <div class="info">
      <strong>What's included:</strong> 50+ curated patterns covering Docker, databases, networking, performance, security, and more. All work offline.
    </div>
  </div>

  <div class="settings-section">
    <h2>Community Sharing (Opt-In)</h2>
    <p>Contribute anonymized incident patterns to help the StdOut community.</p>

    <label>
      <input type="checkbox" bind:checked={settings.community_sharing_enabled} />
      Enable Community Sharing
    </label>

    <div class="info">
      <strong>Privacy:</strong> Only resolved incidents you manually approve are shared. All data is anonymized (no IPs, hostnames, or identifying info). You can review shared patterns before submission.
    </div>
  </div>

  <div class="settings-section">
    <h2>Agent Behavior</h2>

    <label>
      <input type="checkbox" bind:checked={settings.proactive_suggestions} />
      Enable Proactive Suggestions
    </label>

    <div class="info">
      When enabled, Riggins will proactively suggest solutions when detecting anomalies, not just respond to questions.
    </div>
  </div>

  <div class="actions">
    <button on:click={saveSettings} disabled={saving}>
      {saving ? 'Saving...' : 'Save Settings'}
    </button>
    <button on:click={checkCapabilities} class="secondary" disabled={checking}>
      {checking ? 'Checking...' : 'Recheck Capabilities'}
    </button>
  </div>
</div>

<style>
  .agent-learning-settings {
    max-width: 800px;
    margin: 2rem auto;
    padding: 0 1rem;
  }

  header {
    margin-bottom: 2rem;
  }

  h1 {
    font-size: 1.75rem;
    margin-bottom: 0.5rem;
  }

  h2 {
    font-size: 1.25rem;
    margin-bottom: 1rem;
  }

  .capabilities-status {
    background: var(--surface-2);
    border-radius: 8px;
    padding: 1.5rem;
    margin-bottom: 2rem;
  }

  .capability-grid {
    display: grid;
    gap: 1rem;
  }

  .capability {
    display: flex;
    align-items: start;
    gap: 1rem;
    padding: 1rem;
    background: var(--surface-1);
    border-radius: 6px;
    border-left: 3px solid var(--red);
  }

  .capability.available {
    border-left-color: var(--green);
  }

  .capability .icon {
    font-size: 1.5rem;
    font-weight: bold;
  }

  .capability.available .icon {
    color: var(--green);
  }

  .capability strong {
    display: block;
    margin-bottom: 0.25rem;
  }

  .capability p {
    font-size: 0.875rem;
    color: var(--text-2);
    margin: 0;
  }

  .settings-section {
    background: var(--surface-2);
    border-radius: 8px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }

  .settings-section > p {
    color: var(--text-2);
    margin-bottom: 1rem;
  }

  label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
    cursor: pointer;
  }

  input[type="checkbox"] {
    width: 18px;
    height: 18px;
  }

  .input-group {
    margin-top: 1rem;
  }

  .input-group label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 500;
  }

  .input-group input[type="text"] {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface-1);
    font-family: monospace;
  }

  .input-group small {
    display: block;
    margin-top: 0.25rem;
    color: var(--text-3);
    font-size: 0.875rem;
  }

  .warning {
    background: var(--yellow-bg);
    border: 1px solid var(--yellow);
    border-radius: 4px;
    padding: 1rem;
    margin-top: 1rem;
  }

  .warning code {
    background: rgba(0,0,0,0.1);
    padding: 0.125rem 0.25rem;
    border-radius: 3px;
  }

  .info {
    background: var(--blue-bg);
    border: 1px solid var(--blue);
    border-radius: 4px;
    padding: 1rem;
    margin-top: 1rem;
  }

  .info strong {
    display: block;
    margin-bottom: 0.5rem;
  }

  .actions {
    display: flex;
    gap: 1rem;
    margin-top: 2rem;
  }

  button {
    padding: 0.75rem 1.5rem;
    border-radius: 6px;
    border: none;
    font-weight: 500;
    cursor: pointer;
    background: var(--primary);
    color: white;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  button.secondary {
    background: var(--surface-3);
    color: var(--text-1);
  }
</style>
