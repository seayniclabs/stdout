/**
 * StdOut Product Demo Video — Creatomate Render Script
 *
 * Generates a 25-second product demo video using the Creatomate Node.js SDK.
 * No template needed — builds the video programmatically from screenshots + text.
 *
 * Prerequisites:
 *   1. Sign up at https://creatomate.com (no credit card required, 50 free API credits)
 *   2. Get your API key from Project Settings → API Key
 *   3. Save the key: echo "YOUR_KEY" > /Volumes/data/secrets/creatomate-api-key.txt
 *   4. Install the SDK: cd ~/Projects/stdout && npm install creatomate
 *
 * Usage:
 *   npx tsx scripts/creatomate-video.ts
 *
 * The script reads the API key from /Volumes/data/secrets/creatomate-api-key.txt
 * or falls back to the CREATOMATE_API_KEY environment variable.
 *
 * Output: The Creatomate API returns a URL to the rendered MP4.
 *         Download it to marketing-assets/ for distribution.
 *
 * Cost: ~14 credits per minute of 720p video at 25fps.
 *       This 25-second video should cost ~6 credits (well within the 50 free).
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import Creatomate from 'creatomate';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SECRETS_PATH = '/Volumes/data/secrets/creatomate-api-key.txt';

const BRAND = {
  bg: '#0A0B10',
  accent: '#F97316',
  text: '#E2E4EA',
  textMuted: '#9CA3AF',
  fontHeading: 'Space Grotesk',
  fontBody: 'Inter',
  fontMono: 'JetBrains Mono',
} as const;

// Screenshots must be publicly accessible URLs for the Creatomate API.
// Before running, upload these to a public location (e.g., GitHub raw, S3, or
// charlieseay.com/assets/) and replace the URLs below.
//
// Local paths for reference:
//   ~/Projects/stdout/marketing-assets/raw/01-hud-dashboard.png
//   ~/Projects/stdout/marketing-assets/raw/02-scanner-results.png
//   ~/Projects/stdout/marketing-assets/raw/03-incident-detail.png
//   ~/Projects/stdout/marketing-assets/raw/04-knowledge-base.png

const SCREENSHOTS = {
  hud: 'https://charlieseay.com/assets/stdout/01-hud-dashboard.png',
  scanner: 'https://charlieseay.com/assets/stdout/02-scanner-results.png',
  incident: 'https://charlieseay.com/assets/stdout/03-incident-detail.png',
  knowledge: 'https://charlieseay.com/assets/stdout/04-knowledge-base.png',
};

// Scene definitions
const SCENES = [
  {
    label: 'intro',
    duration: 5,
    headline: 'StdOut',
    subline: "Your infrastructure's incident companion",
  },
  {
    label: 'hud',
    duration: 8,
    screenshot: SCREENSHOTS.hud,
    headline: 'Real-Time HUD',
    subline: 'Uptime gauges, response times, and service health at a glance',
  },
  {
    label: 'scanner',
    duration: 8,
    screenshot: SCREENSHOTS.scanner,
    headline: 'Auto-Discovery',
    subline: 'Scanner found 47 services on a single Mac Mini in seconds',
  },
  {
    label: 'incident',
    duration: 8,
    screenshot: SCREENSHOTS.incident,
    headline: 'AI Root Cause Analysis',
    subline: 'Four causes identified. Suggested commands ready to run.',
  },
  {
    label: 'knowledge',
    duration: 8,
    screenshot: SCREENSHOTS.knowledge,
    headline: 'Living Knowledge Base',
    subline: 'Every fix becomes searchable. Never re-solve the same problem.',
  },
  {
    label: 'outro',
    duration: 6,
    headline: 'Try StdOut Free',
    subline: 'store.seayniclabs.com',
    extra: '$149 self-hosted — no subscription, ever',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadApiKey(): string {
  if (existsSync(SECRETS_PATH)) {
    return readFileSync(SECRETS_PATH, 'utf-8').trim();
  }
  if (process.env.CREATOMATE_API_KEY) {
    return process.env.CREATOMATE_API_KEY;
  }
  console.error(
    `\nNo API key found.\n` +
    `Either save it to ${SECRETS_PATH} or set CREATOMATE_API_KEY env var.\n` +
    `Sign up at https://creatomate.com to get one (free, no credit card).\n`
  );
  process.exit(1);
}

/** Build a scene composition with optional screenshot background + text overlay */
function buildScene(scene: typeof SCENES[number]): Creatomate.Composition {
  const elements: Array<
    Creatomate.Shape | Creatomate.Image | Creatomate.Text | Creatomate.Composition
  > = [];

  // Dark background fill
  elements.push(
    new Creatomate.Shape({
      width: '100%',
      height: '100%',
      fillColor: BRAND.bg,
    })
  );

  if (scene.screenshot) {
    // Screenshot — near full-bleed, subtle slow zoom
    elements.push(
      new Creatomate.Image({
        source: scene.screenshot,
        x: '50%',
        y: '44%',
        width: '94%',
        height: '80%',
        borderRadius: '0.8 vmin',
        shadow: new Creatomate.Shadow('rgba(249,115,22,0.12)', '2 vmin', '0 vmin', '0.3 vmin'),
        animations: [
          new Creatomate.PanCenter({
            startScale: '100%',
            endScale: '103%',
            easing: 'linear',
          }),
        ],
      })
    );

    // Headline — bottom left area
    elements.push(
      new Creatomate.Text({
        text: scene.headline,
        fontFamily: BRAND.fontHeading,
        fontWeight: '700',
        fontSize: '4.5 vmin',
        fillColor: BRAND.accent,
        x: '50%',
        y: '86%',
        width: '80%',
        xAlignment: '50%',
        yAlignment: '50%',
        animations: [
          new Creatomate.TextSlide({ scope: 'element' }),
        ],
      })
    );

    // Subline
    elements.push(
      new Creatomate.Text({
        text: scene.subline,
        fontFamily: BRAND.fontBody,
        fontWeight: '400',
        fontSize: '2.8 vmin',
        fillColor: BRAND.textMuted,
        x: '50%',
        y: '93%',
        width: '80%',
        xAlignment: '50%',
        yAlignment: '50%',
        animations: [
          new Creatomate.TextSlide({ scope: 'element' }),
        ],
      })
    );
  } else if (scene.label === 'intro') {
    // Intro scene — logo + branding

    // StdOut icon (animated scale-in)
    elements.push(
      new Creatomate.Image({
        source: 'https://charlieseay.com/assets/stdout/stdout-icon.png',
        x: '50%',
        y: '38%',
        width: '12%',
        fit: 'contain',
        animations: [
          new Creatomate.Scale({
            startScale: '0%',
            easing: 'back-out',
          }),
        ],
      })
    );

    // Product name
    elements.push(
      new Creatomate.Text({
        text: scene.headline,
        fontFamily: BRAND.fontMono,
        fontWeight: '700',
        fontSize: '10 vmin',
        fillColor: BRAND.text,
        x: '50%',
        y: '56%',
        width: '80%',
        xAlignment: '50%',
        yAlignment: '50%',
        animations: [
          new Creatomate.TextScale({ scope: 'element' }),
        ],
      })
    );

    // Accent line
    elements.push(
      new Creatomate.Shape({
        x: '50%',
        y: '65%',
        width: '12%',
        height: '0.4%',
        fillColor: BRAND.accent,
        animations: [
          new Creatomate.TextSlide({ scope: 'element' }),
        ],
      })
    );

    // Tagline
    elements.push(
      new Creatomate.Text({
        text: scene.subline,
        fontFamily: BRAND.fontBody,
        fontWeight: '400',
        fontSize: '3.5 vmin',
        fillColor: BRAND.textMuted,
        x: '50%',
        y: '72%',
        width: '80%',
        xAlignment: '50%',
        yAlignment: '50%',
        animations: [
          new Creatomate.TextSlide({ scope: 'element' }),
        ],
      })
    );
  } else if (scene.label === 'outro') {
    // Outro scene — logo + CTA

    // StdOut icon
    elements.push(
      new Creatomate.Image({
        source: 'https://charlieseay.com/assets/stdout/stdout-icon.png',
        x: '50%',
        y: '28%',
        width: '10%',
        fit: 'contain',
        animations: [
          new Creatomate.Scale({
            startScale: '0%',
            easing: 'back-out',
          }),
        ],
      })
    );

    // Headline
    elements.push(
      new Creatomate.Text({
        text: scene.headline,
        fontFamily: BRAND.fontHeading,
        fontWeight: '700',
        fontSize: '7 vmin',
        fillColor: BRAND.text,
        x: '50%',
        y: '38%',
        width: '80%',
        xAlignment: '50%',
        yAlignment: '50%',
        animations: [
          new Creatomate.TextScale({ scope: 'element' }),
        ],
      })
    );

    // URL
    elements.push(
      new Creatomate.Text({
        text: scene.subline,
        fontFamily: BRAND.fontMono,
        fontWeight: '600',
        fontSize: '4 vmin',
        fillColor: BRAND.accent,
        x: '50%',
        y: '52%',
        width: '80%',
        xAlignment: '50%',
        yAlignment: '50%',
        animations: [
          new Creatomate.TextSlide({ scope: 'element' }),
        ],
      })
    );

    // Price line
    if ('extra' in scene && scene.extra) {
      elements.push(
        new Creatomate.Text({
          text: scene.extra,
          fontFamily: BRAND.fontBody,
          fontWeight: '400',
          fontSize: '3 vmin',
          fillColor: BRAND.textMuted,
          x: '50%',
          y: '62%',
          width: '80%',
          xAlignment: '50%',
          yAlignment: '50%',
          animations: [
            new Creatomate.TextSlide({ scope: 'element' }),
          ],
        })
      );
    }

    // Accent line bottom
    elements.push(
      new Creatomate.Shape({
        x: '50%',
        y: '72%',
        width: '15%',
        height: '0.5%',
        fillColor: BRAND.accent,
      })
    );
  }

  return new Creatomate.Composition({
    track: 1,
    duration: scene.duration,
    elements,
    transition: scene.label === 'intro'
      ? undefined
      : new Creatomate.Fade({ duration: 0.8 }),
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const apiKey = loadApiKey();
  const client = new Creatomate.Client(apiKey);

  const sceneCompositions = SCENES.map(buildScene);

  const source = new Creatomate.Source({
    outputFormat: 'mp4',
    frameRate: 30,
    width: 1920,
    height: 1080,
    // Max quality — avoid blurry screenshots
    renderScale: 2,
    elements: sceneCompositions,
  });

  console.log('Submitting render to Creatomate...');
  console.log(`  Scenes: ${SCENES.length}`);
  console.log(`  Duration: ~${SCENES.reduce((a, s) => a + s.duration, 0)}s (before transitions)`);
  console.log(`  Resolution: 1920x1080`);
  console.log(`  Estimated credits: ~6-8\n`);

  try {
    const renders = await client.render({ source });

    for (const render of renders) {
      console.log(`Render complete!`);
      console.log(`  Status: ${render.status}`);
      console.log(`  URL: ${render.url}`);
      console.log(`\nDownload with:`);
      console.log(`  curl -o ~/Projects/stdout/marketing-assets/stdout-demo.mp4 "${render.url}"`);
    }
  } catch (error) {
    console.error('Render failed:', error);
    process.exit(1);
  }
}

main();
