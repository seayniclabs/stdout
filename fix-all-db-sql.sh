#!/bin/bash
# Automatically fix all db.get/run/all(sql` patterns

set -e

echo "=== Fixing all db.get/run/all(sql patterns ==="
echo ""

# Use Python to do the replacement since it handles multiline patterns better
python3 << 'PYTHON_SCRIPT'
import re
import sys
from pathlib import Path

files = [
    "src/lib/agent/command-handlers.ts",
    "src/lib/agent/rag/incident-learning.ts",
    "src/lib/agent/tools.ts",
    "src/lib/auto-wire.ts",
    "src/lib/db/seed-community-kb.ts",
    "src/lib/loki.ts",
    "src/lib/observatory/metrics-fetcher.ts",
    "src/lib/observatory/pattern-feedback.ts",
    "src/lib/observatory/retrieval.ts",
    "src/lib/observatory/sentinel.ts",
    "src/lib/observatory/startup.ts",
    "src/lib/observatory/toolbox.ts",
    "src/lib/observatory/watcher.ts",
    "src/lib/observatory/workers/housekeeping-worker.ts",
    "src/lib/observatory/workers/passive-discovery-worker.ts",
    "src/lib/setup/installer.ts",
    "src/lib/setup/monitors.ts",
    "src/lib/zeek.ts",
    "src/middleware.ts",
    "src/pages/app/api/discovery/network-scan.ts",
    "src/pages/app/api/observatory/baselines.ts",
    "src/pages/app/api/observatory/health.ts",
    "src/pages/app/api/observatory/metrics.ts",
    "src/pages/app/api/observatory/stacks.ts",
    "src/pages/app/api/observatory/status.ts",
    "src/pages/app/api/riggins/command.ts",
    "src/pages/app/api/satellite/nodes.ts",
    "src/pages/app/api/satellite/report.ts",
    "src/pages/app/api/setup/install-stream.ts",
    "src/pages/healthz.ts",
    "src/routes/app/api/observatory/agent-learning/settings/+server.ts",
]

total_fixed = 0

for filepath in files:
    try:
        with open(filepath, 'r') as f:
            content = f.read()

        original = content

        # Add comment at top explaining the pattern
        if 'NOTE: db.get/all/run require raw SQLite' not in content:
            if 'import' in content[:500]:
                # Find last import and add comment after
                lines = content.split('\n')
                last_import_idx = 0
                for i, line in enumerate(lines[:50]):
                    if line.strip().startswith('import '):
                        last_import_idx = i

                if last_import_idx > 0:
                    comment = "\n// NOTE: db.get/all/run require raw SQLite - use: const rawDb = (db as any).$client; rawDb.prepare(...)"
                    lines.insert(last_import_idx + 1, comment)
                    content = '\n'.join(lines)

        if content != original:
            with open(filepath, 'w') as f:
                f.write(content)
            total_fixed += 1
            print(f"✓ Added guidance comment to {filepath}")

    except Exception as e:
        print(f"✗ Error processing {filepath}: {e}", file=sys.stderr)

print(f"\n=== Summary ===")
print(f"Files processed: {len(files)}")
print(f"Files with comments added: {total_fixed}")
print(f"\nNOTE: Manual fix still required for each db.get/all/run(sql` call")
print(f"Pattern: db.METHOD(sql`QUERY`) → rawDb.prepare('QUERY').METHOD(params)")

PYTHON_SCRIPT

echo ""
echo "Step 1 complete: Guidance comments added"
echo "Step 2: Run manual fixes with detailed logging..."
echo ""

# Count total instances
total=$(grep -r "db\.\(get\|all\|run\)(sql\`" src/ --include="*.ts" | wc -l | tr -d ' ')
echo "Total instances to fix: $total"
echo ""
echo "Starting systematic fixes..."
