#!/bin/bash
# ============================================================================
# Mobile Screenshot Capture — Simulator + Playwright
# ============================================================================
# Captures mobile views of StdOut, Hone, and Enchapter for marketing assets.
#
# Prerequisites:
#   - Xcode with simulators (for Enchapter iOS)
#   - Playwright (for StdOut/Hone mobile web views)
#   - npx tsx (for Playwright script)
#
# Usage:
#   bash scripts/capture-mobile.sh [enchapter|web|all]
#
# Output:
#   marketing-assets/mobile/
# ============================================================================

set -euo pipefail

ASSETS_DIR="$HOME/Projects/stdout/marketing-assets"
MOBILE_DIR="$ASSETS_DIR/mobile"
mkdir -p "$MOBILE_DIR"

MODE="${1:-all}"

# ---- Enchapter iOS Simulator Screenshots ----
capture_enchapter() {
  echo "=== Enchapter iOS Screenshots ==="

  DEVICE="iPhone 17"
  DEVICE_ID=$(xcrun simctl list devices available | grep "$DEVICE" | head -1 | grep -oE '[0-9A-F-]{36}')

  if [ -z "$DEVICE_ID" ]; then
    echo "  ERROR: $DEVICE simulator not found"
    return 1
  fi

  # Boot if not running
  STATE=$(xcrun simctl list devices | grep "$DEVICE_ID" | grep -oE '\(Booted\)|\(Shutdown\)')
  if [ "$STATE" != "(Booted)" ]; then
    echo "  Booting $DEVICE..."
    xcrun simctl boot "$DEVICE_ID"
    sleep 5
  fi

  echo "  Device: $DEVICE ($DEVICE_ID)"

  # Launch Enchapter (bundle ID from the StoryChat project)
  BUNDLE_ID="com.seayniclabs.storychat"
  echo "  Launching $BUNDLE_ID..."
  xcrun simctl launch "$DEVICE_ID" "$BUNDLE_ID" 2>/dev/null || {
    echo "  WARNING: Could not launch Enchapter. Is it installed on the simulator?"
    echo "  Install from Xcode: Product > Destination > $DEVICE, then Run"
    return 1
  }

  # Wait for app to load
  sleep 3

  # Capture screenshots at key screens
  # Note: Navigation between screens requires accessibility automation (XCUITest)
  # or manual intervention. This captures whatever screen is currently visible.
  echo "  Capturing current screen..."
  xcrun simctl io "$DEVICE_ID" screenshot "$MOBILE_DIR/enchapter-screen-1.png"
  echo "    Saved: enchapter-screen-1.png"

  echo ""
  echo "  For additional screens, navigate in the simulator and run:"
  echo "    xcrun simctl io $DEVICE_ID screenshot $MOBILE_DIR/enchapter-screen-N.png"
  echo ""
  echo "  Recommended captures:"
  echo "    1. Library view (book grid)"
  echo "    2. Reading view (chat bubbles)"
  echo "    3. Draw/phonics view"
  echo "    4. My Library with streak/progress"
  echo ""

  # Add iPhone frame to screenshot
  echo "  Adding device frame..."
  generate_phone_frame "$MOBILE_DIR/enchapter-screen-1.png" "$MOBILE_DIR/enchapter-framed-1.png" "Enchapter"
}

