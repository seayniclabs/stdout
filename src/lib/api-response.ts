/**
 * Standard API response helpers
 * Reduces duplicate JSON.stringify + Response boilerplate
 */

export interface ApiErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
}

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data?: T;
  message?: string;
}

/**
 * Return JSON error response
 */
export function jsonError(
  error: string,
  status = 400,
  code?: string,
  details?: unknown
): Response {
  const body: ApiErrorResponse = { error };
  if (code) body.code = code;
  if (details) body.details = details;

  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Return JSON success response
 */
export function jsonSuccess<T>(
  data?: T,
  message?: string,
  status = 200
): Response {
  const body: ApiSuccessResponse<T> = { success: true };
  if (data !== undefined) body.data = data;
  if (message) body.message = message;

  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Return plain JSON response (no wrapper)
 */
export function json<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
