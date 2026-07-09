#!/bin/sh
# Tail Suricata EVE JSON and publish alert lines to a Redis stream (XADD).
# Alternative to pip suricata-eve-stream — used when StdOut ingests via XREADGROUP.
#
# Uses offset polling (not inotify tail -F) so shared Docker volumes receive writes
# from the Suricata container reliably.
#
# Env:
#   EVE_PATH=/var/log/suricata/eve.json
#   REDIS_URL=redis://127.0.0.1:6379/0
#   REDIS_STREAM=eve_alerts
#   POLL_INTERVAL_SEC=1
set -eu

EVE_PATH="${EVE_PATH:-/var/log/suricata/eve.json}"
REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379/0}"
REDIS_STREAM="${REDIS_STREAM:-eve_alerts}"
POLL_INTERVAL_SEC="${POLL_INTERVAL_SEC:-1}"

redis_ping() {
  if command -v redis-cli >/dev/null 2>&1; then
    redis-cli -u "$REDIS_URL" ping 2>/dev/null | grep -qi pong
    return $?
  fi
  return 127
}

redis_xadd() {
  local line="$1"
  local attempt=0
  local max_attempts=5
  local delay=1

  if ! command -v redis-cli >/dev/null 2>&1; then
    return 127
  fi

  while [ "$attempt" -lt "$max_attempts" ]; do
    if redis_ping && redis-cli -u "$REDIS_URL" --raw \
         XADD "$REDIS_STREAM" '*' event "$line" >/dev/null 2>&1; then
      return 0
    fi
    attempt=$((attempt + 1))
    if [ "$attempt" -lt "$max_attempts" ]; then
      sleep "$delay"
      delay=$((delay * 2))
      [ "$delay" -gt 30 ] && delay=30
    fi
  done
  return 1
}

is_alert_line() {
  case "$1" in
    *'"event_type":"alert"'*|*'"event_type": "alert"'*) return 0 ;;
    *) return 1 ;;
  esac
}

publish_line() {
  local line="$1"
  [ -z "$line" ] && return 0
  if is_alert_line "$line"; then
    redis_xadd "$line" || echo "[eve-redis-bridge] XADD failed" >&2
  fi
}

mkdir -p "$(dirname "$EVE_PATH")" 2>/dev/null || true
while [ ! -f "$EVE_PATH" ]; do
  echo "[eve-redis-bridge] waiting for $EVE_PATH" >&2
  sleep 2
done

echo "[eve-redis-bridge] poll $EVE_PATH → XADD $REDIS_STREAM ($REDIS_URL)"

offset=$(wc -c < "$EVE_PATH" 2>/dev/null | tr -d ' ' || echo 0)
partial=""

while true; do
  if [ ! -f "$EVE_PATH" ]; then
    offset=0
    partial=""
    sleep "$POLL_INTERVAL_SEC"
    continue
  fi

  size=$(wc -c < "$EVE_PATH" 2>/dev/null | tr -d ' ' || echo 0)

  # Rotation: file shrank — restart from beginning.
  if [ "$size" -lt "$offset" ]; then
    offset=0
    partial=""
  fi

  if [ "$size" -gt "$offset" ]; then
    chunk=$(dd if="$EVE_PATH" bs=1 skip="$offset" count=$((size - offset)) 2>/dev/null || true)
    offset=$size
    data="${partial}${chunk}"
    partial=""

    while [ -n "$data" ]; do
      case "$data" in
        *'
'*)
          line="${data%%$'\n'*}"
          data="${data#*$'\n'}"
          publish_line "$line"
          ;;
        *)
          partial="$data"
          data=""
          ;;
      esac
    done
  fi

  sleep "$POLL_INTERVAL_SEC"
done
