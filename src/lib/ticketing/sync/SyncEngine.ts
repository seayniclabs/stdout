import type { Ticket } from '../base/TicketingConnector';
import { ConnectorRegistry } from '../base/ConnectorRegistry';
import type { Database } from 'better-sqlite3';
import { nanoid } from 'nanoid';

export interface SyncResult {
  imported: number;
  exported: number;
  conflicts: number;
  errors: string[];
}

export class SyncEngine {
  private db: Database;
  private userId: string;

  constructor(db: Database, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  /**
   * Sync all enabled connectors
   */
  async syncAll(): Promise<Map<string, SyncResult>> {
    const connectors = this.db
      .prepare(
        'SELECT * FROM ticketing_connectors WHERE user_id = ? AND enabled = 1 AND sync_enabled = 1'
      )
      .all(this.userId) as any[];

    const results = new Map<string, SyncResult>();

    for (const connectorConfig of connectors) {
      try {
        const result = await this.syncConnector(connectorConfig.id);
        results.set(connectorConfig.id, result);
      } catch (error) {
        results.set(connectorConfig.id, {
          imported: 0,
          exported: 0,
          conflicts: 0,
          errors: [error instanceof Error ? error.message : 'Unknown error'],
        });
      }
    }

    return results;
  }

  /**
   * Sync a specific connector
   */
  async syncConnector(connectorId: string): Promise<SyncResult> {
    const result: SyncResult = {
      imported: 0,
      exported: 0,
      conflicts: 0,
      errors: [],
    };

    // Fetch connector config
    const connectorConfig = this.db
      .prepare('SELECT * FROM ticketing_connectors WHERE id = ? AND user_id = ?')
      .get(connectorId, this.userId) as any;

    if (!connectorConfig) {
      throw new Error('Connector not found');
    }

    if (!connectorConfig.enabled || !connectorConfig.sync_enabled) {
      throw new Error('Connector is disabled');
    }

    // Parse config
    const config = JSON.parse(connectorConfig.config);

    // Create connector instance
    const connector = ConnectorRegistry.create(connectorConfig.system, config);

    // Test connection first
    const testResult = await connector.testConnection();
    if (!testResult.ok) {
      throw new Error(`Connection test failed: ${testResult.error}`);
    }

    // Determine sync window (only fetch tickets updated since last sync)
    const lastSyncAt = connectorConfig.last_sync_at
      ? new Date(connectorConfig.last_sync_at)
      : undefined;

    try {
      // INBOUND: Fetch tickets from external system
      if (
        connectorConfig.sync_direction === 'inbound' ||
        connectorConfig.sync_direction === 'bidirectional'
      ) {
        const externalTickets = await connector.fetchTickets(lastSyncAt);

        for (const externalTicket of externalTickets) {
          try {
            // Map to internal format
            const ticket = connector.mapToInternal(externalTicket, this.userId);

            // Check if ticket already exists
            const existing = this.db
              .prepare(
                'SELECT * FROM tickets WHERE external_system = ? AND external_id = ? AND user_id = ?'
              )
              .get(connectorConfig.system, externalTicket.id, this.userId) as any;

            const now = new Date().toISOString();

            if (existing) {
              // Update existing ticket
              this.db
                .prepare(
                  `UPDATE tickets
                   SET title = ?, description = ?, status = ?, severity = ?, tags = ?,
                       external_url = ?, last_synced_at = ?, updated_at = ?
                   WHERE id = ?`
                )
                .run(
                  ticket.title,
                  ticket.description,
                  ticket.status,
                  ticket.severity,
                  ticket.tags,
                  ticket.externalUrl,
                  now,
                  now,
                  existing.id
                );
            } else {
              // Insert new ticket
              this.db
                .prepare(
                  `INSERT INTO tickets (
                    id, user_id, type, title, description, stack_id, severity, status, tags,
                    external_system, external_id, external_url, last_synced_at, sync_direction, created_at, updated_at
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                )
                .run(
                  nanoid(),
                  this.userId,
                  ticket.type,
                  ticket.title,
                  ticket.description,
                  ticket.stackId,
                  ticket.severity,
                  ticket.status,
                  ticket.tags,
                  connectorConfig.system,
                  externalTicket.id,
                  externalTicket.url,
                  now,
                  'inbound',
                  now,
                  now
                );
            }

            result.imported++;
          } catch (error) {
            result.errors.push(
              `Failed to import ticket ${externalTicket.id}: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        }
      }

      // OUTBOUND: Push local tickets to external system
      if (
        connectorConfig.sync_direction === 'outbound' ||
        connectorConfig.sync_direction === 'bidirectional'
      ) {
        // Get tickets that need to be pushed
        const localTickets = this.db
          .prepare(
            `SELECT * FROM tickets
             WHERE user_id = ?
             AND (external_system IS NULL OR external_system = ?)
             AND updated_at > ?`
          )
          .all(
            this.userId,
            connectorConfig.system,
            lastSyncAt ? lastSyncAt.toISOString() : '1970-01-01'
          ) as any[];

        for (const localTicket of localTickets) {
          try {
            if (!localTicket.external_id) {
              // Create ticket in external system
              const { id, url } = await connector.createTicket(localTicket as Ticket);

              // Update local ticket with external ID
              this.db
                .prepare(
                  `UPDATE tickets
                   SET external_system = ?, external_id = ?, external_url = ?, last_synced_at = ?
                   WHERE id = ?`
                )
                .run(
                  connectorConfig.system,
                  id,
                  url,
                  new Date().toISOString(),
                  localTicket.id
                );

              result.exported++;
            } else {
              // Update existing ticket in external system
              await connector.updateTicket(localTicket.external_id, localTicket as Ticket);
              result.exported++;
            }
          } catch (error) {
            result.errors.push(
              `Failed to export ticket ${localTicket.id}: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        }
      }

      // Update last sync timestamp
      this.db
        .prepare(
          `UPDATE ticketing_connectors
           SET last_sync_at = ?, last_sync_status = ?
           WHERE id = ?`
        )
        .run(
          new Date().toISOString(),
          result.errors.length > 0 ? result.errors[0] : 'ok',
          connectorId
        );
    } catch (error) {
      // Update with error status
      this.db
        .prepare(
          `UPDATE ticketing_connectors
           SET last_sync_status = ?
           WHERE id = ?`
        )
        .run(error instanceof Error ? error.message : 'Sync failed', connectorId);

      throw error;
    }

    return result;
  }
}
