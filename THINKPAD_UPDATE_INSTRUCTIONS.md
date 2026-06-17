# ThinkPad StdOut Update Instructions

## Issue
AI Diagnosis button returns 500 error because the container is missing the `OLLAMA_URL` environment variable needed to connect to the local Ollama instance.

## Root Cause
The StdOut container's `docker-compose.yml` doesn't include environment variables for Ollama connectivity. The code correctly falls back to Ollama when no BYOK API key is configured, but it needs the OLLAMA_URL to connect.

## Solution
Update the docker-compose.yml on the ThinkPad to add Ollama environment variables.

## Manual Update Steps (Run on ThinkPad)

### Option 1: Pull Updated Config from Git

```bash
cd ~/stdout  # or wherever the stdout repo is located on ThinkPad
git pull origin main
docker compose down
docker compose up -d
```

### Option 2: Manual Edit

If git isn't set up on the ThinkPad, manually edit `docker-compose.yml`:

1. Open `docker-compose.yml` in an editor
2. Find the `stdout` service's `environment` section
3. Add these three lines after `SENTINEL_API_URL`:

```yaml
      - OLLAMA_URL=${OLLAMA_URL:-http://192.168.0.244:11434}
      - OBSERVATORY_ANALYST_MODEL=${OBSERVATORY_ANALYST_MODEL:-qwen2.5:14b-instruct-q4_K_M}
      - OBSERVATORY_WATCHER_MODEL=${OBSERVATORY_WATCHER_MODEL:-llama3.2:3b-instruct-q4_K_M}
```

4. Save the file
5. Restart the container:

```bash
cd ~/stdout
docker compose down
docker compose up -d
```

## Verification

After restarting:

1. Visit: http://192.168.0.244:8112/app/incidents/Zn9byXM1yRbKkwWKY8KUS
2. Click "Get AI Diagnosis"
3. Should now successfully generate diagnosis using local Ollama (qwen2.5:14b model)

## What This Fixes

- **Before**: Diagnosis endpoint returned 500 error (missing Ollama URL)
- **After**: Diagnosis uses local Ollama instance running on ThinkPad at port 11434
- **Security**: No API keys baked into the image (meets user requirement)
- **Models**: Uses qwen2.5:14b (paid tier) and llama3.2:3b (free tier) from local Ollama

## Notes

- Ollama is already running on ThinkPad (verified at http://192.168.0.244:11434/api/tags)
- Both required models are already pulled:
  - qwen2.5:14b-instruct-q4_K_M (8.99 GB)
  - llama3.2:3b-instruct-q4_K_M (2.02 GB)
- The empty `anthropic_api_key` secret file is correct - no external API keys needed
