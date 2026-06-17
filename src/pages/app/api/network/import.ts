import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { getDb, schema } from '../../../../lib/db';
import { eq, and } from 'drizzle-orm';
import { getSetupProgress, getSetupConfig, SetupStep } from '../../../../lib/setup';
import { emit } from '../../../../lib/events';

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

    const db = getDb();
    const now = new Date();
    let importedHosts = 0;
    let importedServices = 0;

    // During setup, get or create the default stack to link hosts to
    let defaultStackId: string | null = null;
    try {
      const progress = await getSetupProgress();
      const isSetup = progress.currentStep <= SetupStep.Review;

      if (isSetup) {
        // Check if a stack already exists
        const existingStacks = await db
          .select()
          .from(stacks)
          .where(eq(stacks.userId, session.id))
          .limit(1);

        if (existingStacks.length > 0) {
          defaultStackId = existingStacks[0].id;
          console.log('[network/import] Using existing stack:', defaultStackId);
        } else {
          // Create default stack
          const envName = await getSetupConfig('environment_name');
          const stackName = envName || 'My Environment';
          defaultStackId = nanoid();

          console.log('[network/import] Creating default stack during setup:', stackName);

          await db.insert(stacks).values({
            id: defaultStackId,
            userId: session.id,
            name: stackName,
            description: 'Automatically created from network discovery',
            createdAt: now,
            updatedAt: now,
          });

          console.log('[network/import] Default stack created:', defaultStackId);

          emit({ type: 'stack.created', userId: session.id, stackId: defaultStackId, name: stackName, source: 'auto' });
        }
      }
    } catch (stackError) {
      console.error('[network/import] Error with default stack:', stackError);
      // Continue without linking to stack
    }

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
          stackId: defaultStackId, // Link to default stack during setup
          ipAddress: ip,
          hostname: hostname || null,
          macAddress: null,
          vendor: null,
          lastSeen: now,
          createdAt: now,
          updatedAt: now,
        });
        importedHosts++;

        emit({ type: 'host.discovered', userId: session.id, hostId, ip, hostname: hostname || null, stackId: defaultStackId });
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
