import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { getTenantDb, getCentralDb, centralSchema } from '../../../../lib/db';
import { discoveredHosts, discoveredServices, stacks } from '../../../../lib/db/tenant-schema';
import { eq, and } from 'drizzle-orm';
import { getSetupProgress, getSetupConfig, SetupStep } from '../../../../lib/setup';

export const POST: APIRoute = async ({ request, locals }) => {
  const session = locals.user;
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const { hosts } = body;

    if (!Array.isArray(hosts) || hosts.length === 0) {
      return new Response(JSON.stringify({ error: 'No hosts provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = getTenantDb(session.id);
    const now = new Date();
    let importedHosts = 0;
    let importedServices = 0;

    for (const host of hosts) {
      const { ip, hostname, services } = host;

      if (!ip) continue;

      // Check if host already exists
      const existing = await db
        .select()
        .from(discoveredHosts)
        .where(and(
          eq(discoveredHosts.userId, session.id),
          eq(discoveredHosts.ipAddress, ip)
        ))
        .limit(1);

      let hostId: string;

      if (existing.length > 0) {
        // Update existing host
        hostId = existing[0].id;
        await db
          .update(discoveredHosts)
          .set({
            hostname: hostname || existing[0].hostname,
            lastSeen: now,
            updatedAt: now,
          })
          .where(eq(discoveredHosts.id, hostId));
      } else {
        // Create new host
        hostId = nanoid();
        await db.insert(discoveredHosts).values({
          id: hostId,
          userId: session.id,
          ipAddress: ip,
          hostname: hostname || null,
          macAddress: null,
          vendor: null,
          lastSeen: now,
          createdAt: now,
          updatedAt: now,
        });
        importedHosts++;
      }

      // Import services
      if (Array.isArray(services)) {
        for (const service of services) {
          const { port, name } = service;
          if (!port) continue;

          // Check if service already exists for this host
          const existingService = await db
            .select()
            .from(discoveredServices)
            .where(and(
              eq(discoveredServices.hostId, hostId),
              eq(discoveredServices.port, port)
            ))
            .limit(1);

          if (existingService.length > 0) {
            // Update existing service
            await db
              .update(discoveredServices)
              .set({
                serviceName: name || existingService[0].serviceName,
                lastSeen: now,
                updatedAt: now,
              })
              .where(eq(discoveredServices.id, existingService[0].id));
          } else {
            // Create new service
            await db.insert(discoveredServices).values({
              id: nanoid(),
              hostId,
              userId: session.id,
              port,
              protocol: 'tcp',
              serviceName: name || null,
              serviceVersion: null,
              lastSeen: now,
              createdAt: now,
              updatedAt: now,
            });
            importedServices++;
          }
        }
      }
    }

    // If this is during setup and we imported hosts, create a default stack
    try {
      const progress = await getSetupProgress();
      const isSetup = progress.currentStep <= SetupStep.Review; // During or before Review step

      if (isSetup && importedHosts > 0) {
        // Check if a default stack already exists
        const existingStacks = await db
          .select()
          .from(stacks)
          .where(eq(stacks.userId, session.id))
          .limit(1);

        if (existingStacks.length === 0) {
          // Get environment name from setup config
          const envName = await getSetupConfig('environment_name');
          const stackName = envName || 'My Environment';

          console.log('[network/import] Creating default stack during setup:', stackName);

          // Create default stack
          await db.insert(stacks).values({
            id: nanoid(),
            userId: session.id,
            name: stackName,
            description: 'Automatically created from network discovery',
            composeFile: null,
            composeProject: null,
            status: 'imported',
            source: 'scanner',
            createdAt: now,
            updatedAt: now,
          });

          console.log('[network/import] Default stack created successfully');
        }
      }
    } catch (stackError) {
      // Don't fail the import if stack creation fails
      console.error('[network/import] Error creating default stack:', stackError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        imported: {
          hosts: importedHosts,
          services: importedServices,
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[network/import] Error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Import failed',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
