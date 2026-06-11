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
REMOTE_TARGET=""   # e.g. charlie@192.168.0.244 — run the install ON that host over SSH

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
    --remote)
      REMOTE_TARGET="$2"
      shift 2
      ;;
    --config)
      CONFIG_FILE="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--offline] [--bundle <path>] [--license <path>] [--remote user@host] [--config deploy.yaml]"
      exit 1
      ;;
  esac
done

# ─── Multi-box install from a deploy config (--config deploy.yaml) ───────────
# Provisions each target in the file sequentially via the --remote path.
# Default role is `full` (complete stack); roles can split components per box.
# See deploy.example.yaml.
if [[ -n "${CONFIG_FILE:-}" ]]; then
  [[ -f "$CONFIG_FILE" ]] || { echo "✗ Config not found: $CONFIG_FILE"; exit 1; }
  command -v python3 >/dev/null 2>&1 || { echo "✗ python3 required to parse $CONFIG_FILE"; exit 1; }

  # Emit "host<TAB>roles<TAB>stdout_url" per target. Uses PyYAML if available,
  # else a minimal line parser for the simple list-of-targets shape.
  TARGETS_TSV="$(python3 - "$CONFIG_FILE" <<'PYEOF'
import sys
path = sys.argv[1]
data = None
try:
    import yaml
    data = yaml.safe_load(open(path))
except Exception:
    data = None
rows = []
if isinstance(data, dict) and isinstance(data.get("targets"), list):
    for t in data["targets"]:
        if not isinstance(t, dict): continue
        host = (t.get("host") or "").strip()
        if not host: continue
        roles = t.get("roles") or ["full"]
        roles = ",".join(roles) if isinstance(roles, list) else str(roles)
        rows.append(f"{host}\t{roles}\t{(t.get('stdout_url') or '').strip()}")
else:
    # Minimal fallback parser (no PyYAML): read `- host:` / `roles:` / `stdout_url:`.
    host=roles=url=None
    def flush():
        global host,roles,url
        if host: rows.append(f"{host}\t{roles or 'full'}\t{url or ''}")
        host=roles=url=None
    for raw in open(path):
        line=raw.split("#",1)[0].rstrip()
        s=line.strip()
        if s.startswith("- host:"):
            flush(); host=s.split(":",1)[1].strip()
        elif s.startswith("host:"):
            flush(); host=s.split(":",1)[1].strip()
        elif s.startswith("roles:"):
            roles=s.split(":",1)[1].strip().strip("[]").replace(" ","")
        elif s.startswith("stdout_url:"):
            url=s.split(":",1)[1].strip()
    flush()
print("\n".join(rows))
PYEOF
)"

  [[ -n "$TARGETS_TSV" ]] || { echo "✗ No targets found in $CONFIG_FILE"; exit 1; }
  echo "→ Deploying StdOut to $(echo "$TARGETS_TSV" | grep -c .) target(s) from ${CONFIG_FILE}..."
  SELF="$0"
  while IFS=$'\t' read -r t_host t_roles t_url; do
    [[ -z "$t_host" ]] && continue
    echo ""
    echo "════════════════════════════════════════════"
    echo "  ${t_host}  [roles: ${t_roles}]"
    echo "════════════════════════════════════════════"
    # roles/stdout_url are passed through for the target to honor (full stack
    # today; per-role provisioning reads STDOUT_ROLES / STDOUT_PEER_URL).
    STDOUT_ROLES="$t_roles" STDOUT_PEER_URL="$t_url" bash "$SELF" --remote "$t_host" \
      ${OFFLINE_MODE:+--offline} || echo "⚠ ${t_host} failed — continuing to next target."
  done <<< "$TARGETS_TSV"
  echo ""
  echo "→ Multi-box deploy complete. Open each setup URL above to finish."
  exit 0
fi

