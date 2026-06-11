#!/bin/bash
# preflight.sh — verify (and optionally install) StdOut prerequisites.
#
# Run standalone or sourced by install.sh. Detects Docker, Docker Compose, the
# daemon, curl, and (on Linux) Avahi for mDNS. If something is missing it prints
# exactly what it would install and ASKS FOR APPROVAL before running anything.
#
#   ./preflight.sh                 # interactive: prompt before each install
#   ./preflight.sh --yes           # assume yes (non-interactive / automation)
#   ./preflight.sh --check-only     # report status, never install, exit 1 if missing
#
# Exit: 0 = all prerequisites satisfied; non-zero = missing + not installed.
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

ASSUME_YES=false
CHECK_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=true ;;
    --check-only) CHECK_ONLY=true ;;
  esac
done

# Ask for approval unless --yes. Returns 0 on yes.
confirm() {
  local prompt="$1"
  if [ "$ASSUME_YES" = true ]; then return 0; fi
  if [ ! -t 0 ]; then
    # No TTY and not --yes → refuse to install silently.
    echo -e "${YELLOW}  (no terminal to confirm; re-run with --yes to allow install)${NC}"
    return 1
  fi
  read -r -p "$prompt [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]]
}

OS="unknown"
case "$OSTYPE" in
  darwin*) OS="macos" ;;
  linux-gnu*) OS="linux" ;;
esac

MISSING=0

# ── Docker ───────────────────────────────────────────────────────────────────
if command -v docker >/dev/null 2>&1; then
  echo -e "${GREEN}✓ Docker: $(docker --version)${NC}"
else
  echo -e "${RED}✗ Docker not found${NC}"
  if [ "$CHECK_ONLY" = true ]; then
    MISSING=1
  elif [ "$OS" = "linux" ]; then
    echo -e "${BLUE}  Would install Docker via: ${NC}curl -fsSL https://get.docker.com | sudo sh"
    if confirm "  Install Docker now?"; then
      curl -fsSL https://get.docker.com | sudo sh
      sudo systemctl enable --now docker 2>/dev/null || true
      command -v docker >/dev/null 2>&1 && echo -e "${GREEN}✓ Docker installed${NC}" || { echo -e "${RED}✗ Docker install failed${NC}"; MISSING=1; }
    else
      MISSING=1
    fi
  else
    # macOS: Docker Desktop is a GUI app — don't auto-install, just guide.
    echo -e "${YELLOW}  Install Docker Desktop: https://docs.docker.com/desktop/install/mac-install/${NC}"
    MISSING=1
  fi
fi

# ── Docker Compose (v2 plugin) ───────────────────────────────────────────────
if docker compose version >/dev/null 2>&1; then
  echo -e "${GREEN}✓ Docker Compose: $(docker compose version | head -1)${NC}"
else
  echo -e "${RED}✗ Docker Compose (v2) not found${NC}"
  if [ "$CHECK_ONLY" = true ]; then
    MISSING=1
  elif [ "$OS" = "linux" ] && command -v apt-get >/dev/null 2>&1; then
    echo -e "${BLUE}  Would install: ${NC}sudo apt-get install -y docker-compose-plugin"
    if confirm "  Install Docker Compose plugin now?"; then
      sudo apt-get update -qq && sudo apt-get install -y docker-compose-plugin
      docker compose version >/dev/null 2>&1 && echo -e "${GREEN}✓ Compose installed${NC}" || MISSING=1
    else
      MISSING=1
    fi
  else
    echo -e "${YELLOW}  Compose ships with Docker Desktop; otherwise install the docker-compose-plugin.${NC}"
    MISSING=1
  fi
fi

# ── Docker daemon running ────────────────────────────────────────────────────
if docker info >/dev/null 2>&1; then
  echo -e "${GREEN}✓ Docker daemon running${NC}"
else
  echo -e "${RED}✗ Docker daemon not running${NC}"
  if [ "$CHECK_ONLY" != true ] && [ "$OS" = "linux" ]; then
    if confirm "  Start the Docker daemon now?"; then
      sudo systemctl start docker 2>/dev/null || true
      docker info >/dev/null 2>&1 && echo -e "${GREEN}✓ Daemon started${NC}" || MISSING=1
    else MISSING=1; fi
  else
    echo -e "${YELLOW}  Start Docker Desktop (macOS) or the docker service (Linux).${NC}"
    MISSING=1
  fi
fi

# ── curl ─────────────────────────────────────────────────────────────────────
if command -v curl >/dev/null 2>&1; then
  echo -e "${GREEN}✓ curl present${NC}"
else
  echo -e "${RED}✗ curl not found${NC}"
  if [ "$CHECK_ONLY" != true ] && [ "$OS" = "linux" ] && command -v apt-get >/dev/null 2>&1; then
    if confirm "  Install curl now?"; then sudo apt-get install -y curl && echo -e "${GREEN}✓ curl installed${NC}" || MISSING=1; else MISSING=1; fi
  else MISSING=1; fi
fi

# ── Avahi (Linux only — optional, for stdout.local mDNS) ─────────────────────
if [ "$OS" = "linux" ]; then
  if command -v avahi-daemon >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Avahi present (mDNS / stdout.local)${NC}"
  else
    echo -e "${YELLOW}○ Avahi not found — optional, enables http://stdout.local${NC}"
    if [ "$CHECK_ONLY" != true ] && command -v apt-get >/dev/null 2>&1; then
      if confirm "  Install Avahi for mDNS (optional)?"; then
        sudo apt-get install -y avahi-daemon avahi-utils && sudo systemctl enable --now avahi-daemon 2>/dev/null || true
      fi
    fi
  fi
fi

echo ""
if [ "$MISSING" -ne 0 ]; then
  echo -e "${RED}✗ Prerequisites incomplete — resolve the items above, then re-run.${NC}"
  exit 1
fi
echo -e "${GREEN}✓ All prerequisites satisfied.${NC}"
exit 0
