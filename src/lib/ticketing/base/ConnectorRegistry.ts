import type { ConnectorConfig, TicketingConnector } from './TicketingConnector';
import { BuiltInConnector } from '../connectors/BuiltInConnector';
import { GitHubConnector } from '../connectors/GitHubConnector';
import { WebhookConnector } from '../connectors/WebhookConnector';
// Import other connectors as they are implemented
// import { LinearConnector } from '../connectors/LinearConnector';
// import { JiraConnector } from '../connectors/JiraConnector';
// import { ServiceNowConnector } from '../connectors/ServiceNowConnector';

type ConnectorClass = new (config: ConnectorConfig) => TicketingConnector;

export class ConnectorRegistry {
  private static connectors: Map<string, ConnectorClass> = new Map();

  /**
   * Register all available connectors
   */
  static initialize() {
    this.register('built-in', BuiltInConnector);
    this.register('github', GitHubConnector);
    this.register('webhook', WebhookConnector);
    // this.register('linear', LinearConnector);
    // this.register('jira', JiraConnector);
    // this.register('servicenow', ServiceNowConnector);
  }

  /**
   * Register a connector class
   */
  static register(systemName: string, connectorClass: ConnectorClass) {
    this.connectors.set(systemName, connectorClass);
  }

  /**
   * Create a connector instance
   * @param systemName - The system type (linear, jira, etc.)
   * @param config - Connector configuration
   */
  static create(systemName: string, config: ConnectorConfig): TicketingConnector {
    const ConnectorClass = this.connectors.get(systemName);

    if (!ConnectorClass) {
      throw new Error(`Unknown ticketing system: ${systemName}`);
    }

    return new ConnectorClass(config);
  }

  /**
   * Get list of supported systems
   */
  static getSupportedSystems(): string[] {
    return Array.from(this.connectors.keys());
  }

  /**
   * Check if a system is supported
   */
  static isSupported(systemName: string): boolean {
    return this.connectors.has(systemName);
  }
}

// Initialize registry on module load
ConnectorRegistry.initialize();
