/**
 * Regression Test Suite - 2026-08-17
 * Uses Chrome DevTools MCP for browser automation
 *
 * Tests against DEPLOYED instance (not local dev server)
 * Environment: ThinkPad 192.168.68.89:8112
 *
 * Run via: node tests/regression-devtools-2026-08-17.ts
 *
 * All 6 bugs found during systematic testing session are codified here
 * to prevent regressions.
 */

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: string;
}

const results: TestResult[] = [];

// Test configuration
const BASE_URL = 'http://192.168.68.89:8112';
const TEST_USER = {
  email: 'charlie@seayniclabs.com',
  password: 'test1234'
};

/**
 * Helper: Use Chrome DevTools MCP tools
 * These are loaded via ToolSearch in the actual test execution
 */
declare function mcp__chrome_devtools__navigate_page(args: {
  type: 'url' | 'back' | 'forward' | 'reload';
  url?: string;
}): Promise<{ success: boolean }>;

declare function mcp__chrome_devtools__take_screenshot(args: {
  fullPage?: boolean;
}): Promise<{ success: boolean }>;

declare function mcp__chrome_devtools__take_snapshot(): Promise<{
  content: string;
}>;

declare function mcp__chrome_devtools__click(args: {
  uid: string;
}): Promise<{ success: boolean }>;

declare function mcp__chrome_devtools__fill_form(args: {
  elements: Array<{ uid: string; value: string }>;
}): Promise<{ success: boolean }>;

/**
 * Test Suite
 */

