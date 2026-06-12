/**
 * Base interface for ticketing system connectors
 * Implement this interface to add support for new ticketing systems
 */

export interface ConnectorConfig {
  [key: string]: any;
}

export interface ExternalTicket {
  id: string;
  title: string;
  description: string;
  status: string;
  type?: string;
  severity?: string;
  tags?: string[];
  url: string;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
}

export interface Ticket {
  id: string;
  userId: string;
  type: 'incident' | 'bug' | 'feature' | 'task';
  title: string;
  description: string;
  stackId?: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'in_progress' | 'blocked' | 'resolved' | 'closed';
  tags?: string;
  externalSystem?: string;
  externalId?: string;
  externalUrl?: string;
  lastSyncedAt?: Date;
  syncDirection?: 'inbound' | 'outbound' | 'bidirectional';
  syncStatus?: string;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConnectionTestResult {
  ok: boolean;
  error?: string;
  metadata?: {
    workspace?: string;
    project?: string;
    user?: string;
    url?: string;
  };
}

export abstract class TicketingConnector {
  protected config: ConnectorConfig;
  protected systemName: string;

  constructor(config: ConnectorConfig, systemName: string) {
    this.config = config;
    this.systemName = systemName;
  }

  /**
   * Test if the connector can authenticate and access the external system
   */
  abstract testConnection(): Promise<ConnectionTestResult>;

  /**
   * Fetch tickets from the external system
   * @param since - Only fetch tickets updated after this date
   */
  abstract fetchTickets(since?: Date): Promise<ExternalTicket[]>;

  /**
   * Create a new ticket in the external system
   * @param ticket - The ticket to create
   * @returns The external ticket ID and URL
   */
  abstract createTicket(ticket: Ticket): Promise<{ id: string; url: string }>;

  /**
   * Update an existing ticket in the external system
   * @param externalId - The external ticket ID
   * @param updates - Partial ticket data to update
   */
  abstract updateTicket(externalId: string, updates: Partial<Ticket>): Promise<void>;

  /**
   * Map an external ticket to StdOut's internal format
   * @param externalTicket - Ticket from external system
   * @param userId - StdOut user ID to assign
   */
  abstract mapToInternal(externalTicket: ExternalTicket, userId: string): Ticket;

  /**
   * Map a StdOut ticket to the external system's format
   * @param ticket - StdOut ticket
   */
  abstract mapToExternal(ticket: Ticket): any;

  /**
   * Get the system name (linear, jira, github, etc.)
   */
  getSystemName(): string {
    return this.systemName;
  }

  /**
   * Validate configuration before saving
   * @param config - Configuration to validate
   * @returns Error message if invalid, null if valid
   */
  static validateConfig(config: ConnectorConfig): string | null {
    // Override in subclasses to add system-specific validation
    return null;
  }
}
