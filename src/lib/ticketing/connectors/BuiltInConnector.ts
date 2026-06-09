import {
  TicketingConnector,
  type ConnectorConfig,
  type ExternalTicket,
  type Ticket,
  type ConnectionTestResult,
} from '../base/TicketingConnector';

/**
 * Built-in connector - passthrough to StdOut's native SQLite storage
 * This connector doesn't actually sync with an external system,
 * it just provides a consistent interface for the built-in ticket system
 */
export class BuiltInConnector extends TicketingConnector {
  constructor(config: ConnectorConfig) {
    super(config, 'built-in');
  }

  async testConnection(): Promise<ConnectionTestResult> {
    // Built-in always works
    return {
      ok: true,
      metadata: {
        workspace: 'StdOut Native',
      },
    };
  }

  async fetchTickets(since?: Date): Promise<ExternalTicket[]> {
    // Built-in doesn't sync from external source
    // Return empty array - tickets are already in local DB
    return [];
  }

  async createTicket(ticket: Ticket): Promise<{ id: string; url: string }> {
    // Built-in tickets are created directly in DB by the application
    // This method should not be called for built-in connector
    throw new Error('Built-in connector does not support createTicket - tickets are created directly in DB');
  }

  async updateTicket(externalId: string, updates: Partial<Ticket>): Promise<void> {
    // Built-in tickets are updated directly in DB by the application
    // This method should not be called for built-in connector
    throw new Error('Built-in connector does not support updateTicket - tickets are updated directly in DB');
  }

  mapToInternal(externalTicket: ExternalTicket, userId: string): Ticket {
    // Built-in doesn't map external tickets
    throw new Error('Built-in connector does not support mapToInternal');
  }

  mapToExternal(ticket: Ticket): any {
    // Built-in doesn't map to external format
    throw new Error('Built-in connector does not support mapToExternal');
  }

  static validateConfig(config: ConnectorConfig): string | null {
    // Built-in has no configuration requirements
    return null;
  }
}
