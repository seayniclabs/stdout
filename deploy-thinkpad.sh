#!/bin/bash
# StdOut ThinkPad Deployment Script
# Deploys latest stdout image to ThinkPad (192.168.68.89)

set -e

THINKPAD_HOST="charlie@192.168.68.89"
IMAGE="charlieseay/stdout:latest"
COMMIT_SHA=$(git rev-parse --short HEAD)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  StdOut ThinkPad Deployment"
echo "  Commit: $COMMIT_SHA"
echo "  Image: $IMAGE"
echo "  Target: $THINKPAD_HOST"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Step 1: Push to Docker Hub
echo "📤 Pushing image to Docker Hub..."
docker push $IMAGE
# Tag and push commit-specific image for rollback capability
docker tag $IMAGE charlieseay/stdout:$COMMIT_SHA
docker push charlieseay/stdout:$COMMIT_SHA || echo "⚠️ Failed to push commit tag (non-fatal)"
echo "✅ Image pushed"
echo ""

# Step 2: Pull on ThinkPad
echo "⬇️  Pulling image on ThinkPad..."
ssh $THINKPAD_HOST "docker pull $IMAGE"
echo "✅ Image pulled"
echo ""

# Step 3: Stop container
echo "⏸️  Stopping stdout container..."
ssh $THINKPAD_HOST "docker stop stdout || true"
echo "✅ Container stopped"
echo ""

# Step 4: Remove old container
echo "🗑️  Removing old container..."
ssh $THINKPAD_HOST "docker rm stdout || true"
echo "✅ Container removed"
echo ""

# Step 5: Start new container
echo "🚀 Starting new container..."
ssh $THINKPAD_HOST "cd /home/charlie/stdout && docker compose up -d stdout"
echo "✅ Container started"
echo ""

# Step 6: Wait for health check
echo "🏥 Waiting for health check..."
sleep 10
for i in {1..12}; do
  if ssh $THINKPAD_HOST "docker inspect stdout --format '{{.State.Health.Status}}'" 2>/dev/null | grep -q "healthy"; then
    echo "✅ Container is healthy!"
    break
  fi
  echo "   Attempt $i/12 - waiting..."
  sleep 5
done
echo ""

# Step 7: Show logs
echo "📋 Recent logs:"
ssh $THINKPAD_HOST "docker logs stdout --tail 50"
echo ""

# Step 8: Verify workers
echo "🔍 Checking for worker startup..."
ssh $THINKPAD_HOST "docker logs stdout 2>&1 | grep -E '(passive-discovery-worker|housekeeping-worker|storage-monitor-worker)'"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Deployment Complete!"
echo "  URL: http://192.168.68.89:8112"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
