import {
  TicketingConnector,
  type ConnectorConfig,
  type ExternalTicket,
  type Ticket,
  type ConnectionTestResult,
} from '../base/TicketingConnector';

/**
 * GitHub Issues Connector
 *
 * Creates and syncs incidents as GitHub Issues.
 * Supports both GitHub Personal Access Tokens (PAT) and Installation Tokens.
 *
 * Config schema:
 * {
 *   owner: string (GitHub username or org)
 *   repo: string (repository name)
 *   token: string (PAT or installation token)
 * }
 */
export class GitHubConnector extends TicketingConnector {
  private owner: string;
  private repo: string;
  private token: string;
  private apiBase = 'https://api.github.com';

  constructor(config: ConnectorConfig) {
    super(config, 'github');

    if (!config.owner || !config.repo || !config.token) {
      throw new Error('GitHub connector requires owner, repo, and token');
    }

    this.owner = config.owner;
    this.repo = config.repo;
    this.token = config.token;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const response = await this.makeRequest(
        `/repos/${this.owner}/${this.repo}`,
        'GET'
      );

      if (!response.ok) {
        return {
          ok: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const data = await response.json();

      return {
        ok: true,
        metadata: {
          workspace: data.full_name,
          user: data.owner?.login,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error instanceof Error ? error.message : String(error) : 'Connection failed',
      };
    }
  }

  async fetchTickets(since?: Date): Promise<ExternalTicket[]> {
    try {
      const params = new URLSearchParams({
        state: 'all',
        sort: 'updated',
        direction: 'desc',
      });

      if (since) {
        params.append('since', since.toISOString());
      }

      const response = await this.makeRequest(
        `/repos/${this.owner}/${this.repo}/issues?${params.toString()}`,
        'GET'
      );

      if (!response.ok) {
        throw new Error(
          `Failed to fetch issues: HTTP ${response.status}`
        );
      }

      const issues = await response.json();

      return issues
        .filter((issue: any) => !issue.pull_request) // Exclude PRs
        .map((issue: any) => this.mapGitHubToExternal(issue));
    } catch (error) {
      throw new Error(
        `Failed to fetch GitHub issues: ${error instanceof Error ? error instanceof Error ? error.message : String(error) : 'Unknown error'}`
      );
    }
  }

  async createTicket(ticket: Ticket): Promise<{ id: string; url: string }> {
    try {
      // Convert severity to GitHub label
      const labels = ['incident'];
      if (ticket.severity && ticket.severity !== 'medium') {
        labels.push(`severity-${ticket.severity}`);
      }

      if (ticket.tags) {
        const tagList = ticket.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 5); // GitHub has label limits
        labels.push(...tagList);
      }

      const body = [
        `**StdOut Incident**`,
        '',
        `Severity: ${ticket.severity || 'medium'}`,
        `Type: ${ticket.type}`,
        '',
        ticket.description || '(No description provided)',
        '',
        ticket.stackId ? `Stack ID: ${ticket.stackId}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const response = await this.makeRequest(
        `/repos/${this.owner}/${this.repo}/issues`,
        'POST',
        {
          title: ticket.title,
          body,
          labels,
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const issue = await response.json();

      return {
        id: issue.number.toString(),
        url: issue.html_url,
      };
    } catch (error) {
      throw new Error(
        `Failed to create GitHub issue: ${error instanceof Error ? error instanceof Error ? error.message : String(error) : 'Unknown error'}`
      );
    }
  }

  async updateTicket(
    externalId: string,
    updates: Partial<Ticket>
  ): Promise<void> {
    try {
      const payload: Record<string, any> = {};

      if (updates.title) payload.title = updates.title;
      if (updates.description) payload.body = updates.description;

      // Map status to GitHub issue state
      if (updates.status) {
        payload.state =
          updates.status === 'resolved' || updates.status === 'closed'
            ? 'closed'
            : 'open';
      }

      // Update labels if severity or tags changed
      if (updates.severity || updates.tags) {
        const labels = ['incident'];
        if (updates.severity && updates.severity !== 'medium') {
          labels.push(`severity-${updates.severity}`);
        }
        if (updates.tags) {
          const tagList = updates.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 5);
          labels.push(...tagList);
        }
        payload.labels = labels;
      }

      const response = await this.makeRequest(
        `/repos/${this.owner}/${this.repo}/issues/${externalId}`,
        'PATCH',
        payload
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      throw new Error(
        `Failed to update GitHub issue: ${error instanceof Error ? error instanceof Error ? error.message : String(error) : 'Unknown error'}`
      );
    }
  }

  mapToInternal(externalTicket: ExternalTicket, userId: string): Ticket {
    // Map severity from labels
    let severity: 'critical' | 'high' | 'medium' | 'low' = 'medium';
    if (externalTicket.tags) {
      const tags = externalTicket.tags.join(' ');
      if (tags.includes('critical'))
        severity = 'critical';
      else if (tags.includes('high'))
        severity = 'high';
      else if (tags.includes('low'))
        severity = 'low';
    }

    return {
      id: `github-${externalTicket.id}`,
      userId,
      type: 'incident',
      title: externalTicket.title,
      description: externalTicket.description,
      severity,
      status:
        externalTicket.status === 'closed' ? 'closed' : 'open',
      tags: externalTicket.tags?.join(','),
      externalSystem: 'github',
      externalId: externalTicket.id,
      externalUrl: externalTicket.url,
      createdAt: externalTicket.createdAt,
      updatedAt: externalTicket.updatedAt,
      resolvedAt:
        externalTicket.status === 'closed'
          ? externalTicket.resolvedAt || new Date()
          : undefined,
    };
  }

  mapToExternal(ticket: Ticket): any {
    return {
      title: ticket.title,
      body: ticket.description,
      state:
        ticket.status === 'resolved' || ticket.status === 'closed'
          ? 'closed'
          : 'open',
      labels: this.buildLabelsFromTicket(ticket),
    };
  }

  static validateConfig(config: ConnectorConfig): string | null {
    if (!config.owner) return 'owner is required';
    if (!config.repo) return 'repo is required';
    if (!config.token) return 'token (PAT or installation token) is required';
    if (typeof config.owner !== 'string')
      return 'owner must be a string';
    if (typeof config.repo !== 'string') return 'repo must be a string';
    if (typeof config.token !== 'string') return 'token must be a string';
    return null;
  }

  // Private helper methods

  private async makeRequest(
    path: string,
    method: string = 'GET',
    body?: any
  ): Promise<Response> {
    const url = `${this.apiBase}${path}`;

    const headers: Record<string, string> = {
      Authorization: `token ${this.token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body) {
      options.body = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }

    try {
      return await fetch(url, options);
    } catch (error) {
      throw new Error(
        `Network error: ${error instanceof Error ? error instanceof Error ? error.message : String(error) : 'Unknown error'}`
      );
    }
  }

  private mapGitHubToExternal(issue: any): ExternalTicket {
    return {
      id: issue.number.toString(),
      title: issue.title,
      description: issue.body || '',
      status: issue.state,
      tags: issue.labels?.map((label: any) => label.name) || [],
      url: issue.html_url,
      createdAt: new Date(issue.created_at),
      updatedAt: new Date(issue.updated_at),
      resolvedAt: issue.closed_at ? new Date(issue.closed_at) : undefined,
    };
  }

  private buildLabelsFromTicket(ticket: Ticket): string[] {
    const labels = ['incident'];
    if (ticket.severity && ticket.severity !== 'medium') {
      labels.push(`severity-${ticket.severity}`);
    }
    if (ticket.tags) {
      const tagList = ticket.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 5);
      labels.push(...tagList);
    }
    return labels;
  }
}
