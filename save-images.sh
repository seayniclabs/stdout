#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  StdOut Image Bundle Creator${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Image names
STDOUT_IMAGE="ghcr.io/seayniclabs/stdout:latest"
WINDLASS_IMAGE="ghcr.io/seayniclabs/windlass:latest"
SETUP_IMAGE="charlieseay/stdout-setup:latest"
OUTPUT_FILE="stdout-bundle.tar"

echo -e "${BLUE}⏳ Pulling images from GHCR...${NC}"
echo ""

# Pull stdout
echo -e "${BLUE}  → Pulling $STDOUT_IMAGE${NC}"
if docker pull "$STDOUT_IMAGE"; then
  echo -e "${GREEN}  ✓ StdOut image pulled${NC}"
else
  echo -e "${RED}  ✗ Failed to pull StdOut image${NC}"
  echo -e "${YELLOW}  Attempting to use local image...${NC}"
  if ! docker images -q "$STDOUT_IMAGE" | grep -q .; then
    echo -e "${RED}  No local image found. Exiting.${NC}"
    exit 1
  fi
fi
echo ""

# Pull windlass
echo -e "${BLUE}  → Pulling $WINDLASS_IMAGE${NC}"
if docker pull "$WINDLASS_IMAGE"; then
  echo -e "${GREEN}  ✓ Windlass image pulled${NC}"
else
  echo -e "${RED}  ✗ Failed to pull Windlass image${NC}"
  echo -e "${YELLOW}  Attempting to use local image...${NC}"
  if ! docker images -q "$WINDLASS_IMAGE" | grep -q .; then
    echo -e "${RED}  No local image found. Exiting.${NC}"
    exit 1
  fi
fi
echo ""

# Pull setup server
echo -e "${BLUE}  → Pulling $SETUP_IMAGE${NC}"
if docker pull "$SETUP_IMAGE"; then
  echo -e "${GREEN}  ✓ Setup server image pulled${NC}"
else
  echo -e "${RED}  ✗ Failed to pull setup server image${NC}"
  echo -e "${YELLOW}  Attempting to use local image...${NC}"
  if ! docker images -q "$SETUP_IMAGE" | grep -q .; then
    echo -e "${RED}  No local image found. Exiting.${NC}"
    exit 1
  fi
fi
echo ""

# Save images to tarball
echo -e "${BLUE}⏳ Saving images to $OUTPUT_FILE...${NC}"
docker save \
  "$STDOUT_IMAGE" \
  "$WINDLASS_IMAGE" \
  "$SETUP_IMAGE" \
  -o "$OUTPUT_FILE"

echo -e "${GREEN}✓ Images saved to tarball${NC}"
echo ""

# Compress
echo -e "${BLUE}⏳ Compressing tarball...${NC}"
gzip -f "$OUTPUT_FILE"
OUTPUT_FILE="${OUTPUT_FILE}.gz"

echo -e "${GREEN}✓ Compression complete${NC}"
echo ""

# Show results
FILE_SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ✓ Bundle Created${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${CYAN}  File: $OUTPUT_FILE${NC}"
echo -e "${CYAN}  Size: $FILE_SIZE${NC}"
echo ""
echo -e "${YELLOW}Upload this bundle to your distribution system${NC}"
echo -e "${YELLOW}Users can install offline with:${NC}"
echo -e "${YELLOW}  ./install.sh --offline --bundle $OUTPUT_FILE --license stdout.license${NC}"
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
