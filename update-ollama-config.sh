#!/bin/bash
# Update StdOut container to use local Ollama for AI diagnosis
# Run this on the ThinkPad at 192.168.0.244

set -e

echo "Stopping stdout container..."
docker stop stdout

echo "Updating docker-compose.yml with Ollama configuration..."
cd ~/stdout  # Adjust path as needed

# Backup existing docker-compose.yml
cp docker-compose.yml docker-compose.yml.backup.$(date +%Y%m%d_%H%M%S)

# Add OLLAMA_URL to stdout service environment if not already present
if ! grep -q "OLLAMA_URL" docker-compose.yml; then
  # Find the environment section for stdout service and add OLLAMA_URL
  sed -i '/stdout:/,/networks:/{
    /environment:/,/secrets:/{
      /SENTINEL_API_URL/a\      - OLLAMA_URL=http://192.168.0.244:11434\n      - OBSERVATORY_ANALYST_MODEL=qwen2.5:14b-instruct-q4_K_M\n      - OBSERVATORY_WATCHER_MODEL=llama3.2:3b-instruct-q4_K_M
    }
  }' docker-compose.yml

  echo "Added Ollama configuration to docker-compose.yml"
else
  echo "Ollama configuration already present in docker-compose.yml"
fi

echo "Starting stdout container with new configuration..."
docker compose up -d stdout

echo "Waiting for container to be healthy..."
sleep 10

echo "Checking container status..."
docker ps | grep stdout

echo ""
echo "Update complete! StdOut should now use local Ollama for AI diagnosis."
echo "Test by visiting: http://192.168.0.244:8112/app/incidents/Zn9byXM1yRbKkwWKY8KUS"
