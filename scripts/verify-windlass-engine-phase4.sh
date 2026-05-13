#!/usr/bin/env bash
# Operator / CI helper: verify the Windlass Python engine checkout exposes Phase 4 symbols.
# Usage: WINDLASS_ROOT=~/Projects/windlass ./scripts/verify-windlass-engine-phase4.sh
set -euo pipefail
ROOT="${WINDLASS_ROOT:-$HOME/Projects/windlass}"
FILE="$ROOT/windlass.py"
if [[ ! -f "$FILE" ]]; then
  echo "FAIL: expected engine at $FILE (set WINDLASS_ROOT to your checkout)." >&2
  exit 1
fi

need() {
  local pat="$1"
  local msg="$2"
  grep -q "$pat" "$FILE" || { echo "FAIL: $msg (missing pattern: $pat)" >&2; exit 1; }
}

need 'MEMORY_SHED_FREE_MB_THRESHOLD' 'memory-pressure shed threshold'
need 'last_memory_shed_reason' 'per-service memory shed reason in status payload'
need 'memory_shed' 'memory_shed events / actions'
need 'service_analytics' 'usage analytics in status payload'
grep -qE 'get_n8n_workflow_windows|n8n_workflow_windows' "$FILE" || { echo "FAIL: n8n workflow windows merge" >&2; exit 1; }
need 'execute_command' 'exec endpoint gate'

echo "OK: Windlass engine Phase 4 surface checks passed for $FILE"
