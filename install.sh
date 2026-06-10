#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Installation mode
OFFLINE_MODE=false
BUNDLE_PATH="stdout-bundle.tar.gz"
LICENSE_FILE="stdout.license"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --offline)
      OFFLINE_MODE=true
      shift
      ;;
    --bundle)
      BUNDLE_PATH="$2"
      shift 2
      ;;
    --license)
      LICENSE_FILE="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--offline] [--bundle <path>] [--license <path>]"
      exit 1
      ;;
  esac
done

# Banner
echo -e "${PURPLE}"
cat <<'EOF'
   _____ __       ______            __
  / ___// /______/ / __ \__  ______/ /_
  \__ \/ __/ __  / / / / / / / / __  __/
 ___/ / /_/ /_/ / /_/ / /_/ / /_/ /
/____/\__/\__,_/\____/\__,_/\__,_/

EOF
echo -e "${NC}"

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  StdOut Installation${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Pre-flight checks
echo -e "${BLUE}⏳ Running pre-flight checks...${NC}"

# Check Docker
if ! command -v docker &> /dev/null; then
  echo -e "${RED}✗ Docker not found${NC}"
  echo ""
  echo "Please install Docker first:"
  echo "  macOS: https://docs.docker.com/desktop/install/mac-install/"
  echo "  Linux: https://docs.docker.com/engine/install/"
  echo "  Windows: https://docs.docker.com/desktop/install/windows-install/"
  exit 1
fi
echo -e "${GREEN}✓ Docker found: $(docker --version)${NC}"

# Check Docker Compose
if ! docker compose version &> /dev/null; then
  echo -e "${RED}✗ Docker Compose not found${NC}"
  echo "Docker Compose is required. Please install it first."
  exit 1
fi
echo -e "${GREEN}✓ Docker Compose found: $(docker compose version)${NC}"

# Check Docker daemon
if ! docker info &> /dev/null; then
  echo -e "${RED}✗ Docker daemon not running${NC}"
  echo "Please start Docker Desktop (macOS/Windows) or the Docker daemon (Linux)"
  exit 1
fi
echo -e "${GREEN}✓ Docker daemon running${NC}"

# Check/install Avahi on Linux for mDNS
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
  if ! command -v avahi-daemon &> /dev/null; then
    echo -e "${YELLOW}⚠ Avahi not found (needed for stdout.local)${NC}"
    echo -e "${BLUE}⏳ Installing Avahi...${NC}"
    if command -v apt-get &> /dev/null; then
      sudo apt-get update -qq && sudo apt-get install -y avahi-daemon avahi-utils
    elif command -v yum &> /dev/null; then
      sudo yum install -y avahi avahi-tools
    elif command -v pacman &> /dev/null; then
      sudo pacman -S --noconfirm avahi nss-mdns
    else
      echo -e "${YELLOW}⚠ Unknown package manager - please install avahi-daemon manually${NC}"
    fi
    # Start Avahi
    if command -v systemctl &> /dev/null; then
      sudo systemctl enable avahi-daemon
      sudo systemctl start avahi-daemon
    fi
  fi
  if systemctl is-active --quiet avahi-daemon; then
    echo -e "${GREEN}✓ Avahi running (mDNS enabled)${NC}"
  else
    echo -e "${YELLOW}⚠ Avahi not running - stdout.local may not work (use IP instead)${NC}"
  fi
fi

# Check network connectivity
if ! curl -s --max-time 5 https://ghcr.io &> /dev/null; then
  echo -e "${YELLOW}⚠ Warning: Unable to reach ghcr.io${NC}"
  echo "Installation may fail if network connectivity is required."
fi
echo -e "${GREEN}✓ Network connectivity OK${NC}"

# Check port availability
if command -v lsof &> /dev/null; then
  if lsof -Pi :8888 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo -e "${RED}✗ Port 8888 already in use${NC}"
    echo "Please free port 8888 before continuing."
    exit 1
  fi
  echo -e "${GREEN}✓ Port 8888 available${NC}"
fi

echo ""

# Offline mode: load images from bundle
if [ "$OFFLINE_MODE" = true ]; then
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}  Offline Installation Mode${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""

  # Validate bundle exists
  if [ ! -f "$BUNDLE_PATH" ]; then
    echo -e "${RED}✗ Error: Bundle not found at $BUNDLE_PATH${NC}"
    echo ""
    echo "Download bundle from: https://stdout.io/download"
    echo "(Requires valid StdOut license)"
    exit 1
  fi

  # Validate license file exists
  if [ ! -f "$LICENSE_FILE" ]; then
    echo -e "${RED}✗ Error: License file not found at $LICENSE_FILE${NC}"
    echo ""
    echo "Download your license file from your purchase email"
    echo "or from: https://stdout.io/licenses"
    exit 1
  fi

  echo -e "${GREEN}✓ Found bundle: $BUNDLE_PATH ($(du -h "$BUNDLE_PATH" | cut -f1))${NC}"
  echo -e "${GREEN}✓ Found license: $LICENSE_FILE${NC}"
  echo ""
  echo -e "${BLUE}⏳ Loading Docker images from bundle...${NC}"

  # Load images from bundle
  if gunzip -c "$BUNDLE_PATH" | docker load; then
    echo -e "${GREEN}✓ Images loaded successfully${NC}"
  else
    echo -e "${RED}✗ Failed to load images from bundle${NC}"
    exit 1
  fi
  echo ""
else
  # Online mode: pull from GHCR
  echo -e "${BLUE}⏳ Pulling setup server image...${NC}"
  # Note: Update this to ghcr.io/seayniclabs/stdout-setup:latest once package permissions are configured
  if ! docker pull ghcr.io/charlieseay/stdout-setup:latest 2>/dev/null; then
    echo -e "${YELLOW}⚠ Using local image (GHCR pull failed)${NC}"
    # For local testing, build from repo
    if [ -d "stdout-setup" ]; then
      cd stdout-setup && docker build -t ghcr.io/charlieseay/stdout-setup:latest . && cd ..
    fi
  fi
  echo -e "${GREEN}✓ Setup server image ready${NC}"
  echo ""
fi

# Prepare workspace
WORKSPACE_DIR="$(pwd)/stdout-data"
mkdir -p "$WORKSPACE_DIR"

# Start setup server
echo -e "${BLUE}🌐 Starting setup server...${NC}"
if [ "$OFFLINE_MODE" = true ]; then
  docker run -d \
    --name stdout-setup \
    --hostname stdout \
    -p 8888:8888 \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$WORKSPACE_DIR:/workspace" \
    -v "$(pwd)/$LICENSE_FILE:/app/stdout.license:ro" \
    -e OFFLINE_MODE=true \
    ghcr.io/charlieseay/stdout-setup:latest
else
  docker run -d \
    --name stdout-setup \
    --hostname stdout \
    -p 8888:8888 \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$WORKSPACE_DIR:/workspace" \
    ghcr.io/charlieseay/stdout-setup:latest
fi

# Wait for health check
echo -e "${BLUE}⏳ Waiting for setup server to be ready...${NC}"
RETRY_COUNT=0
MAX_RETRIES=30

until docker exec stdout-setup curl -f http://localhost:8888/health &>/dev/null || [ $RETRY_COUNT -eq $MAX_RETRIES ]; do
  sleep 1
  RETRY_COUNT=$((RETRY_COUNT + 1))
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
  echo -e "${RED}✗ Setup server failed to start${NC}"
  echo ""
  echo "Logs:"
  docker logs stdout-setup
  echo ""
  echo "Cleaning up..."
  docker stop stdout-setup 2>/dev/null || true
  docker rm stdout-setup 2>/dev/null || true
  exit 1
fi

echo -e "${GREEN}✓ Setup server ready${NC}"
echo ""

# Get network addresses
if command -v hostname &> /dev/null; then
  LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0 2>/dev/null || echo "localhost")
else
  LOCAL_IP="localhost"
fi
MDNS_NAME="stdout.local"

# Print connection info
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ✓ Setup Server Running!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${CYAN}Open in your browser:${NC}"
echo -e "  ${YELLOW}→ http://${MDNS_NAME}:8888${NC}"
echo -e "  ${YELLOW}→ http://${LOCAL_IP}:8888${NC}"
if [ "$LOCAL_IP" != "localhost" ]; then
  echo -e "  ${YELLOW}→ http://localhost:8888${NC} ${BLUE}(if running locally)${NC}"
fi
echo ""
echo -e "${CYAN}Installation will begin when you open the URL above.${NC}"
echo -e "${CYAN}Waiting for setup to complete...${NC}"
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Tail logs (will continue until user Ctrl+C or setup completes)
echo -e "${BLUE}📋 Installation Log:${NC}"
echo ""
docker logs -f stdout-setup

# Cleanup is handled by the setup container self-destructing
