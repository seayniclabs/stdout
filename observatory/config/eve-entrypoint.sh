#!/bin/sh
# Suricata container entrypoint — live IDS when capture works, EVE sim fallback otherwise.
# Production (Linux + eth0): SURICATA_IFACE=eth0 SURICATA_SIM_FALLBACK=false
# Dev (Docker Desktop / missing iface): auto-falls back to periodic sample alerts.
set -eu

IFACE="${SURICATA_IFACE:-any}"
CONFIG="${SURICATA_CONFIG:-/etc/suricata/suricata.yaml}"
EVE="${SURICATA_EVE_PATH:-/var/log/suricata/eve.json}"
SIM="${SURICATA_SIM_FALLBACK:-true}"
SIM_INTERVAL="${SURICATA_SIM_INTERVAL_SEC:-120}"

mkdir -p "$(dirname "$EVE")"
touch "$EVE"

run_sim() {
  echo "[suricata-entry] EVE simulator — interval=${SIM_INTERVAL}s (no live capture on ${IFACE})"
  while true; do
    TS="$(date -u +"%Y-%m-%dT%H:%M:%S.000000+0000")"
    printf '%s\n' \
      "{\"timestamp\":\"${TS}\",\"event_type\":\"alert\",\"src_ip\":\"203.0.113.50\",\"src_port\":54321,\"dest_ip\":\"192.168.1.10\",\"dest_port\":22,\"proto\":\"TCP\",\"alert\":{\"action\":\"allowed\",\"gid\":1,\"signature_id\":2001219,\"rev\":1,\"signature\":\"ET SCAN Potential SSH Scan (sim)\",\"category\":\"Attempted Information Leak\",\"severity\":1}}" \
      >> "$EVE"
    sleep "$SIM_INTERVAL"
  done
}

if [ "$SIM" = "false" ] || [ "$SIM" = "0" ] || [ "$SIM" = "no" ]; then
  echo "[suricata-entry] Live capture only (sim fallback disabled) on ${IFACE}"
  exec suricata -c "$CONFIG" -i "$IFACE"
fi

if ! suricata -T -c "$CONFIG" >/dev/null 2>&1; then
  echo "[suricata-entry] suricata -T failed — using EVE sim" >&2
  run_sim
fi

# Probe live capture briefly; af-packet on 'any' often fails on Docker Desktop.
suricata -c "$CONFIG" -i "$IFACE" &
pid=$!
sleep 4
if kill -0 "$pid" 2>/dev/null; then
  echo "[suricata-entry] Live capture on ${IFACE} (pid ${pid})"
  wait "$pid"
  exit $?
fi

echo "[suricata-entry] Live capture failed on ${IFACE} — EVE sim fallback" >&2
run_sim
