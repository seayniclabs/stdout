import crypto from 'crypto';
import {
  TicketingConnector,
  type ConnectorConfig,
  type ExternalTicket,
  type Ticket,
  type ConnectionTestResult,
} from '../base/TicketingConnector';

/**
 * Generic Webhook Connector
 *
 * POSTs incident payloads to a configured webhook URL with HMAC signature.
 * Covers Zendesk, Jira, PagerDuty, Slack, and any custom webhook endpoint.
 *
 * Config schema:
 * {
 *   webhookUrl: string (the endpoint to POST to)
 *   secret?: string (for HMAC signing, optional)
 *   testPayload?: string (optional custom test payload)
 * }
 */
export class WebhookConnector extends TicketingConnector {
  private webhookUrl: string;
  private secret?: string;

  constructor(config: ConnectorConfig) {
    super(config, 'webhook');

    if (!config.webhookUrl) {
      throw new Error('Webhook connector requires webhookUrl');
    }

    // Validate URL format
    try {
      new URL(config.webhookUrl);
    } catch {
      throw new Error('webhookUrl must be a valid URL');
    }

    this.webhookUrl = config.webhookUrl;
    this.secret = config.secret;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const testPayload = {
        test: true,
        timestamp: new Date().toISOString(),
        message: 'StdOut Webhook Connection Test',
      };

      const response = await this.postWebhook(testPayload);

      if (!response.ok) {
        return {
          ok: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      return {
        ok: true,
        metadata: {
          url: this.sanitizeUrl(this.webhookUrl),
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  async fetchTickets(_since?: Date): Promise<ExternalTicket[]> {
    // Generic webhook connector doesn't support inbound sync
    // (webhook is unidirectional: StdOut -> external system)
    return [];
  }

  async createTicket(ticket: Ticket): Promise<{ id: string; url: string }> {
    try {
      const payload = {
        action: 'create',
        ticket: this.mapToWebhookFormat(ticket),
        timestamp: new Date().toISOString(),
      };

      const response = await this.postWebhook(payload);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Try to extract ID and URL from response
      const responseData = await response.json().catch(() => ({}));

      return {
        id: responseData.id || `webhook-${Date.now()}`,
        url: responseData.url || this.webhookUrl,
      };
    } catch (error) {
      throw new Error(
        `Failed to create ticket via webhook: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async updateTicket(
    externalId: string,
    updates: Partial<Ticket>
  ): Promise<void> {
    try {
      const payload = {
        action: 'update',
        externalId,
        updates: this.mapToWebhookFormat(updates as Ticket),
        timestamp: new Date().toISOString(),
      };

      const response = await this.postWebhook(payload);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      throw new Error(
        `Failed to update ticket via webhook: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  mapToInternal(externalTicket: ExternalTicket, userId: string): Ticket {
    return {
      id: `webhook-${externalTicket.id}`,
      userId,
      type: 'incident',
      title: externalTicket.title,
      description: externalTicket.description,
      severity: (externalTicket.severity as any) || 'medium',
      status:
        externalTicket.status === 'resolved' ? 'resolved' : 'open',
      tags: externalTicket.tags?.join(','),
      externalSystem: 'webhook',
      externalId: externalTicket.id,
      externalUrl: externalTicket.url,
      createdAt: externalTicket.createdAt,
      updatedAt: externalTicket.updatedAt,
      resolvedAt: externalTicket.resolvedAt,
    };
  }

  mapToExternal(ticket: Ticket): any {
    return this.mapToWebhookFormat(ticket);
  }

  static validateConfig(config: ConnectorConfig): string | null {
    if (!config.webhookUrl) return 'webhookUrl is required';
    if (typeof config.webhookUrl !== 'string')
      return 'webhookUrl must be a string';

    // Validate URL format
    try {
      new URL(config.webhookUrl);
    } catch {
      return 'webhookUrl must be a valid URL';
    }

    if (config.secret && typeof config.secret !== 'string') {
      return 'secret must be a string';
    }

    return null;
  }

  // Private helper methods

  private mapToWebhookFormat(ticket: Partial<Ticket>): Record<string, any> {
    return {
      id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      severity: ticket.severity || 'medium',
      status: ticket.status || 'open',
      type: ticket.type || 'incident',
      tags: ticket.tags,
      stackId: ticket.stackId,
      externalId: ticket.externalId,
      externalUrl: ticket.externalUrl,
      createdAt: ticket.createdAt?.toISOString(),
      updatedAt: ticket.updatedAt?.toISOString(),
      resolvedAt: ticket.resolvedAt?.toISOString(),
    };
  }

  private async postWebhook(payload: any): Promise<Response> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Sign the payload if secret is configured
    if (this.secret) {
      const signature = crypto
        .createHmac('sha256', this.secret)
        .update(body)
        .digest('hex');

      headers['X-StdOut-Signature'] = `sha256=${signature}`;
    }

    headers['X-StdOut-Timestamp'] = new Date().toISOString();

    try {
      return await fetch(this.webhookUrl, {
        method: 'POST',
        headers,
        body,
      });
    } catch (error) {
      throw new Error(
        `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private sanitizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    } catch {
      return url;
    }
  }
}
