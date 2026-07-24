#!/bin/bash
# Fills disk with temp file
SIZE_MB=${1:-100}
FILL_FILE="$HOME/Projects/stdout/data/chaos-fill.tmp"
dd if=/dev/zero of="$FILL_FILE" bs=1m count="$SIZE_MB"
echo "Press Enter to cleanup"; read; rm "$FILL_FILE"
