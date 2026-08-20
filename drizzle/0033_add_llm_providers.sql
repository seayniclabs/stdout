-- Migration: Add LLM provider and model management tables
-- Created: 2026-08-20
-- Purpose: Enable multi-provider LLM routing for Riggins operations

-->statement-breakpoint
CREATE TABLE IF NOT EXISTS llm_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL CHECK(provider_type IN ('nvidia', 'ollama', 'openai', 'anthropic', 'custom')),
  base_url TEXT,
  api_key_encrypted TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  config TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-->statement-breakpoint
CREATE TABLE IF NOT EXISTS llm_models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES llm_providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  specialty TEXT CHECK(specialty IN ('code', 'general', 'embedding', 'vision')),
  context_window INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  config TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(provider_id, model_id)
);

-->statement-breakpoint
CREATE TABLE IF NOT EXISTS llm_task_routing (
  id TEXT PRIMARY KEY,
  task_type TEXT NOT NULL UNIQUE,
  preferred_model_id TEXT REFERENCES llm_models(id),
  fallback_model_ids TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-->statement-breakpoint
-- Seed NVIDIA NIM provider (free tier)
INSERT INTO llm_providers (id, name, provider_type, base_url, enabled, priority, config, created_at, updated_at)
VALUES (
  'nvidia-nim',
  'NVIDIA NIM',
  'nvidia',
  'https://integrate.api.nvidia.com/v1',
  1,
  10,
  '{"tier":"free","rate_limit":null}',
  unixepoch() * 1000,
  unixepoch() * 1000
);

-->statement-breakpoint
-- Seed NVIDIA NIM models
INSERT INTO llm_models (id, provider_id, model_id, display_name, specialty, context_window, enabled, priority, config, created_at, updated_at)
VALUES
  -- Qwen3 Coder 480B (primary code model)
  (
    'qwen3-coder-480b',
    'nvidia-nim',
    'qwen/qwen3-coder-480b-a35b-instruct',
    'Qwen3 Coder 480B',
    'code',
    32000,
    1,
    10,
    '{"use_for":["log_analysis","network_discovery","config_parsing","script_generation"]}',
    unixepoch() * 1000,
    unixepoch() * 1000
  ),
  -- DeepSeek Coder 33B (debugging/fast fallback)
  (
    'deepseek-coder-33b',
    'nvidia-nim',
    'deepseek-ai/deepseek-coder-33b-instruct',
    'DeepSeek Coder 33B',
    'code',
    16000,
    1,
    20,
    '{"use_for":["incident_diagnosis","debugging","quick_scripts"]}',
    unixepoch() * 1000,
    unixepoch() * 1000
  ),
  -- Nemotron 49B (large context)
  (
    'nemotron-49b',
    'nvidia-nim',
    'nvidia/llama-3.3-nemotron-super-49b-v1',
    'Nemotron 49B',
    'general',
    128000,
    1,
    30,
    '{"use_for":["large_topology","cross_system_correlation"]}',
    unixepoch() * 1000,
    unixepoch() * 1000
  );

-->statement-breakpoint
-- Seed local Ollama provider (auto-discovered, disabled by default)
INSERT INTO llm_providers (id, name, provider_type, base_url, enabled, priority, config, created_at, updated_at)
VALUES (
  'ollama-local',
  'Ollama (Local)',
  'ollama',
  'http://localhost:11434',
  1,
  50,
  '{"local":true}',
  unixepoch() * 1000,
  unixepoch() * 1000
);

-->statement-breakpoint
-- Seed existing Ollama models (from ThinkPad)
INSERT INTO llm_models (id, provider_id, model_id, display_name, specialty, context_window, enabled, priority, config, created_at, updated_at)
VALUES
  -- qwen2.5:14b (used by StdOut sanitization)
  (
    'ollama-qwen25-14b',
    'ollama-local',
    'qwen2.5:14b-instruct-q4_K_M',
    'Qwen 2.5 14B (Local)',
    'code',
    4096,
    1,
    100,
    '{"use_for":["sanitization"],"note":"Used by StdOut document sanitization"}',
    unixepoch() * 1000,
    unixepoch() * 1000
  ),
  -- nomic-embed-text (used by StdOut + open-notebook)
  (
    'ollama-nomic-embed',
    'ollama-local',
    'nomic-embed-text:latest',
    'Nomic Embed Text (Local)',
    'embedding',
    2048,
    1,
    100,
    '{"use_for":["embeddings"],"note":"Used by StdOut and open-notebook"}',
    unixepoch() * 1000,
    unixepoch() * 1000
  );

-->statement-breakpoint
-- Seed default task routing
INSERT INTO llm_task_routing (id, task_type, preferred_model_id, fallback_model_ids, enabled, created_at, updated_at)
VALUES
  ('log-analysis', 'log_analysis', 'qwen3-coder-480b', '["deepseek-coder-33b"]', 1, unixepoch() * 1000, unixepoch() * 1000),
  ('network-discovery', 'network_discovery', 'qwen3-coder-480b', '["nemotron-49b"]', 1, unixepoch() * 1000, unixepoch() * 1000),
  ('incident-diagnosis', 'incident_diagnosis', 'deepseek-coder-33b', '["qwen3-coder-480b"]', 1, unixepoch() * 1000, unixepoch() * 1000),
  ('script-generation', 'script_generation', 'qwen3-coder-480b', '["deepseek-coder-33b"]', 1, unixepoch() * 1000, unixepoch() * 1000),
  ('config-parsing', 'config_parsing', 'qwen3-coder-480b', NULL, 1, unixepoch() * 1000, unixepoch() * 1000),
  ('sanitization', 'sanitization', 'ollama-qwen25-14b', NULL, 1, unixepoch() * 1000, unixepoch() * 1000);
