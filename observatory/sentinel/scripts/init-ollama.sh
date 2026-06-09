#!/bin/bash
# Observatory Sentinel - Ollama Auto-Installation Script
# Runs before main.py starts to ensure Ollama and models are available

set -e

echo "[init-ollama] Starting Ollama initialization..."

OLLAMA_HOST="${OLLAMA_HOST:-http://host.docker.internal:11434}"
WATCHER_MODEL="${WATCHER_MODEL:-llama3.2:3b-instruct-q4_K_M}"
ANALYST_MODEL="${ANALYST_MODEL:-qwen2.5:14b-instruct-q4_K_M}"
STATUS_FILE="/tmp/observatory-init-status.json"

# Initialize status file
cat > "$STATUS_FILE" <<EOF
{
  "stage": "checking_ollama",
  "ollama_available": false,
  "ollama_installed": false,
  "models_ready": false,
  "watcher_model_ready": false,
  "analyst_model_ready": false,
  "watcher_model_progress": 0,
  "analyst_model_progress": 0,
  "error": null,
  "started_at": "$(date -Iseconds)",
  "updated_at": "$(date -Iseconds)"
}
EOF

update_status() {
  local key="$1"
  local value="$2"
  python3 -c "import json; d=json.load(open('$STATUS_FILE')); d['$key']=$value; d['updated_at']='$(date -Iseconds)'; json.dump(d, open('$STATUS_FILE', 'w'), indent=2)"
}

update_status_str() {
  local key="$1"
  local value="$2"
  python3 -c "import json; d=json.load(open('$STATUS_FILE')); d['$key']='$value'; d['updated_at']='$(date -Iseconds)'; json.dump(d, open('$STATUS_FILE', 'w'), indent=2)"
}

# Step 1: Check if Ollama is reachable
echo "[init-ollama] Checking Ollama at $OLLAMA_HOST..."

if curl -sf "$OLLAMA_HOST/api/tags" > /dev/null 2>&1; then
  echo "[init-ollama] ✓ Ollama is already running"
  update_status "ollama_available" "true"
  update_status "ollama_installed" "true"
else
  echo "[init-ollama] ✗ Ollama not reachable at $OLLAMA_HOST"
  update_status "ollama_available" "false"

  # Step 2: Attempt to install Ollama (Linux only)
  if [ "$(uname)" = "Linux" ]; then
    echo "[init-ollama] Attempting to install Ollama on Linux host..."
    update_status_str "stage" "installing_ollama"

    # Try to install Ollama via the official script
    if curl -fsSL https://ollama.com/install.sh | sh; then
      echo "[init-ollama] ✓ Ollama installed successfully"
      update_status "ollama_installed" "true"

      # Start Ollama service
      echo "[init-ollama] Starting Ollama service..."
      systemctl start ollama 2>/dev/null || ollama serve > /tmp/ollama.log 2>&1 &

      # Wait for Ollama to become available
      for i in {1..30}; do
        if curl -sf "$OLLAMA_HOST/api/tags" > /dev/null 2>&1; then
          echo "[init-ollama] ✓ Ollama service started"
          update_status "ollama_available" "true"
          break
        fi
        sleep 2
      done
    else
      echo "[init-ollama] ✗ Failed to install Ollama"
      update_status_str "stage" "error"
      update_status_str "error" "Failed to install Ollama on Linux host"
      exit 1
    fi
  else
    echo "[init-ollama] ✗ Ollama auto-install only supported on Linux"
    echo "[init-ollama] Please install Ollama manually: https://ollama.com/download"
    update_status_str "stage" "error"
    update_status_str "error" "Ollama not available and cannot auto-install on non-Linux platform"
    exit 1
  fi
fi

# Step 3: Check if models are already pulled
echo "[init-ollama] Checking if models are available..."
update_status_str "stage" "checking_models"

MODELS_JSON=$(curl -sf "$OLLAMA_HOST/api/tags" || echo '{"models":[]}')

if echo "$MODELS_JSON" | grep -q "$WATCHER_MODEL"; then
  echo "[init-ollama] ✓ Watcher model ($WATCHER_MODEL) already available"
  update_status "watcher_model_ready" "true"
  update_status "watcher_model_progress" "100"
else
  echo "[init-ollama] Pulling Watcher model ($WATCHER_MODEL)..."
  update_status_str "stage" "pulling_watcher_model"

  # Pull model (this can take 5-10 minutes)
  if ollama pull "$WATCHER_MODEL"; then
    echo "[init-ollama] ✓ Watcher model pulled successfully"
    update_status "watcher_model_ready" "true"
    update_status "watcher_model_progress" "100"
  else
    echo "[init-ollama] ✗ Failed to pull Watcher model"
    update_status_str "error" "Failed to pull Watcher model: $WATCHER_MODEL"
  fi
fi

if echo "$MODELS_JSON" | grep -q "$ANALYST_MODEL"; then
  echo "[init-ollama] ✓ Analyst model ($ANALYST_MODEL) already available"
  update_status "analyst_model_ready" "true"
  update_status "analyst_model_progress" "100"
else
  echo "[init-ollama] Pulling Analyst model ($ANALYST_MODEL)..."
  update_status_str "stage" "pulling_analyst_model"

  # Pull model (this can take 10-20 minutes for 14B model)
  if ollama pull "$ANALYST_MODEL"; then
    echo "[init-ollama] ✓ Analyst model pulled successfully"
    update_status "analyst_model_ready" "true"
    update_status "analyst_model_progress" "100"
  else
    echo "[init-ollama] ✗ Failed to pull Analyst model"
    update_status_str "error" "Failed to pull Analyst model: $ANALYST_MODEL"
  fi
fi

# Check if all models are ready
WATCHER_READY=$(python3 -c "import json; print(json.load(open('$STATUS_FILE'))['watcher_model_ready'])")
ANALYST_READY=$(python3 -c "import json; print(json.load(open('$STATUS_FILE'))['analyst_model_ready'])")

if [ "$WATCHER_READY" = "True" ] && [ "$ANALYST_READY" = "True" ]; then
  echo "[init-ollama] ✓ All models ready"
  update_status "models_ready" "true"
  update_status_str "stage" "complete"
else
  echo "[init-ollama] ✗ Not all models are ready"
  update_status "models_ready" "false"
  update_status_str "stage" "incomplete"
fi

echo "[init-ollama] Initialization complete"