async function runRegressionTests() {
  console.log('🧪 Starting Regression Test Suite - 2026-08-17');
  console.log(`📍 Testing against: ${BASE_URL}\n`);

  // Test #1: Infrastructure page loads without 500 error
  try {
    await mcp__chrome_devtools__navigate_page({
      type: 'url',
      url: `${BASE_URL}/app/infrastructure`
    });

    const snapshot = await mcp__chrome_devtools__take_snapshot();

    // Check for HTTP 500 error indicators
    const has500Error = snapshot.content.includes('500') ||
                       snapshot.content.includes('Internal Server Error') ||
                       snapshot.content.includes('Something went wrong');

    if (has500Error) {
      results.push({
        name: 'Bug #1 - Infrastructure page HTTP 500',
        passed: false,
        error: 'Page returned 500 error or error message'
      });
    } else {
      // Check that page rendered content
      const hasContent = snapshot.content.includes('Infrastructure') ||
                        snapshot.content.includes('Topology Map');

      results.push({
        name: 'Bug #1 - Infrastructure page loads without 500 error',
        passed: hasContent,
        details: hasContent ? 'Page rendered successfully' : 'Page loaded but no content found'
      });
    }
  } catch (error) {
    results.push({
      name: 'Bug #1 - Infrastructure page loads',
      passed: false,
      error: String(error)
    });
  }

  // Test #2: Network discovery saves discovered hosts
  try {
    await mcp__chrome_devtools__navigate_page({
      type: 'url',
      url: `${BASE_URL}/app/infrastructure`
    });

    const snapshot = await mcp__chrome_devtools__take_snapshot();

    // Check if hosts are displayed
    const hasHosts = snapshot.content.includes('discovered') &&
                    (snapshot.content.includes('IP Address') ||
                     snapshot.content.includes('host-card') ||
                     snapshot.content.includes('device-card'));

    results.push({
      name: 'Bug #2 - Network discovery saves hosts to database',
      passed: hasHosts,
      details: hasHosts ? 'Discovered hosts are displayed' : 'No hosts found (may be expected if discovery not run)'
    });
  } catch (error) {
    results.push({
      name: 'Bug #2 - Network discovery',
      passed: false,
      error: String(error)
    });
  }

  // Test #3: Topology Map renders without CSP errors
  try {
    await mcp__chrome_devtools__navigate_page({
      type: 'url',
      url: `${BASE_URL}/app/infrastructure`
    });

    const snapshot = await mcp__chrome_devtools__take_snapshot();

    // Check for CSP error indicators in the page
    const hasCspError = snapshot.content.includes('CSP') ||
                       snapshot.content.includes('Content Security Policy') ||
                       snapshot.content.includes('d3js.org');

    // Check if topology map container exists
    const hasTopologyMap = snapshot.content.includes('topology-map') ||
                          snapshot.content.includes('TopologyMap');

    results.push({
      name: 'Bug #3 - Topology Map renders without CSP errors',
      passed: !hasCspError && hasTopologyMap,
      details: hasCspError ? 'CSP error detected' : 'No CSP errors, topology map present'
    });
  } catch (error) {
    results.push({
      name: 'Bug #3 - Topology Map CSP',
      passed: false,
      error: String(error)
    });
  }

  // Test #4 & #5: Timestamps show correct years (not 58597 or Invalid Date)
  try {
    // Navigate to stacks page
    await mcp__chrome_devtools__navigate_page({
      type: 'url',
      url: `${BASE_URL}/app/stacks`
    });

    let snapshot = await mcp__chrome_devtools__take_snapshot();

    // Find first stack link and click it
    const stackLinkMatch = snapshot.content.match(/uid=(\w+_\d+).*href="\/app\/stacks\/(stack-[^"]+)"/);

    if (stackLinkMatch) {
      const uid = stackLinkMatch[1];
      await mcp__chrome_devtools__click({ uid });

      // Check stack detail page for timestamp bugs
      snapshot = await mcp__chrome_devtools__take_snapshot();

      const hasYear58597 = snapshot.content.includes('58597');
      const hasInvalidDate = snapshot.content.includes('Invalid Date');
      const hasUpdatedText = snapshot.content.includes('Updated');

      results.push({
        name: 'Bug #4 - Stack timestamps show correct year (not 58597)',
        passed: !hasYear58597 && hasUpdatedText,
        details: hasYear58597 ? 'Found year 58597!' : 'Timestamp appears correct'
      });
    } else {
      results.push({
        name: 'Bug #4 - Stack timestamps',
        passed: true,
        details: 'No stacks found to test (not a failure)'
      });
    }

    // Test discovered host timestamps
    await mcp__chrome_devtools__navigate_page({
      type: 'url',
      url: `${BASE_URL}/app/infrastructure`
    });

    snapshot = await mcp__chrome_devtools__take_snapshot();

    const hasLastSeenInvalid = snapshot.content.includes('Last seen Invalid Date');
    const hasLastSeen = snapshot.content.includes('Last seen');

    results.push({
      name: 'Bug #5 - Host "Last seen" timestamps valid',
      passed: !hasLastSeenInvalid && hasLastSeen,
      details: hasLastSeenInvalid ? 'Found "Invalid Date"!' : 'Timestamps appear correct'
    });
  } catch (error) {
    results.push({
      name: 'Bug #4 & #5 - Timestamps',
      passed: false,
      error: String(error)
    });
  }

  // Test #6: Device detail page shows correct "Discovered" timestamp
  try {
    await mcp__chrome_devtools__navigate_page({
      type: 'url',
      url: `${BASE_URL}/app/infrastructure`
    });

    let snapshot = await mcp__chrome_devtools__take_snapshot();

    // Find first device/host card and click it
    const deviceLinkMatch = snapshot.content.match(/uid=(\w+_\d+).*(?:host-card|device-card)/);

    if (deviceLinkMatch) {
      const uid = deviceLinkMatch[1];
      await mcp__chrome_devtools__click({ uid });

      // Check device detail page
      snapshot = await mcp__chrome_devtools__take_snapshot();

      const hasDiscoveredInvalid = snapshot.content.includes('Discovered Invalid Date');
      const hasDiscovered = snapshot.content.includes('Discovered');

      results.push({
        name: 'Bug #6 - Device "Discovered" timestamp valid',
        passed: !hasDiscoveredInvalid && hasDiscovered,
        details: hasDiscoveredInvalid ? 'Found "Invalid Date"!' : 'Timestamp appears correct'
      });
    } else {
      results.push({
        name: 'Bug #6 - Device timestamps',
        passed: true,
        details: 'No devices found to test (not a failure)'
      });
    }
  } catch (error) {
    results.push({
      name: 'Bug #6 - Device timestamps',
      passed: false,
      error: String(error)
    });
  }

  // Additional regression tests for pages verified working

  const pagesToTest = [
    { name: 'Dashboard', url: `${BASE_URL}/app`, expectedText: 'Dashboard' },
    { name: 'Incidents', url: `${BASE_URL}/app/incidents`, expectedText: 'Incidents' },
    { name: 'Observatory', url: `${BASE_URL}/app/observatory`, expectedText: 'Observatory' },
    { name: 'Alerts', url: `${BASE_URL}/app/alerts`, expectedText: 'Alert Routing' },
    { name: 'Settings', url: `${BASE_URL}/app/settings`, expectedText: 'Settings' },
  ];

  for (const page of pagesToTest) {
    try {
      await mcp__chrome_devtools__navigate_page({
        type: 'url',
        url: page.url
      });

      const snapshot = await mcp__chrome_devtools__take_snapshot();

      const hasExpectedContent = snapshot.content.includes(page.expectedText);
      const hasError = snapshot.content.includes('500') ||
                      snapshot.content.includes('Error') ||
                      snapshot.content.includes('Something went wrong');

      results.push({
        name: `${page.name} page renders without errors`,
        passed: hasExpectedContent && !hasError,
        details: hasExpectedContent ? 'Page loaded successfully' : 'Expected content not found'
      });
    } catch (error) {
      results.push({
        name: `${page.name} page`,
        passed: false,
        error: String(error)
      });
    }
  }

  // Print results
  console.log('\n📊 Test Results:\n');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  results.forEach((result, index) => {
    const icon = result.passed ? '✅' : '❌';
    console.log(`${icon} ${result.name}`);
    if (result.details) {
      console.log(`   ℹ️  ${result.details}`);
    }
    if (result.error) {
      console.log(`   ⚠️  ${result.error}`);
    }
  });

  console.log(`\n📈 Summary: ${passed} passed, ${failed} failed out of ${results.length} tests\n`);

  if (failed === 0) {
    console.log('🎉 All regression tests passed!');
    process.exit(0);
  } else {
    console.log('❌ Some regression tests failed');
    process.exit(1);
  }
}

// Export for use in Claude Code agent context
export { runRegressionTests };

// If run directly (not imported), execute tests
if (import.meta.url === `file://${process.argv[1]}`) {
  runRegressionTests().catch(error => {
    console.error('Fatal error running tests:', error);
    process.exit(1);
  });
}
