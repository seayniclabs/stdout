#!/usr/bin/env bash
# StdOut Satellite Agent Installer
# Usage: curl -fsSL https://stdout.seayniclabs.com/install/satellite.sh | \
#   STDOUT_URL=https://stdout.seayniclabs.com \
#   STDOUT_TOKEN=sat_xxxxx \
#   STDOUT_NODE_ID=xxxxxxxx \
#   bash
set -euo pipefail

STDOUT_URL="${STDOUT_URL:-}"
STDOUT_TOKEN="${STDOUT_TOKEN:-}"
STDOUT_NODE_ID="${STDOUT_NODE_ID:-}"
STDOUT_AUTO_DISCOVER="${STDOUT_AUTO_DISCOVER:-true}"
INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="/etc/stdout-satellite"
SERVICE_USER="stdout-satellite"
BINARY_NAME="stdout-satellite"
GITHUB_REPO="charlieseay/stdout-satellite"
VERSION="${STDOUT_SATELLITE_VERSION:-latest}"

# ── Validation ─────────────────────────────────────────────────────────────────
if [[ -z "$STDOUT_TOKEN" || -z "$STDOUT_NODE_ID" ]]; then
  echo "ERROR: STDOUT_TOKEN and STDOUT_NODE_ID must be set"
  echo ""
  echo "Get these from StdOut → Satellites → Add Node"
  echo ""
  echo "STDOUT_URL is optional — if omitted, the satellite will auto-discover"
  echo "StdOut on your local network."
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: This installer must be run as root (sudo bash or root shell)"
  exit 1
fi

# ── Detect arch ────────────────────────────────────────────────────────────────
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  ARCH_SUFFIX="linux-amd64" ;;
  aarch64) ARCH_SUFFIX="linux-arm64" ;;
  arm64)   ARCH_SUFFIX="linux-arm64" ;;
  *)
    echo "ERROR: Unsupported architecture: $ARCH"
    exit 1
  ;;
esac

echo "==> StdOut Satellite Installer"
echo "    Node ID:      $STDOUT_NODE_ID"
echo "    Collector:    $STDOUT_URL"
echo "    Architecture: $ARCH_SUFFIX"
echo ""

# ── Download binary ────────────────────────────────────────────────────────────
BINARY_URL="${STDOUT_URL}/install/binaries/${BINARY_NAME}-${ARCH_SUFFIX}"
echo "==> Downloading binary from $BINARY_URL"
curl -fsSL -o "/tmp/${BINARY_NAME}" "$BINARY_URL"
chmod +x "/tmp/${BINARY_NAME}"

# Verify it runs
if ! /tmp/${BINARY_NAME} --version &>/dev/null; then
  echo "ERROR: Downloaded binary failed to execute"
  exit 1
fi

mv "/tmp/${BINARY_NAME}" "${INSTALL_DIR}/${BINARY_NAME}"
echo "    Installed to ${INSTALL_DIR}/${BINARY_NAME}"

# ── Create service user ────────────────────────────────────────────────────────
if ! id "$SERVICE_USER" &>/dev/null; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  echo "==> Created system user: $SERVICE_USER"
fi

# Add to docker group if Docker is present (needed for docker check)
if getent group docker &>/dev/null; then
  usermod -aG docker "$SERVICE_USER" 2>/dev/null || true
  echo "    Added $SERVICE_USER to docker group"
fi

# ── Write config ───────────────────────────────────────────────────────────────
mkdir -p "$CONFIG_DIR"
chmod 750 "$CONFIG_DIR"
chown root:"$SERVICE_USER" "$CONFIG_DIR"

NODE_NAME="${STDOUT_NODE_NAME:-$(hostname -s)}"

# Build TOML — auto_discover = true when no URL given, false when URL is explicit
if [[ -z "$STDOUT_URL" ]]; then
  COLLECTOR_LINE=""
  AUTO_DISCOVER_LINE="auto_discover = true"
else
  COLLECTOR_LINE="collector_url   = \"${STDOUT_URL}\""
  AUTO_DISCOVER_LINE="auto_discover = false"
fi

cat > "${CONFIG_DIR}/config.toml" <<TOML
${COLLECTOR_LINE}
api_token       = "${STDOUT_TOKEN}"
node_name       = "${NODE_NAME}"
node_tags       = []
report_interval = 60
${AUTO_DISCOVER_LINE}

[checks]
system    = true
processes = true
logs      = true
network   = true
security  = true
docker    = true
git       = false
TOML

chmod 640 "${CONFIG_DIR}/config.toml"
chown root:"$SERVICE_USER" "${CONFIG_DIR}/config.toml"
echo "==> Config written to ${CONFIG_DIR}/config.toml"

# ── Install systemd unit ───────────────────────────────────────────────────────
cat > /etc/systemd/system/stdout-satellite.service <<UNIT
[Unit]
Description=StdOut Satellite Agent
Documentation=https://stdout.seayniclabs.com/docs/satellite
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
Environment=NODE_ID=${STDOUT_NODE_ID}
ExecStart=${INSTALL_DIR}/${BINARY_NAME} --config ${CONFIG_DIR}/config.toml --node-id \${NODE_ID}
Restart=always
RestartSec=30
StandardOutput=journal
StandardError=journal
SyslogIdentifier=stdout-satellite
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadOnlyPaths=/
ReadWritePaths=/var/lib/stdout-satellite /tmp

[Install]
WantedBy=multi-user.target
UNIT

mkdir -p /var/lib/stdout-satellite
chown "$SERVICE_USER":"$SERVICE_USER" /var/lib/stdout-satellite

systemctl daemon-reload
systemctl enable stdout-satellite
systemctl restart stdout-satellite

# ── Verify ─────────────────────────────────────────────────────────────────────
echo ""
echo "==> Waiting for first report…"
sleep 5

STATUS=$(systemctl is-active stdout-satellite)
if [[ "$STATUS" == "active" ]]; then
  echo "    Service status: RUNNING ✓"
else
  echo "    WARNING: Service status is '$STATUS'"
  echo "    Check logs: journalctl -u stdout-satellite -n 20"
fi

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  StdOut Satellite installed successfully             ║"
echo "║                                                      ║"
echo "║  Node:    ${NODE_NAME}"
echo "║  Logs:    journalctl -u stdout-satellite -f          ║"
echo "║  Config:  ${CONFIG_DIR}/config.toml                  ║"
echo "║  Status:  systemctl status stdout-satellite          ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "The node will appear in StdOut → Satellites within 90 seconds."