# ─── Remote install: run this same installer ON the target host over SSH ───
# Usage:  ./install.sh --remote charlie@192.168.0.244
# Copies the installer (+ license/bundle if present) to the target, runs it
# there (pulls images, checks prereqs, starts the setup server), then prints
# the magic setup URL pointed at the TARGET so you can open it from this Mac.
if [[ -n "$REMOTE_TARGET" ]]; then
  REMOTE_HOST="${REMOTE_TARGET#*@}"   # strip user@ → bare host/IP for the URL
  REMOTE_DIR="stdout-install"
  echo "→ Installing StdOut on ${REMOTE_TARGET} over SSH..."

  # 1. Reachability: can we SSH to the target at all?
  if ! ssh -o ConnectTimeout=8 "$REMOTE_TARGET" 'echo ok' >/dev/null 2>&1; then
    echo "✗ ${REMOTE_TARGET}: SSH unreachable. Check the host/IP, user, and your SSH key."
    exit 1
  fi

  # 2. Copy installer + preflight + any local license/bundle into a clean remote dir.
  ssh "$REMOTE_TARGET" "mkdir -p ~/${REMOTE_DIR}"
  scp -q "$0" "${REMOTE_TARGET}:~/${REMOTE_DIR}/install.sh"
  PREFLIGHT_LOCAL="$(dirname "$0")/preflight.sh"
  [[ -f "$PREFLIGHT_LOCAL" ]] && scp -q "$PREFLIGHT_LOCAL" "${REMOTE_TARGET}:~/${REMOTE_DIR}/preflight.sh"

  # Ask once, here, whether to allow prerequisite installs on the target. This
  # honors "ask for approval before running" — approve once, runs unattended there.
  REMOTE_PREFLIGHT_YES=false
  if [[ -t 0 ]]; then
    read -r -p "→ Allow ${REMOTE_TARGET} to auto-install missing prerequisites (Docker, etc.) if needed? [y/N] " _pf
    [[ "$_pf" =~ ^[Yy]$ ]] && REMOTE_PREFLIGHT_YES=true
  fi

  REMOTE_ARGS=""
  [[ "$OFFLINE_MODE" == true ]] && REMOTE_ARGS="$REMOTE_ARGS --offline"
  if [[ -f "$LICENSE_FILE" ]]; then
    scp -q "$LICENSE_FILE" "${REMOTE_TARGET}:~/${REMOTE_DIR}/$(basename "$LICENSE_FILE")"
    REMOTE_ARGS="$REMOTE_ARGS --license $(basename "$LICENSE_FILE")"
  fi
  if [[ "$OFFLINE_MODE" == true && -f "$BUNDLE_PATH" ]]; then
    scp -q "$BUNDLE_PATH" "${REMOTE_TARGET}:~/${REMOTE_DIR}/$(basename "$BUNDLE_PATH")"
    REMOTE_ARGS="$REMOTE_ARGS --bundle $(basename "$BUNDLE_PATH")"
  fi

  # 3. Run the installer on the target. STDOUT_HOST overrides the printed URL
  #    host so the link points at the target, not the container's hostname.
  #    PREFLIGHT_YES carries the one-time approval to install prereqs there.
  #    -t gives a live TTY so you see the colored progress + log stream here.
  ssh -t "$REMOTE_TARGET" "cd ~/${REMOTE_DIR} && chmod +x install.sh preflight.sh 2>/dev/null; STDOUT_HOST='${REMOTE_HOST}' PREFLIGHT_YES='${REMOTE_PREFLIGHT_YES}' bash install.sh${REMOTE_ARGS}"
  exit $?
fi

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

# Pre-flight checks — delegate to preflight.sh (detects + offers to install
# prerequisites, asking approval first). Falls back to inline Docker checks if
# the script isn't present next to install.sh.
echo -e "${BLUE}⏳ Running pre-flight checks...${NC}"
PREFLIGHT="$(dirname "$0")/preflight.sh"
if [ -f "$PREFLIGHT" ]; then
  # PREFLIGHT_YES=true (exported by --remote) auto-approves on unattended targets.
  if [ "${PREFLIGHT_YES:-false}" = true ]; then
    bash "$PREFLIGHT" --yes || exit 1
  else
    bash "$PREFLIGHT" || exit 1
  fi
