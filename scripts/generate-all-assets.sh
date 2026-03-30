#!/bin/bash
# ============================================================================
# Master Marketing Asset Pipeline
# ============================================================================
# Runs the full automated pipeline:
#   1. Playwright desktop screenshots (StdOut)
#   2. Mobile screenshots (StdOut, Hone, Enchapter)
#   3. Demo video from screenshots (Ken Burns + transitions)
#
# Usage:
#   cd ~/Projects/stdout
#   bash scripts/generate-all-assets.sh [screenshots|mobile|video|all]
#
# Output:
#   marketing-assets/
#   ├── raw/              # Raw desktop screenshots
#   ├── product-hunt/     # PH gallery (1270x760, browser-framed)
#   ├── social/           # OG/social cards (1200x630)
#   ├── mobile/           # Phone/tablet screenshots (framed)
#   └── video/            # Demo videos (16:9 + 1:1 social)
#
# All text is programmatic — zero AI-rendered text in any asset.
# ============================================================================

set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-all}"

echo "========================================"
echo "  Marketing Asset Pipeline"
echo "  $(date '+%Y-%m-%d %H:%M')"
echo "========================================"
echo ""

# Step 1: Desktop screenshots
run_screenshots() {
  echo "--- Step 1: Desktop Screenshots ---"
  echo "  Running Playwright screenshot pipeline..."
  echo "  NOTE: Browser will open. Complete OIDC login if prompted."
  echo ""
  npx tsx scripts/screenshot-assets.ts
  echo ""
}

# Step 2: Mobile screenshots
run_mobile() {
  echo "--- Step 2: Mobile Screenshots ---"
  bash scripts/capture-mobile.sh all
  echo ""
}

# Step 3: Generate video
run_video() {
  echo "--- Step 3: Demo Video ---"
  bash scripts/generate-video.sh
  echo ""
}

# Dispatch
case "$MODE" in
  screenshots) run_screenshots ;;
  mobile) run_mobile ;;
  video) run_video ;;
  all)
    run_screenshots
    run_mobile
    run_video
    ;;
  *)
    echo "Usage: $0 [screenshots|mobile|video|all]"
    exit 1
    ;;
esac

echo "========================================"
echo "  Pipeline Complete"
echo "========================================"
echo ""
echo "Assets in: ~/Projects/stdout/marketing-assets/"
ls -la ~/Projects/stdout/marketing-assets/*/ 2>/dev/null | grep -E "^total|\.png|\.mp4" | head -30
echo ""
echo "Next steps:"
echo "  1. Review screenshots in marketing-assets/product-hunt/"
echo "  2. Review demo video in marketing-assets/video/"
echo "  3. Upload PH images to producthunt.com ship page"
echo "  4. Attach video to social posts"
