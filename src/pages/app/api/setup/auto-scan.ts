// Auto-scan infrastructure in background after setup completes
export const prerender = false;

import type { APIRoute} from 'astro';
import { getSetupProgress, SetupStep, completeStep } from '../../../../lib/setup';
import { detectLocalSubnets } from '../../../../lib/network-utils';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export const POST: APIRoute = async ({ request }) => {
  try {
    const progress = await getSetupProgress();

    // Only run if Scanner step is current and not yet completed
    if (progress.currentStep !== SetupStep.Scanner || progress.steps[SetupStep.Scanner]?.completed) {
      return new Response(
        JSON.stringify({ error: 'Auto-scan not applicable at this stage' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get subnets from request or detect automatically
    const { subnets } = await request.json();
    const subnetsToScan = subnets || await detectSubnets();

    console.log('[auto-scan] Starting background infrastructure scan:', subnetsToScan);

    // Run scan in background (don't await)
    runBackgroundScan(subnetsToScan).catch(err => {
      console.error('[auto-scan] Background scan failed:', err);
    });

    return new Response(
      JSON.stringify({ status: 'started', subnets: subnetsToScan }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[auto-scan] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to start auto-scan' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

async function detectSubnets(): Promise<string[]> {
  return await detectLocalSubnets();
}

async function runBackgroundScan(subnets: string[]) {
  const results: any[] = [];

  for (const subnet of subnets) {
    try {
      console.log('[auto-scan] Scanning subnet:', subnet);
      const hosts = await simplePingSweep(subnet);
      results.push(...hosts);
    } catch (error) {
      console.error('[auto-scan] Failed to scan subnet', subnet, error);
    }
  }

  console.log('[auto-scan] Scan complete. Found', results.length, 'hosts');

  // Save results and complete Scanner step
  await completeStep(SetupStep.Scanner, {
    discoveredHosts: results,
    autoScanned: true,
    scannedAt: new Date().toISOString(),
  });

  console.log('[auto-scan] Scanner step marked complete');
}

async function simplePingSweep(subnet: string): Promise<Array<{ ip: string; hostname?: string }>> {
  const hosts: Array<{ ip: string; hostname?: string }> = [];

  // Simple ping sweep using nmap
  const nmapCommand = `nmap -sn -T4 --max-retries 1 ${subnet}`;

  try {
    const { stdout } = await execAsync(nmapCommand, { timeout: 30000 });
    const lines = stdout.split('\n');

    for (const line of lines) {
      // Parse "Nmap scan report for 192.168.1.1"
      const match = line.match(/Nmap scan report for ([\d.]+)/);
      if (match) {
        hosts.push({ ip: match[1] });
      }
    }
  } catch (error) {
    console.error('[auto-scan] Ping sweep failed:', error);
  }

  return hosts;
}
