/**
 * Error Catalog
 *
 * Central registry of all error codes in the StdOut system.
 * Error codes are immutable and permanent.
 */

import type { ErrorDefinition } from './types';

export const ERROR_CATALOG: Record<string, ErrorDefinition> = {
  // ===== Installation Errors (E1xxx) =====

  E1001: {
    code: 'E1001',
    category: 'license',
    severity: 'error',
    userMessage: "The email address doesn't match this license key.",
    technicalDetail: 'License validation API returned: email mismatch',
    actions: [
      'Check your purchase confirmation email for the correct license key',
      'Verify you\'re using the same email address from your purchase',
      'Contact support@seayniclabs.com if you need help',
    ],
    recoverable: true,
    retryable: false,
    escalationPath: 'support@seayniclabs.com',
    relatedDocs: ['https://docs.stdout.seayniclabs.com/installation/license'],
  },

  E1002: {
    code: 'E1002',
    category: 'license',
    severity: 'error',
    userMessage: 'This license has expired.',
    technicalDetail: 'License expiration date has passed',
    actions: [
      'Contact support@seayniclabs.com to renew your license',
      'Check your account at https://store.seayniclabs.com for renewal options',
    ],
    recoverable: false,
    retryable: false,
    escalationPath: 'support@seayniclabs.com',
    relatedDocs: ['https://docs.stdout.seayniclabs.com/licensing/renewal'],
  },

  E1003: {
    code: 'E1003',
    category: 'license',
    severity: 'warning',
    userMessage: 'License server is unreachable. Check your internet connection.',
    technicalDetail: 'License API timeout or network error',
    actions: [
      'Verify your internet connection is working',
      'Check if stdout-licenses.fly.dev is accessible',
      'Wait a moment and try again',
    ],
    recoverable: true,
    retryable: true,
    retryStrategy: {
      maxAttempts: 3,
      backoff: 'exponential',
      delayMs: 5000,
    },
    escalationPath: 'support@seayniclabs.com',
  },

  E1004: {
    code: 'E1004',
    category: 'license',
    severity: 'error',
    userMessage: 'License activation limit reached.',
    technicalDetail: 'Max activations exceeded for this license key',
    actions: [
      'You\'ve used all available activations for this license',
      'Deactivate StdOut on another machine to free up an activation slot',
      'Contact support@seayniclabs.com to increase your activation limit',
    ],
    recoverable: false,
    retryable: false,
    escalationPath: 'support@seayniclabs.com',
    relatedDocs: ['https://docs.stdout.seayniclabs.com/licensing/activations'],
  },

  // ===== Docker Errors (E2xxx) =====

  E2001: {
    code: 'E2001',
    category: 'docker',
    severity: 'error',
    userMessage: 'Docker is not running on this machine.',
    technicalDetail: 'Cannot connect to Docker daemon',
    actions: [
      'Start Docker Desktop (macOS/Windows) or dockerd (Linux)',
      'Verify Docker is installed: docker --version',
      'Check Docker service status: systemctl status docker (Linux)',
    ],
    recoverable: true,
    retryable: false,
    escalationPath: 'https://docs.docker.com/get-docker/',
  },

  E2002: {
    code: 'E2002',
    category: 'docker',
    severity: 'error',
    userMessage: 'Failed to download container images. Check your internet connection.',
    technicalDetail: 'Docker pull failed',
    actions: [
      'Verify your internet connection is working',
      'Check if ghcr.io is accessible',
      'If behind a proxy, configure Docker proxy settings',
      'Retry the installation',
    ],
    recoverable: true,
    retryable: true,
    retryStrategy: {
      maxAttempts: 2,
      backoff: 'linear',
      delayMs: 10000,
    },
  },

  E2003: {
    code: 'E2003',
    category: 'docker',
    severity: 'error',
    userMessage: 'Port 8112 is already in use by another application.',
    technicalDetail: 'Port conflict detected',
    actions: [
      'Stop the application using port 8112',
      'Find what\'s using the port: lsof -i :8112 (macOS/Linux) or netstat -ano | findstr :8112 (Windows)',
      'Or, edit docker-compose.yml to use a different port',
    ],
    recoverable: true,
    retryable: false,
  },

  E2004: {
    code: 'E2004',
    category: 'docker',
    severity: 'error',
    userMessage: 'Insufficient disk space. StdOut needs at least 2GB available.',
    technicalDetail: 'Disk space check failed',
    actions: [
      'Free up disk space on your system',
      'Remove unused Docker images: docker system prune',
      'Check available space: df -h (macOS/Linux) or dir (Windows)',
    ],
    recoverable: true,
    retryable: false,
  },

  // ===== Database Errors (E3xxx - Installation, E5xxx - Runtime) =====

  E3001: {
    code: 'E3001',
    category: 'database',
    severity: 'error',
    userMessage: 'Database initialization failed.',
    technicalDetail: 'Schema creation or migration failed during installation',
    actions: [
      'Check disk space is available',
      'Verify the data directory is writable',
      'Retry the installation',
      'If persists, contact support@seayniclabs.com with error code E3001',
    ],
    recoverable: true,
    retryable: true,
    retryStrategy: {
      maxAttempts: 1,
      backoff: 'linear',
      delayMs: 0,
    },
    escalationPath: 'support@seayniclabs.com',
  },

  E3002: {
    code: 'E3002',
    category: 'database',
    severity: 'critical',
    userMessage: 'Database migration failed. Contact support immediately.',
    technicalDetail: 'Migration script execution failed',
    actions: [
      'DO NOT restart the container',
      'Contact support@seayniclabs.com with error code E3002',
      'Provide the contents of /data/central.db-journal if it exists',
    ],
    recoverable: false,
    retryable: false,
    escalationPath: 'support@seayniclabs.com (URGENT)',
  },

  // ===== Configuration Errors (E4xxx) =====

  E4001: {
    code: 'E4001',
    category: 'config',
    severity: 'error',
    userMessage: 'Invalid email address format.',
    technicalDetail: 'Email validation failed',
    actions: [
      'Enter a valid email address (e.g., user@example.com)',
    ],
    recoverable: true,
    retryable: false,
  },

  E4002: {
    code: 'E4002',
    category: 'config',
    severity: 'error',
    userMessage: 'Password is too weak. Minimum 8 characters required.',
    technicalDetail: 'Password length validation failed',
    actions: [
      'Use a password with at least 8 characters',
      'Include a mix of letters, numbers, and symbols for better security',
    ],
    recoverable: true,
    retryable: false,
  },

  // ===== Runtime Database Errors (E5xxx) =====

  E5001: {
    code: 'E5001',
    category: 'database',
    severity: 'warning',
    userMessage: 'Database connection lost. Reconnecting...',
    technicalDetail: 'SQLite connection dropped, attempting reconnect',
    actions: [
      'Wait 5 seconds for automatic reconnection',
      'If persists: check disk space',
      'If persists: restart StdOut container',
    ],
    recoverable: true,
    retryable: true,
    retryStrategy: {
      maxAttempts: -1,
      backoff: 'exponential',
      delayMs: 5000,
    },
  },

  E5002: {
    code: 'E5002',
    category: 'database',
    severity: 'warning',
    userMessage: 'Database is locked by another process. Retrying...',
    technicalDetail: 'SQLite SQLITE_BUSY error',
    actions: [
      'Wait for the current operation to complete',
      'This usually resolves automatically within a few seconds',
    ],
    recoverable: true,
    retryable: true,
    retryStrategy: {
      maxAttempts: 3,
      backoff: 'linear',
      delayMs: 1000,
    },
  },

  E5003: {
    code: 'E5003',
    category: 'database',
    severity: 'critical',
    userMessage: 'Database corruption detected. Restoring from latest backup.',
    technicalDetail: 'SQLite integrity check failed',
    actions: [
      'IMMEDIATE: Stop all database writes',
      'Restore from /data/backups/<latest>',
      'If no backup exists, contact support@seayniclabs.com URGENTLY',
      'Do not restart container until backup restored',
    ],
    recoverable: false,
    retryable: false,
    escalationPath: 'support@seayniclabs.com (URGENT)',
    relatedDocs: ['https://docs.stdout.seayniclabs.com/ops/restore'],
  },

  // ===== API Integration Errors (E6xxx) =====

  E6001: {
    code: 'E6001',
    category: 'integration',
    severity: 'error',
    userMessage: 'Anthropic API key is invalid.',
    technicalDetail: 'Authentication failed with Anthropic API',
    actions: [
      'Verify your API key in Settings > Integrations',
      'Get a new API key from https://console.anthropic.com',
      'Ensure the key starts with "sk-ant-"',
    ],
    recoverable: true,
    retryable: false,
    relatedDocs: ['https://docs.anthropic.com/claude/reference/getting-started-with-the-api'],
  },

  E6002: {
    code: 'E6002',
    category: 'integration',
    severity: 'warning',
    userMessage: 'Anthropic API rate limit reached. Retrying in 60 seconds.',
    technicalDetail: 'HTTP 429 Too Many Requests from Anthropic API',
    actions: [
      'Wait for automatic retry in 60 seconds',
      'Consider upgrading your Anthropic API plan for higher rate limits',
    ],
    recoverable: true,
    retryable: true,
    retryStrategy: {
      maxAttempts: 1,
      backoff: 'linear',
      delayMs: 60000,
    },
  },

  E6003: {
    code: 'E6003',
    category: 'integration',
    severity: 'warning',
    userMessage: 'Anthropic API timeout. Retrying...',
    technicalDetail: 'Request to Anthropic API timed out',
    actions: [
      'Check your internet connection',
      'Wait for automatic retry',
      'If persists, check Anthropic API status at https://status.anthropic.com',
    ],
    recoverable: true,
    retryable: true,
    retryStrategy: {
      maxAttempts: 2,
      backoff: 'linear',
      delayMs: 5000,
    },
  },

  // ===== Docker Runtime Errors (E7xxx) =====

  E7001: {
    code: 'E7001',
    category: 'docker',
    severity: 'error',
    userMessage: 'Failed to connect to Docker. Is Docker running?',
    technicalDetail: 'Cannot connect to Docker socket',
    actions: [
      'Ensure Docker is running',
      'Check Docker socket permissions',
      'Restart the StdOut container',
    ],
    recoverable: true,
    retryable: true,
    retryStrategy: {
      maxAttempts: 3,
      backoff: 'linear',
      delayMs: 5000,
    },
  },

  E7002: {
    code: 'E7002',
    category: 'docker',
    severity: 'warning',
    userMessage: 'Container health check failed. Retrying...',
    technicalDetail: 'Health endpoint returned non-200 status',
    actions: [
      'Wait for container to fully initialize',
      'This is normal during startup',
      'If persists beyond 2 minutes, check container logs',
    ],
    recoverable: true,
    retryable: true,
    retryStrategy: {
      maxAttempts: 3,
      backoff: 'linear',
      delayMs: 10000,
    },
  },

  // ===== AI Errors (E8xxx) =====

  E8001: {
    code: 'E8001',
    category: 'ai',
    severity: 'warning',
    userMessage: 'AI analysis unavailable. Using rule-based fallback.',
    technicalDetail: 'Anthropic API call failed, using heuristic analysis',
    actions: [
      'Your incident is still being processed',
      'Results may be less detailed than usual',
      'AI will retry on next incident',
    ],
    recoverable: true,
    retryable: false,
    gracefulDegradation: true,
  },

  E8002: {
    code: 'E8002',
    category: 'ai',
    severity: 'warning',
    userMessage: 'Incident too large for AI analysis. Showing raw logs.',
    technicalDetail: 'Context exceeds 200K tokens',
    actions: [
      'View logs manually in the Logs tab',
      'Consider splitting into multiple incidents',
      'Use filters to reduce log volume',
    ],
    recoverable: true,
    retryable: false,
    gracefulDegradation: true,
  },

  // ===== Auth Errors (E9xxx) =====

  E9001: {
    code: 'E9001',
    category: 'auth',
    severity: 'error',
    userMessage: 'Invalid email or password.',
    technicalDetail: 'Authentication failed',
    actions: [
      'Check your email and password',
      'Use the Forgot Password link if needed',
    ],
    recoverable: true,
    retryable: false,
  },

  E9002: {
    code: 'E9002',
    category: 'auth',
    severity: 'warning',
    userMessage: 'Your session has expired. Please log in again.',
    technicalDetail: 'Session token invalid or expired',
    actions: [
      'Log in again to continue',
    ],
    recoverable: true,
    retryable: false,
  },

  E9003: {
    code: 'E9003',
    category: 'auth',
    severity: 'error',
    userMessage: 'Account temporarily locked after multiple failed login attempts.',
    technicalDetail: 'Rate limit triggered on authentication',
    actions: [
      'Wait 15 minutes before trying again',
      'Use the Forgot Password link to reset your password',
    ],
    recoverable: true,
    retryable: false,
  },

  // ===== Unknown Error (E9999) =====

  E9999: {
    code: 'E9999',
    category: 'config',
    severity: 'error',
    userMessage: 'An unexpected error occurred.',
    technicalDetail: 'Uncaught exception',
    actions: [
      'Retry your last action',
      'If persists, contact support@seayniclabs.com with error code E9999',
      'Include the timestamp and what you were trying to do',
    ],
    recoverable: true,
    retryable: false,
    escalationPath: 'support@seayniclabs.com',
  },
};
