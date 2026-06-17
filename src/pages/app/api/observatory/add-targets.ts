// Add discovered services to Observatory monitoring
export const prerender = false;

import type { APIRoute } from 'astro';
import { getDb, schema } from '../../../../lib/db';
import { discoveredServices, discoveredHosts } from '../../../../lib/db/tenant-schema';
import { eq } from 'drizzle-orm';
import { promises as fs } from 'node:fs';

export const POST: APIRoute = async ({ request, locals }) => {
  const session = locals.user;
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await request.json();
    const { serviceIds } = body; // Array of service IDs to add to monitoring

    const db = getDb();

    // Fetch services with their host info
    const services = [];
    for (const serviceId of serviceIds) {
      const service = db
        .select()
        .from(discoveredServices)
        .where(eq(discoveredServices.id, serviceId))
        .get();

      if (service) {
        const host = db
          .select()
          .from(discoveredHosts)
          .where(eq(discoveredHosts.id, service.hostId))
          .get();

        if (host) {
          services.push({ service, host });
        }
      }
    }

    if (services.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No valid services found' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Update Prometheus config
    await addToPrometheus(services);

    // TODO: Trigger Prometheus reload
    // docker exec prometheus kill -HUP 1

    return new Response(
      JSON.stringify({
        success: true,
        added: services.length,
        services: services.map(s => ({
          ip: s.host.ipAddress,
          port: s.service.port,
          name: s.service.serviceName
        }))
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[observatory/add-targets] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to add targets to Observatory' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

async function addToPrometheus(services: Array<{ service: any; host: any }>) {
  const prometheusConfigPath = '/app/observatory/config/prometheus.yml';

  try {
    // Read existing config
    const configContent = await fs.readFile(prometheusConfigPath, 'utf-8');

    // Build YAML snippet for discovered services
    const discoveredYaml = services.map(s =>
      `      - targets: ['${s.host.ipAddress}:${s.service.port}']\n` +
      `        labels:\n` +
      `          environment: 'production'\n` +
      `          service: '${s.service.serviceName || 'unknown'}'\n` +
      `          discovered: 'true'\n` +
      `          host: '${s.host.hostname || s.host.ipAddress}'`
    ).join('\n');

    // Append to discovered job or create it
    let updatedConfig = configContent;

    if (configContent.includes('job_name: \'discovered\'') || configContent.includes('job_name: "discovered"')) {
      // Append to existing discovered job
      updatedConfig = configContent.replace(
        /(job_name: ['"]discovered['"][\s\S]*?static_configs:)/,
        `$1\n${discoveredYaml}`
      );
    } else {
      // Add new discovered job at end of scrape_configs
      updatedConfig = configContent.replace(
        /scrape_configs:/,
        `scrape_configs:\n  - job_name: 'discovered'\n    static_configs:\n${discoveredYaml}`
      );
    }

    // Write updated config
    await fs.writeFile(prometheusConfigPath, updatedConfig, 'utf-8');
    console.log('[observatory/add-targets] Prometheus config updated with', services.length, 'targets');

  } catch (error) {
    console.error('[observatory/add-targets] Failed to update Prometheus config:', error);
    throw error;
  }
}
