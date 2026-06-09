#!/bin/bash
# Wipe StdOut deployment on ThinkPad - removes all data and volumes

set -e

echo "Wiping StdOut deployment on ThinkPad (192.168.0.244)..."

# Note: SSH key authentication required
ssh charlieseay@192.168.0.244 'bash -s' << 'ENDSSH'
  cd ~/stdout
  echo "Stopping containers..."
  sudo docker compose down -v
  echo "Removing data directory..."
  sudo rm -rf data/*
  echo "Starting fresh containers..."
  sudo docker compose up -d
  echo "Waiting 5 seconds for startup..."
  sleep 5
  echo "Deployment wiped and restarted"
ENDSSH

echo "✓ ThinkPad deployment ready for fresh test"