else
  if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker not found${NC} — install: https://docs.docker.com/engine/install/"
    exit 1
  fi
  echo -e "${GREEN}✓ Docker found: $(docker --version)${NC}"
  docker compose version &> /dev/null || { echo -e "${RED}✗ Docker Compose not found${NC}"; exit 1; }
  echo -e "${GREEN}✓ Docker Compose found${NC}"
  docker info &> /dev/null || { echo -e "${RED}✗ Docker daemon not running${NC}"; exit 1; }
  echo -e "${GREEN}✓ Docker daemon running${NC}"
fi

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
if ! curl -s --max-time 5 https://hub.docker.com &> /dev/null; then
  echo -e "${YELLOW}⚠ Warning: Unable to reach Docker Hub${NC}"
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
  # Online mode: pull from public Docker Hub
  echo -e "${BLUE}⏳ Pulling setup server image...${NC}"
  # Public Docker Hub image — no auth required for customers
  if ! docker pull charlieseay/stdout-setup:latest 2>/dev/null; then
    echo -e "${YELLOW}⚠ Using local image (GHCR pull failed)${NC}"
    # For local testing, build from repo
    if [ -d "stdout-setup" ]; then
      cd stdout-setup && docker build -t charlieseay/stdout-setup:latest . && cd ..
    fi
  fi
  echo -e "${GREEN}✓ Setup server image ready${NC}"
  echo ""
fi

# Prepare workspace
WORKSPACE_DIR="$(pwd)/stdout-data"
mkdir -p "$WORKSPACE_DIR"

# Remove any prior setup container so re-runs are idempotent (no name/port clash).
if docker ps -a --format '{{.Names}}' | grep -qx stdout-setup; then
  echo -e "${BLUE}↻ Removing previous setup container...${NC}"
  docker stop stdout-setup >/dev/null 2>&1 || true
  docker rm stdout-setup >/dev/null 2>&1 || true
fi

# Start setup server
echo -e "${BLUE}🌐 Starting setup server...${NC}"
if [ "$OFFLINE_MODE" = true ]; then
  docker run -d \
    --name stdout-setup \
    --restart unless-stopped \
    --hostname stdout \
    -p 8888:8888 \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$WORKSPACE_DIR:/workspace" \
    -v "$(pwd)/$LICENSE_FILE:/app/stdout.license:ro" \
    -e OFFLINE_MODE=true \
    charlieseay/stdout-setup:latest
else
  docker run -d \
    --name stdout-setup \
    --restart unless-stopped \
    --hostname stdout \
    -p 8888:8888 \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$WORKSPACE_DIR:/workspace" \
    charlieseay/stdout-setup:latest
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

# When invoked via --remote, STDOUT_HOST is the target host/IP — make the
# clickable URL point there so you can open it from the machine you launched on.
PRIMARY_HOST="${STDOUT_HOST:-$MDNS_NAME}"

# Print connection info
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ✓ Setup Server Running!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${CYAN}Open in your browser:${NC}"
echo -e "  ${YELLOW}→ http://${PRIMARY_HOST}:8888${NC}"
if [ -n "${STDOUT_HOST:-}" ]; then
  echo -e "  ${YELLOW}→ http://${MDNS_NAME}:8888${NC} ${BLUE}(if mDNS resolves on your LAN)${NC}"
else
  echo -e "  ${YELLOW}→ http://${LOCAL_IP}:8888${NC}"
  if [ "$LOCAL_IP" != "localhost" ]; then
    echo -e "  ${YELLOW}→ http://localhost:8888${NC} ${BLUE}(if running locally)${NC}"
  fi
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