# ---- StdOut + Hone Mobile Web Screenshots ----
capture_web_mobile() {
  echo "=== Mobile Web Screenshots (Playwright) ==="

  # Create a temporary Playwright script for mobile captures
  SCRIPT=$(mktemp /tmp/mobile-capture-XXXXX.ts)
  cat > "$SCRIPT" << 'TSEOF'
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';

const MOBILE_DIR = join(process.env.HOME!, 'Projects/stdout/marketing-assets/mobile');
mkdirSync(MOBILE_DIR, { recursive: true });

const iPhone = devices['iPhone 15 Pro'];
const iPad = devices['iPad Pro 11'];

interface CaptureSpec {
  name: string;
  url: string;
  device: typeof iPhone;
  waitFor?: string;
  actions?: string;
}

const captures: CaptureSpec[] = [
  // StdOut mobile
  { name: 'stdout-mobile-dashboard', url: 'http://localhost:8112/app', device: iPhone },
  { name: 'stdout-mobile-stacks', url: 'http://localhost:8112/app/stacks', device: iPhone },
  { name: 'stdout-mobile-incidents', url: 'http://localhost:8112/app/incidents', device: iPhone },
  { name: 'stdout-tablet-dashboard', url: 'http://localhost:8112/app', device: iPad },

  // Hone mobile
  { name: 'hone-mobile-landing', url: 'http://localhost:8101', device: iPhone },
  { name: 'hone-mobile-tracks', url: 'http://localhost:8101/tracks', device: iPhone },
  { name: 'hone-mobile-certs', url: 'http://localhost:8101/certifications', device: iPhone },
  { name: 'hone-tablet-landing', url: 'http://localhost:8101', device: iPad },

  // Enchapter site mobile
  { name: 'enchapter-site-mobile', url: 'http://localhost:8103', device: iPhone },
  { name: 'enchapter-site-tablet', url: 'http://localhost:8103', device: iPad },
];

async function run() {
  const browser = await chromium.launch({ headless: false });

  for (const spec of captures) {
    console.log(`  Capturing: ${spec.name}`);
    const context = await browser.newContext({ ...spec.device });
    const page = await context.newPage();

    try {
      await page.goto(spec.url, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(1000); // settle animations

      await page.screenshot({
        path: join(MOBILE_DIR, `${spec.name}.png`),
        fullPage: false,
      });
      console.log(`    Saved: ${spec.name}.png`);
    } catch (e: any) {
      console.log(`    SKIP (${e.message?.substring(0, 60)})`);
    }

    await context.close();
  }

  // Manual login notice for authenticated pages
  console.log('\n  Note: Authenticated pages (dashboard, stacks, incidents)');
  console.log('  may need manual login. Re-run after logging in if screenshots');
  console.log('  show login pages instead of app content.\n');

  await browser.close();
}

run().catch(console.error);
TSEOF

  cd ~/Projects/stdout && npx tsx "$SCRIPT" 2>/dev/null
  rm -f "$SCRIPT"
}

# ---- Phone Frame Generator ----
generate_phone_frame() {
  local INPUT="$1"
  local OUTPUT="$2"
  local LABEL="${3:-}"

  # Create an HTML template with phone frame, render with Chrome headless
  local FRAME_HTML=$(mktemp /tmp/phone-frame-XXXXX.html)

  cat > "$FRAME_HTML" << HTMLEOF
<!DOCTYPE html>
<html><head><style>
  body { margin: 0; padding: 60px; background: #0A0B10; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
  .phone { position: relative; width: 390px; border-radius: 48px; border: 4px solid #2A2D42; background: #000; padding: 16px 12px; box-shadow: 0 25px 80px rgba(0,0,0,0.6), 0 0 120px rgba(249,115,22,0.08); }
  .phone::before { content: ''; position: absolute; top: 12px; left: 50%; transform: translateX(-50%); width: 120px; height: 28px; background: #000; border-radius: 14px; z-index: 10; }
  .phone img { width: 100%; border-radius: 36px; display: block; }
  .label { text-align: center; margin-top: 24px; font-family: 'SF Pro Display', -apple-system, sans-serif; font-size: 18px; color: #E2E4EA; font-weight: 600; letter-spacing: -0.01em; }
</style></head><body>
  <div>
    <div class="phone"><img src="file://${INPUT}"></div>
    ${LABEL:+<div class="label">${LABEL}</div>}
  </div>
</body></html>
HTMLEOF

  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --headless --disable-gpu --no-sandbox \
    --window-size=600,900 \
    --screenshot="$OUTPUT" \
    "file://$FRAME_HTML" 2>/dev/null

  rm -f "$FRAME_HTML"
  echo "    Framed: $(basename $OUTPUT)"
}

# ---- Main ----
case "$MODE" in
  enchapter)
    capture_enchanter
    ;;
  web)
    capture_web_mobile
    ;;
  all)
    capture_web_mobile
    capture_enchapter
    ;;
  *)
    echo "Usage: $0 [enchapter|web|all]"
    exit 1
    ;;
esac

echo ""
echo "=== Mobile assets saved to $MOBILE_DIR ==="
echo "All text overlays are programmatic — zero AI-rendered text."
