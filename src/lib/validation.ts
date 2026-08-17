/**
 * Input validation utilities - SECURITY ENHANCEMENT (2026-08-16)
 * Prevents DoS via mega-strings and enforces reasonable input limits
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export const INPUT_LIMITS = {
  // User input fields
  EMAIL_MAX: 320,           // RFC 5321 max email length
  PASSWORD_MIN: 8,
  PASSWORD_MAX: 128,        // NIST recommendation
  DISPLAY_NAME_MAX: 100,

  // Content fields
  TITLE_MAX: 500,
  DESCRIPTION_MAX: 100_000, // ~100KB text
  TAGS_MAX: 1000,           // Comma-separated list
  URL_MAX: 2048,            // Max URL length

  // Search/query
  SEARCH_QUERY_MAX: 500,

  // API fields
  API_TOKEN_NAME_MAX: 100,
  MONITOR_NAME_MAX: 200,

  // File uploads
  FILE_SIZE_MAX: 5 * 1024 * 1024, // 5MB
} as const;

export function validateLength(
  value: string | undefined | null,
  fieldName: string,
  min: number = 0,
  max: number
): ValidationResult {
  if (!value || value.length === 0) {
    if (min > 0) {
      return { valid: false, error: `${fieldName} is required` };
    }
    return { valid: true };
  }

  if (value.length < min) {
    return { valid: false, error: `${fieldName} must be at least ${min} characters` };
  }

  if (value.length > max) {
    return { valid: false, error: `${fieldName} must not exceed ${max} characters` };
  }

  return { valid: true };
}

export function validateEmail(email: string | undefined | null): ValidationResult {
  const lengthCheck = validateLength(email, 'Email', 1, INPUT_LIMITS.EMAIL_MAX);
  if (!lengthCheck.valid) return lengthCheck;

  // Basic email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email!)) {
    return { valid: false, error: 'Invalid email format' };
  }

  return { valid: true };
}

export function validateUrl(url: string | undefined | null, fieldName: string = 'URL'): ValidationResult {
  const lengthCheck = validateLength(url, fieldName, 1, INPUT_LIMITS.URL_MAX);
  if (!lengthCheck.valid) return lengthCheck;

  try {
    new URL(url!);
    return { valid: true };
  } catch {
    return { valid: false, error: `${fieldName} must be a valid URL` };
  }
}

export function validateRequired(value: unknown, fieldName: string): ValidationResult {
  if (value === undefined || value === null || value === '') {
    return { valid: false, error: `${fieldName} is required` };
  }
  return { valid: true };
}

/**
 * Sanitize user input to prevent common injection attacks
 */
export function sanitizeInput(input: string, maxLength: number): string {
  // Trim whitespace
  let sanitized = input.trim();

  // Enforce length limit
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized;
}

/**
 * Validate and sanitize a string field with length limits
 */
export function validateAndSanitize(
  value: string | undefined | null,
  fieldName: string,
  min: number,
  max: number
): { valid: boolean; error?: string; sanitized?: string } {
  const validation = validateLength(value, fieldName, min, max);
  if (!validation.valid) {
    return validation;
  }

  const sanitized = value ? sanitizeInput(value, max) : '';
  return { valid: true, sanitized };
}

/**
 * SECURITY FIX (2026-08-16): CSV injection protection
 * Prevents formula execution in Excel/Google Sheets when CSV is opened
 */
export function sanitizeCSVValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }

  const str = String(value);

  // Check if value starts with formula trigger characters
  if (/^[=+@-]/.test(str)) {
    // Prefix with single quote to prevent formula execution
    return `'${str}`;
  }

  // Escape double quotes for proper CSV formatting
  if (str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  // Quote values containing commas or newlines
  if (str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str}"`;
  }

  return str;
}

/**
 * Convert array of objects to CSV with formula injection protection
 */
export function toSafeCSV<T extends Record<string, unknown>>(
  data: T[],
  headers: string[]
): string {
  if (data.length === 0) {
    return headers.join(',') + '\n';
  }

  // Build CSV header
  const csvHeader = headers.map(h => sanitizeCSVValue(h)).join(',');

  // Build CSV rows
  const csvRows = data.map(row => {
    return headers.map(header => {
      const value = row[header];
      return sanitizeCSVValue(value);
    }).join(',');
  });

  return [csvHeader, ...csvRows].join('\n');
}
