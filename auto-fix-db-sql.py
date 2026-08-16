#!/usr/bin/env python3
"""
Automatically fix all db.get/run/all(sql` patterns in TypeScript files.
Converts to raw SQLite prepare/get/run/all pattern.
"""

import re
import sys
from pathlib import Path

def fix_db_method_sql(content: str) -> tuple[str, int]:
    """Fix all db.METHOD(sql`...`) patterns. Returns (fixed_content, count)"""

    count = 0

    # Pattern: db.METHOD(sql`...`)
    # This is complex because the sql template can span multiple lines
    # Strategy: Find each instance and convert parameterized queries to ? placeholders

    def replace_db_call(match):
        nonlocal count
        method = match.group(1)  # get, all, or run
        sql_query = match.group(2)  # The SQL query content

        # Extract ${...} parameters and replace with ?
        params = []
        def extract_param(param_match):
            params.append(param_match.group(1))
            return '?'

        # Replace ${...} with ? and collect parameters
        fixed_query = re.sub(r'\$\{([^}]+)\}', extract_param, sql_query)

        # Build the replacement
        # For .get() and .run(), we call the method with params
        # For .all(), same pattern
        param_str = ', '.join(params) if params else ''

        replacement = f"rawDb.prepare(`{fixed_query}`).{method}({param_str})"
        count += 1
        return replacement

    # Match db.METHOD(sql`...`)  where ... can be multiline
    # This regex captures the method name and the sql content
    pattern = r'db\.(get|all|run)\(sql`([^`]+)`\)'

    result = re.sub(pattern, replace_db_call, content, flags=re.MULTILINE | re.DOTALL)

    return result, count

def ensure_rawdb_declaration(content: str, function_name: str) -> str:
    """Ensure rawDb is declared at the start of the function"""

    # Find the function and check if it already has rawDb declaration
    if 'const rawDb = (db as any).$client' in content:
        return content

    # Find "const db = getDb()" and add rawDb after it
    pattern = r'(const db = getDb\(\);)'
    replacement = r'\1\n  const rawDb = (db as any).$client;'

    return re.sub(pattern, replacement, content, count=1)

def process_file(filepath: Path) -> int:
    """Process a single file. Returns number of fixes made."""

    try:
        content = filepath.read_text()
        original = content

        # Fix all db.METHOD(sql`) calls
        content, count = fix_db_method_sql(content)

        if count > 0:
            # Ensure rawDb is declared (simple approach - add after first getDb())
            if 'const db = getDb()' in content and 'const rawDb = (db as any).$client' not in content:
                content = content.replace(
                    'const db = getDb();',
                    'const db = getDb();\n  const rawDb = (db as any).$client;',
                    1
                )

        if content != original:
            filepath.write_text(content)
            return count

        return 0

    except Exception as e:
        print(f"✗ Error processing {filepath}: {e}", file=sys.stderr)
        return 0

def main():
    files = [
        Path("src/lib/agent/command-handlers.ts"),
        Path("src/lib/agent/rag/incident-learning.ts"),
        Path("src/lib/agent/tools.ts"),
        Path("src/lib/db/seed-community-kb.ts"),
        Path("src/lib/loki.ts"),
        Path("src/lib/observatory/metrics-fetcher.ts"),
        Path("src/lib/observatory/pattern-feedback.ts"),
        Path("src/lib/observatory/retrieval.ts"),
        Path("src/lib/observatory/sentinel.ts"),
        Path("src/lib/observatory/startup.ts"),
        Path("src/lib/observatory/toolbox.ts"),
        Path("src/lib/observatory/watcher.ts"),
        Path("src/lib/observatory/workers/housekeeping-worker.ts"),
        Path("src/lib/observatory/workers/passive-discovery-worker.ts"),
        Path("src/lib/setup/installer.ts"),
        Path("src/lib/setup/monitors.ts"),
        Path("src/lib/zeek.ts"),
        Path("src/pages/app/api/discovery/network-scan.ts"),
        Path("src/pages/app/api/observatory/baselines.ts"),
        Path("src/pages/app/api/observatory/health.ts"),
        Path("src/pages/app/api/observatory/metrics.ts"),
        Path("src/pages/app/api/observatory/stacks.ts"),
        Path("src/pages/app/api/observatory/status.ts"),
        Path("src/pages/app/api/riggins/command.ts"),
        Path("src/pages/app/api/satellite/nodes.ts"),
        Path("src/pages/app/api/satellite/report.ts"),
        Path("src/pages/app/api/setup/install-stream.ts"),
        Path("src/pages/healthz.ts"),
        Path("src/routes/app/api/observatory/agent-learning/settings/+server.ts"),
    ]

    total_fixes = 0
    files_fixed = 0

    for filepath in files:
        count = process_file(filepath)
        if count > 0:
            total_fixes += count
            files_fixed += 1
            print(f"✓ Fixed {count} instances in {filepath}")

    print(f"\n=== Summary ===")
    print(f"Files processed: {len(files)}")
    print(f"Files fixed: {files_fixed}")
    print(f"Total instances fixed: {total_fixes}")

if __name__ == "__main__":
    main()
