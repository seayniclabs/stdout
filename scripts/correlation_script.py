#!/usr/bin/env python3
"""
Suricata TOOL1 correlation dry-run (ops-facing entrypoint).

StdOut implements classify/correlate in Node (`src/lib/suricata-core.mjs`).
This wrapper preserves the brief's `python3 correlation_script.py` path:

  cat fixtures/sample_eve.json | python3 scripts/correlation_script.py
  # → prints "Windlass action triggered" / "Windlass action executed …"

Does NOT call Windlass and does NOT log IPs or full alert payloads.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def resolve_paths() -> tuple[Path, Path]:
    """Support repo layout (scripts/) and brief deploy (/opt/stdout/correlation_script.py)."""
    # Repo / deploy-with-scripts/: …/scripts/correlation_script.py
    if HERE.name == "scripts":
        root = HERE.parent
        node = root / "scripts" / "suricata-functional-test.mjs"
        if node.is_file():
            return root, node
    # Brief path: /opt/stdout/correlation_script.py
    root = HERE
    node = root / "scripts" / "suricata-functional-test.mjs"
    if node.is_file():
        return root, node
    node = root / "suricata-functional-test.mjs"
    return root, node


def main() -> int:
    root, node_script = resolve_paths()
    if not node_script.is_file():
        print(f"missing {node_script}", file=sys.stderr)
        return 1
    return subprocess.call(
        ["node", str(node_script), *sys.argv[1:]],
        stdin=sys.stdin,
        cwd=str(root),
    )


if __name__ == "__main__":
    raise SystemExit(main())
