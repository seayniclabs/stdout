/**
 * StdOut Marketing Asset Generator
 *
 * Captures live screenshots from the running StdOut app and wraps them
 * in macOS-style browser chrome frames for Product Hunt, social, and OG images.
 *
 * Usage:
 *   npx tsx scripts/screenshot-assets.ts
 *
 * Prerequisites:
 *   - StdOut running at http://localhost:8112 (or set STDOUT_URL env var)
 *   - Playwright browsers installed: npx playwright install chromium
 *   - tsx installed: npm i -D tsx (already a transitive dep in most Astro projects)
 *
 * Authentication:
 *   The app uses OIDC/Authentik. The script pauses for 30s on the login page
 *   to let you complete SSO manually in the launched browser. After login,
 *   it stores session cookies and reuses them for all subsequent screenshots.
 *
 * Output:
 *   ~/Projects/stdout/marketing-assets/
 *     raw/          - unframed screenshots
 *     product-hunt/ - 1270x760 framed gallery images
 *     social/       - 1200x630 OG/social cards
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = process.env.STDOUT_URL || 'http://localhost:8112';
const OUTPUT_DIR = path.resolve(__dirname, '../marketing-assets');
const FRAME_TEMPLATE = path.resolve(__dirname, 'browser-frame.html');

// Product Hunt gallery: 1270x760
const PH_WIDTH = 1270;
const PH_HEIGHT = 760;

// Video-quality captures: 1920x1080 (for Creatomate/Remotion)
const VIDEO_WIDTH = 1920;
const VIDEO_HEIGHT = 1080;

// Social/OG card: 1200x630
const SOCIAL_WIDTH = 1200;
const SOCIAL_HEIGHT = 630;

// Inner screenshot dimensions (frame chrome eats ~40px top for title bar)
const FRAME_CHROME_HEIGHT = 40;

// Brand colors
const BRAND = {
  bg: '#0A0B10',
  bgAlt: '#07070C',
  accent: '#F97316',
  accentLight: '#FB923C',
  text: '#F0F0F8',
  textMuted: '#A0A0B8',
  textDim: '#5A5A72',
};

// ---------------------------------------------------------------------------
// Screenshot definitions
// ---------------------------------------------------------------------------

interface ScreenshotDef {
  name: string;
  route: string;
  /** Description for the address bar in the browser frame */
  addressBarUrl: string;
  /** Viewport width for the raw capture */
  viewportWidth: number;
  /** Viewport height for the raw capture */
  viewportHeight: number;
  /** Optional setup steps before capture (click nav, wait for element, etc.) */
  setup?: (page: Page) => Promise<void>;
}

