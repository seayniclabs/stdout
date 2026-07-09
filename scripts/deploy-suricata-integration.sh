#!/usr/bin/env bash
# Deploy Suricata TOOL1 integration to /opt/stdout and enable continuous processing.
#
# Does NOT modify Suricata detection rules (correlation layer only).
# Does NOT hardcode IP lists (Windlass API applies blocks dynamically).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_SRC="$ROOT/deploy/suricata-stdout-integration.service"
UNIT_DST="/etc/systemd/system/suricata-stdout-integration.service"
INSTALL_SYSTEMD=0

if [[ -n "${STDOUT_DEPLOY_ROOT:-}" ]]; then
  DEST="$STDOUT_DEPLOY_ROOT"
elif [[ "$(id -u)" -eq 0 ]]; then
  DEST="/opt/stdout"
  INSTALL_SYSTEMD=1
else
  DEST="$ROOT/.deploy-suricata"
  echo "Not root — installing to $DEST (set STDOUT_DEPLOY_ROOT or run as root for /opt/stdout + systemd)." >&2
fi

echo "=== Deploy Suricata TOOL1 → ${DEST} ==="

mkdir -p "$DEST" "$DEST/scripts" "$DEST/fixtures" "$DEST/observatory/config" "$DEST/deploy"

install -m 0755 "$ROOT/scripts/correlation_script.py" "$DEST/scripts/correlation_script.py"
# Brief path: /opt/stdout/correlation_script.py
install -m 0755 "$ROOT/scripts/correlation_script.py" "$DEST/correlation_script.py"
install -m 0755 "$ROOT/scripts/suricata-functional-test.mjs" "$DEST/scripts/suricata-functional-test.mjs"
install -m 0755 "$ROOT/scripts/verify-suricata-integration.sh" "$DEST/scripts/verify-suricata-integration.sh"
install -m 0644 "$ROOT/fixtures/sample_eve.json" "$DEST/fixtures/sample_eve.json"
install -m 0644 "$ROOT/fixtures/sample_eve.json" "$DEST/sample_eve.json"
install -m 0644 "$ROOT/observatory/config/correlation-rules.yaml" "$DEST/observatory/config/correlation-rules.yaml"
install -m 0644 "$ROOT/observatory/config/redis-stream-config.lua" "$DEST/observatory/config/redis-stream-config.lua"
install -m 0755 "$ROOT/scripts/suricata-entrypoint.sh" "$DEST/observatory/config/suricata-entrypoint.sh"
install -m 0755 "$ROOT/scripts/eve-redis-bridge.sh" "$DEST/scripts/eve-redis-bridge.sh"
mkdir -p "$DEST/observatory/suricata-runtime"
install -m 0755 "$ROOT/scripts/suricata-entrypoint.sh" "$DEST/observatory/suricata-runtime/suricata-entrypoint.sh"
install -m 0755 "$ROOT/scripts/eve-redis-bridge.sh" "$DEST/observatory/suricata-runtime/eve-redis-bridge.sh"
install -m 0644 "$ROOT/observatory/suricata-runtime/Dockerfile" "$DEST/observatory/suricata-runtime/Dockerfile"
install -m 0644 "$ROOT/observatory/suricata-runtime/Dockerfile.bridge" "$DEST/observatory/suricata-runtime/Dockerfile.bridge"
# Compose bind-mounts (prometheus + tempo); required for systemd / docker compose up.
install -m 0644 "$ROOT/observatory/config/prometheus.yml" "$DEST/observatory/config/prometheus.yml"
install -m 0644 "$ROOT/observatory/config/tempo-config.yml" "$DEST/observatory/config/tempo-config.yml"
install -m 0644 "$ROOT/deploy/suricata-stdout-integration.service" "$DEST/deploy/suricata-stdout-integration.service"
install -m 0644 "$ROOT/deploy/suricata.env.example" "$DEST/deploy/suricata.env.example"
# Compose file required by the systemd unit.
install -m 0644 "$ROOT/docker-compose.observatory.yml" "$DEST/docker-compose.observatory.yml"

# Pure classify core for the functional test (no DB).
mkdir -p "$DEST/src/lib"
install -m 0644 "$ROOT/src/lib/suricata-core.mjs" "$DEST/src/lib/suricata-core.mjs"

echo "  installed files under $DEST"

# Redis stream consumer group (brief step 2).
# Prior lesson: unbounded redis-cli ping hangs when Redis is down — use connect timeout.
redis_lua_eval() {
  local lua_file="$1"
  if command -v redis-cli >/dev/null 2>&1; then
    redis-cli --eval "$lua_file"
    return $?
  fi
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx redis; then
    docker exec -i redis redis-cli --eval - 0 < "$lua_file"
    return $?
  fi
  return 127
}

redis_cli() {
  if command -v redis-cli >/dev/null 2>&1; then
    redis-cli "$@"
    return $?
  fi
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx redis; then
    docker exec -i redis redis-cli "$@"
    return $?
  fi
  return 127
}

redis_ping() {
  if ! command -v redis-cli >/dev/null 2>&1 \
     && ! { command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx redis; }; then
    return 1
  fi
  if command -v redis-cli >/dev/null 2>&1 && redis-cli --help 2>&1 | grep -q connect-timeout; then
    redis-cli --connect-timeout 2 ping 2>/dev/null | grep -qi pong
  else
    redis_cli ping 2>/dev/null | grep -qi pong
  fi
}

if redis_ping; then
  if redis_lua_eval "$DEST/observatory/config/redis-stream-config.lua" >/dev/null 2>&1 \
     || redis_cli --raw XGROUP CREATE eve_alerts stream 0 MKSTREAM >/dev/null 2>&1; then
    echo "  Redis XGROUP eve_alerts/stream ready"
  else
    echo "  warning: could not create Redis consumer group (non-fatal)" >&2
  fi
else
  echo "  Redis not reachable — skip XGROUP (set SURICATA_REDIS_URL when enabling stream mode)"
fi

# Functional test (brief step 5 / QA).
if out=$(cat "$DEST/sample_eve.json" | python3 "$DEST/correlation_script.py" 2>&1); then
  if echo "$out" | grep -q "Windlass action triggered"; then
    echo "  functional test: Windlass action triggered"
  else
    echo "  functional test output unexpected:" >&2
    echo "$out" | sed 's/^/    /' >&2
    exit 1
  fi
else
  echo "  functional test failed" >&2
  exit 1
fi

# Systemd continuous processing (brief step 7) — only when root on a real host.
if [[ "$INSTALL_SYSTEMD" -eq 1 ]] && [[ -f "$UNIT_SRC" ]] && command -v systemctl >/dev/null 2>&1; then
  install -m 0644 "$UNIT_SRC" "$UNIT_DST"
  systemctl daemon-reload
  systemctl enable suricata-stdout-integration
  if command -v docker >/dev/null 2>&1; then
    systemctl start suricata-stdout-integration
    echo "  systemctl: suricata-stdout-integration enabled and started"
  else
    echo "  systemctl: unit enabled (start when docker is available)"
  fi
else
  echo "  skip systemd. Unit source: $UNIT_SRC"
  echo "  continuous processing via compose:"
  echo "    docker compose -f docker-compose.observatory.yml --profile suricata up -d"
fi

echo
echo "✅ Suricata TOOL1 deploy complete."
echo "   Verify: $DEST/scripts/verify-suricata-integration.sh"
echo "   Marker: journalctl -u suricata-stdout-integration | grep 'Windlass action executed'"
