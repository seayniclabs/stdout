#!/usr/bin/env bash
# Suricata TOOL1 QA checklist (local / host-net observatory).
# Does not modify Suricata rules. Does not require live traffic.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STDOUT_URL="${STDOUT_URL:-http://127.0.0.1:8112}"
WINDLASS_URL="${WINDLASS_URL:-http://127.0.0.1:8116}"
REDIS_URL="${SURICATA_REDIS_URL:-redis://127.0.0.1:6379/0}"

pass=0
fail=0
skip=0

ok()   { echo "  ✅ $*"; pass=$((pass + 1)); }
bad()  { echo "  ❌ $*"; fail=$((fail + 1)); }
note() { echo "  ⏭  $*"; skip=$((skip + 1)); }

echo "=== Suricata TOOL1 verification ==="

# 1. Unit + functional tests (no Windlass side effects)
echo "— Correlation / classify"
if [[ -f "$ROOT/src/lib/suricata-core.test.mjs" ]]; then
  if node --test src/lib/suricata-core.test.mjs >/dev/null; then
    ok "unit tests (suricata-core)"
  else
    bad "unit tests (suricata-core)"
  fi
else
  note "unit tests skipped (deploy bundle — run from full repo for full QA)"
fi

SAMPLE="${ROOT}/fixtures/sample_eve.json"
[[ -f "$SAMPLE" ]] || SAMPLE="${ROOT}/sample_eve.json"
CORR="${ROOT}/scripts/correlation_script.py"
[[ -f "$CORR" ]] || CORR="${ROOT}/correlation_script.py"

if out=$(cat "$SAMPLE" | python3 "$CORR" 2>&1); then
  if echo "$out" | grep -q "Windlass action triggered" \
     && echo "$out" | grep -q "Windlass action executed"; then
    ok "functional test (sample EVE → action)"
  else
    bad "functional test missing expected markers"
    echo "$out" | sed 's/^/    /'
  fi
  if echo "$out" | grep -Eiq 'token|bearer [a-z0-9]{8,}'; then
    bad "functional output may contain secrets"
  else
    ok "no secrets in functional output"
  fi
  if echo "$out" | grep -Eq '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b'; then
    bad "functional output contains IP addresses (security review)"
  else
    ok "no IPs in functional output"
  fi
else
  bad "functional test failed to run"
fi

# 2. Suricata config validation (when installed)
echo "— Suricata"
if command -v suricata >/dev/null 2>&1; then
  if [[ -f /etc/suricata/suricata.yaml ]]; then
    if suricata -T -c /etc/suricata/suricata.yaml >/dev/null 2>&1; then
      ok "suricata -T config valid"
    else
      bad "suricata -T failed"
    fi
    if grep -qi eve /etc/suricata/suricata.yaml; then
      ok "EVE logging referenced in suricata.yaml"
    else
      note "no eve stanza found in suricata.yaml (container image may use defaults)"
    fi
  else
    note "no /etc/suricata/suricata.yaml (use compose --profile suricata)"
  fi
  if [[ -f /var/log/suricata/eve.json ]]; then
    ok "eve.json present"
  else
    note "eve.json not present yet (start suricata profile or host IDS)"
  fi
else
  note "suricata binary not on PATH (compose profile provides it)"
fi

# 3. Redis stream consumer group (optional)
echo "— Redis stream"
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
    docker exec redis redis-cli "$@"
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
  ok "redis ping"
  if redis_lua_eval observatory/config/redis-stream-config.lua >/dev/null 2>&1; then
    ok "XGROUP eve_alerts/stream ready"
  else
    # Inline fallback matching the brief
    if redis_cli --raw XGROUP CREATE eve_alerts stream 0 MKSTREAM >/dev/null 2>&1 \
       || redis_cli --raw XINFO GROUPS eve_alerts 2>/dev/null | grep -q stream; then
      ok "XGROUP eve_alerts/stream ready (inline)"
    else
      bad "could not create eve_alerts consumer group"
    fi
  fi
else
  note "Redis not reachable (host redis-cli or docker container 'redis')"
fi

# 4. Windlass API
echo "— Windlass"
windlass_probe() {
  local url="$1"
  curl -sf -o /dev/null --max-time 3 "$url" 2>/dev/null
}

if windlass_probe "${WINDLASS_URL}/v1/health" \
   || windlass_probe "${WINDLASS_URL}/health"; then
  ok "Windlass health (${WINDLASS_URL})"
elif command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx stdout; then
  if docker exec stdout wget -qO- --timeout=3 "${WINDLASS_URL:-http://127.0.0.1:8116}/v1/health" >/dev/null 2>&1 \
     || docker exec stdout wget -qO- --timeout=3 "${WINDLASS_URL:-http://127.0.0.1:8116}/health" >/dev/null 2>&1; then
    ok "Windlass health via stdout container (${WINDLASS_URL:-http://127.0.0.1:8116})"
  else
    note "Windlass not reachable at ${WINDLASS_URL:-http://127.0.0.1:8116}"
  fi
else
  note "Windlass not reachable at ${WINDLASS_URL:-http://127.0.0.1:8116}"
fi

if [[ -n "${WINDLASS_TOKEN:-}" ]]; then
  ok "WINDLASS_TOKEN set in environment"
elif [[ -f /etc/stdout/windlass.token ]]; then
  ok "token file /etc/stdout/windlass.token present"
else
  note "no Windlass token (open endpoints on host-net trust model)"
fi

# 5. StdOut ingest status / metrics
echo "— StdOut ingest"
if curl -sf --max-time 3 "${STDOUT_URL}/app/api/suricata/status?format=prometheus" \
   | grep -q suricata_alerts_processed; then
  ok "prometheus metrics expose suricata_alerts_processed"
elif command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx stdout; then
  if docker exec stdout wget -qO- --timeout=3 'http://127.0.0.1:8112/app/api/suricata/status?format=prometheus' 2>/dev/null \
     | grep -q suricata_alerts_processed; then
    ok "prometheus metrics expose suricata_alerts_processed (via stdout container)"
  else
    note "StdOut metrics not reachable (start observatory compose)"
  fi
else
  note "StdOut metrics not reachable at ${STDOUT_URL} (start observatory compose)"
fi

# Continuous processing = stdout container with SURICATA_EVE_PATH / Redis env.
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx stdout; then
  ok "stdout container running (suricata-stdout-integration)"
  # Bash substring match — avoids SIGPIPE (exit 141) under pipefail from `docker logs | grep -q`.
  suricata_logs=$(docker logs --tail 5000 stdout 2>&1 || true)
  if [[ "$suricata_logs" == *"Windlass action executed"* ]]; then
    ok "journal marker: Windlass action executed (docker logs stdout)"
  else
    note "no Windlass action log yet (inject sample via webhook or wait for live alert)"
  fi
elif systemctl is-active suricata-stdout-integration >/dev/null 2>&1; then
  ok "systemctl suricata-stdout-integration active"
else
  note "stdout not running locally (deploy: docker compose -f docker-compose.observatory.yml --profile suricata up -d)"
fi

echo
echo "=== Results: ${pass} passed, ${fail} failed, ${skip} skipped ==="
if [[ "$fail" -gt 0 ]]; then
  exit 1
fi
echo "✅ All runnable verification checks passed."
exit 0