const productHuntScreenshots: ScreenshotDef[] = [
  {
    name: '01-hud-dashboard',
    route: '/app/hud',
    addressBarUrl: 'stdout.seayniclabs.com/app/hud',
    viewportWidth: PH_WIDTH,
    viewportHeight: PH_HEIGHT - FRAME_CHROME_HEIGHT,
    setup: async (page) => {
      // Wait for HUD gauges/status cards to render
      await page.waitForSelector('[data-testid="hud"], .hud-grid, .dashboard, main', {
        timeout: 10000,
      }).catch(() => {});
      await page.waitForTimeout(1500); // let animations settle
    },
  },
  {
    name: '02-scanner-results',
    route: '/app/stacks',
    addressBarUrl: 'stdout.seayniclabs.com/app/stacks',
    viewportWidth: PH_WIDTH,
    viewportHeight: PH_HEIGHT - FRAME_CHROME_HEIGHT,
    setup: async (page) => {
      // Wait for stack/service cards to populate
      await page.waitForSelector('.stack-card, .service-card, table, main', {
        timeout: 10000,
      }).catch(() => {});
      await page.waitForTimeout(1000);
    },
  },
  {
    name: '03-incident-detail',
    route: '/app/incidents/demo-nginx-502-1774898333',
    addressBarUrl: 'stdout.seayniclabs.com/app/incidents/nginx-502',
    viewportWidth: PH_WIDTH,
    viewportHeight: PH_HEIGHT - FRAME_CHROME_HEIGHT,
    setup: async (page) => {
      // Wait for incident detail with diagnosis + resolution to render
      await page.waitForSelector('main h1, main h2, .incident-detail, .diagnosis', {
        timeout: 10000,
      }).catch(() => {});
      await page.waitForTimeout(2000); // let all sections render
    },
  },
  {
    name: '04-knowledge-base',
    route: '/app/search',
    addressBarUrl: 'stdout.seayniclabs.com/app/search',
    viewportWidth: PH_WIDTH,
    viewportHeight: PH_HEIGHT - FRAME_CHROME_HEIGHT,
    setup: async (page) => {
      // Focus search and type a sample query to show results
      const searchInput = page.locator('input[type="search"], input[name="q"], input[placeholder*="earch"]').first();
      try {
        await searchInput.waitFor({ timeout: 5000 });
        await searchInput.fill('nginx proxy timeout');
        await page.waitForTimeout(1500); // let search results render
      } catch {
        console.log('  No search input found, capturing as-is');
      }
    },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDirs() {
  for (const sub of ['raw', 'product-hunt', 'social']) {
    fs.mkdirSync(path.join(OUTPUT_DIR, sub), { recursive: true });
  }
}

/**
 * Build a browser-frame HTML page with the screenshot embedded.
 * Returns path to the temporary HTML file.
 */
function buildFrameHtml(
  screenshotPath: string,
  addressBarUrl: string,
  outerWidth: number,
  outerHeight: number,
  innerWidth: number,
  innerHeight: number,
): string {
  let template = fs.readFileSync(FRAME_TEMPLATE, 'utf-8');

  // Absolute file:// path for the embedded image
  const imgSrc = `file://${screenshotPath}`;

  template = template
    .replace(/__WIDTH__/g, String(outerWidth))
    .replace(/__HEIGHT__/g, String(outerHeight))
    .replace(/__INNER_WIDTH__/g, String(innerWidth))
    .replace(/__INNER_HEIGHT__/g, String(innerHeight))
    .replace(/__URL__/g, addressBarUrl)
    .replace(/__SCREENSHOT_PATH__/g, imgSrc);

  const tmpPath = path.join(OUTPUT_DIR, '_frame-tmp.html');
  fs.writeFileSync(tmpPath, template);
  return tmpPath;
}

/**
 * Generate the branded social/OG card as a standalone HTML page.
 */
function buildSocialCardHtml(): string {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=${SOCIAL_WIDTH}">
<title>StdOut Social Card</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    width: ${SOCIAL_WIDTH}px;
    height: ${SOCIAL_HEIGHT}px;
    overflow: hidden;
    background: ${BRAND.bg};
    font-family: 'Inter', -apple-system, system-ui, sans-serif;
    color: ${BRAND.text};
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }

  /* Grid background */
  body::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(249, 115, 22, 0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(249, 115, 22, 0.03) 1px, transparent 1px);
    background-size: 40px 40px;
  }

  /* Top glow */
  body::after {
    content: '';
    position: absolute;
    top: -100px;
    left: 50%;
    transform: translateX(-50%);
    width: 600px;
    height: 400px;
    background: radial-gradient(ellipse, rgba(249, 115, 22, 0.1) 0%, transparent 70%);
    pointer-events: none;
  }

  .container {
    position: relative;
    z-index: 1;
    text-align: center;
    max-width: 800px;
    padding: 0 40px;
  }

  .logo {
    width: 80px;
    height: 80px;
    border-radius: 18px;
    background: linear-gradient(135deg, ${BRAND.accent}, #E8650F);
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 32px;
    box-shadow: 0 0 40px rgba(249, 115, 22, 0.3), 0 0 80px rgba(249, 115, 22, 0.1);
  }

  .logo span {
    font-family: 'JetBrains Mono', monospace;
    font-weight: 700;
    font-size: 32px;
    color: #fff;
    letter-spacing: -1px;
  }

  .product-name {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 56px;
    font-weight: 700;
    letter-spacing: -2px;
    margin-bottom: 16px;
    background: linear-gradient(180deg, ${BRAND.text} 30%, ${BRAND.textMuted} 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .tagline {
    font-size: 22px;
    font-weight: 400;
    color: ${BRAND.textMuted};
    margin-bottom: 28px;
    letter-spacing: -0.3px;
  }

  .tagline em {
    color: ${BRAND.accentLight};
    font-style: normal;
    font-weight: 500;
  }

  .meta {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 24px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    color: ${BRAND.textDim};
  }

  .meta .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: ${BRAND.accent};
    box-shadow: 0 0 6px rgba(249, 115, 22, 0.4);
  }

  .meta .item {
    display: flex;
    align-items: center;
    gap: 6px;
  }
</style>
</head>
<body>
  <div class="container">
    <div class="logo"><span>&gt;_</span></div>
    <h1 class="product-name">StdOut</h1>
    <p class="tagline"><em>AI-powered</em> incident companion for self-hosters</p>
    <div class="meta">
      <div class="item"><span class="dot"></span><span>Self-hosted</span></div>
      <div class="item"><span class="dot"></span><span>Your stack, your data</span></div>
      <div class="item"><span class="dot"></span><span>One-time license</span></div>
    </div>
  </div>
</body>
</html>`;

  const tmpPath = path.join(OUTPUT_DIR, '_social-card-tmp.html');
  fs.writeFileSync(tmpPath, html);
  return tmpPath;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('StdOut Marketing Asset Generator');
  console.log('================================\n');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Output: ${OUTPUT_DIR}\n`);

  ensureDirs();

  // Direct session injection — bypass OIDC entirely.
  // A screenshot-bot user + session exists in the StdOut SQLite DB.
  // We just inject the sl_session cookie and go.
  const SESSION_FILE = '/Volumes/data/secrets/screenshot_bot_session';
  const sessionId = fs.readFileSync(SESSION_FILE, 'utf-8').trim();

  const browser: Browser = await chromium.launch({
    headless: true,
    args: ['--disable-web-security'],
  });

  const context: BrowserContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: PH_WIDTH, height: PH_HEIGHT },
  });

  // Inject session cookie before any navigation
  await context.addCookies([{
    name: 'sl_session',
    value: sessionId,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
  }]);

  const page: Page = await context.newPage();

  // ------------------------------------------------------------------
  // Step 1: Verify authentication
  // ------------------------------------------------------------------
  console.log('Step 1: Verifying session cookie...');
  await page.goto(`${BASE_URL}/app`, { waitUntil: 'networkidle' });

  const currentUrl = page.url();
  const isLoggedIn = !currentUrl.includes('/login') && !currentUrl.includes('authentik');

  if (isLoggedIn) {
    console.log(`  Authenticated via session cookie. At: ${currentUrl}\n`);
  } else {
    console.log('  WARNING: Session cookie rejected. The session may have expired.');
    console.log('  Re-create it: see scripts/screenshot-assets.ts header comments.\n');
    console.log(`  Current URL: ${currentUrl}\n`);
  }

  // ------------------------------------------------------------------
  // Step 2: Product Hunt gallery screenshots (1270x760)
  // ------------------------------------------------------------------
  console.log('Step 2: Capturing Product Hunt gallery screenshots (1270x760)...\n');

  for (const def of productHuntScreenshots) {
    console.log(`  Capturing: ${def.name}`);

    await page.setViewportSize({
      width: def.viewportWidth,
      height: def.viewportHeight,
    });

    await page.goto(`${BASE_URL}${def.route}`, { waitUntil: 'networkidle' });

    if (def.setup) {
      await def.setup(page);
    }

    // Raw screenshot
    const rawPath = path.join(OUTPUT_DIR, 'raw', `${def.name}.png`);
    await page.screenshot({ path: rawPath, fullPage: false });
    console.log(`    Raw: ${rawPath}`);

    // Wrap in browser frame
    const frameHtml = buildFrameHtml(
      rawPath,
      def.addressBarUrl,
      PH_WIDTH,
      PH_HEIGHT,
      def.viewportWidth,
      def.viewportHeight,
    );

    await page.setViewportSize({ width: PH_WIDTH, height: PH_HEIGHT });
    await page.goto(`file://${frameHtml}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500); // let fonts + image load

    const framedPath = path.join(OUTPUT_DIR, 'product-hunt', `${def.name}.png`);
    await page.screenshot({ path: framedPath, fullPage: false });
    console.log(`    Framed: ${framedPath}`);
  }

  // ------------------------------------------------------------------
  // Step 2b: Video-quality screenshots (1920x1080) for Creatomate/Remotion
  // ------------------------------------------------------------------
  console.log('\nStep 2b: Capturing video-quality screenshots (1920x1080)...\n');

  const videoDir = path.join(OUTPUT_DIR, 'video-src');
  fs.mkdirSync(videoDir, { recursive: true });

  for (const def of productHuntScreenshots) {
    console.log(`  Capturing (1080p): ${def.name}`);

    await page.setViewportSize({
      width: VIDEO_WIDTH,
      height: VIDEO_HEIGHT,
    });

    await page.goto(`${BASE_URL}${def.route}`, { waitUntil: 'networkidle' });

    if (def.setup) {
      await def.setup(page);
    }

    const videoPath = path.join(videoDir, `${def.name}.png`);
    await page.screenshot({ path: videoPath, fullPage: false });
    console.log(`    Saved: ${videoPath}`);
  }

  // ------------------------------------------------------------------
  // Step 3: Social/OG card (1200x630)
  // ------------------------------------------------------------------
  console.log('\nStep 3: Generating social/OG card (1200x630)...\n');

  await page.setViewportSize({ width: SOCIAL_WIDTH, height: SOCIAL_HEIGHT });
  const socialHtml = buildSocialCardHtml();
  await page.goto(`file://${socialHtml}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000); // let Google Fonts load

  const socialPath = path.join(OUTPUT_DIR, 'social', 'og-card.png');
  await page.screenshot({ path: socialPath, fullPage: false });
  console.log(`  Social card: ${socialPath}`);

  // ------------------------------------------------------------------
  // Cleanup
  // ------------------------------------------------------------------
  // Remove temp HTML files
  for (const tmp of ['_frame-tmp.html', '_social-card-tmp.html']) {
    const tmpPath = path.join(OUTPUT_DIR, tmp);
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }

  await browser.close();

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  console.log('\n================================');
  console.log('Done. Generated assets:\n');

  const walk = (dir: string, prefix = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        console.log(`  ${prefix}${entry.name}/`);
        walk(path.join(dir, entry.name), prefix + '  ');
      } else if (entry.name.endsWith('.png')) {
        const stats = fs.statSync(path.join(dir, entry.name));
        const kb = Math.round(stats.size / 1024);
        console.log(`  ${prefix}${entry.name} (${kb} KB)`);
      }
    }
  };
  walk(OUTPUT_DIR);

  console.log(`\nFiles saved to: ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
