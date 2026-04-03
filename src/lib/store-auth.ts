import fs from 'node:fs';

function getStoreToken(): string {
  let token = process.env.STORE_AUTH_TOKEN;
  if (!token) {
    try { token = fs.readFileSync('/run/secrets/store_auth_token', 'utf-8').trim(); } catch {}
  }
  return token || '';
}

function getStoreUrl(): string {
  return (process.env.STORE_API_URL || 'https://store.seayniclabs.com').replace(/\/$/, '');
}

export type StoreUser = {
  userId: string;
  email: string;
  displayName: string | null;
  role: string;
};

export type StoreAuthError = { error: string };

export async function validateWithStore(email: string, password: string): Promise<StoreUser | null> {
  const token = getStoreToken();
  if (!token) throw new Error('STORE_AUTH_TOKEN not configured');

  let res: Response;
  try {
    res = await fetch(`${getStoreUrl()}/api/auth/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err: any) {
    throw new Error(`Store unreachable: ${err.message}`);
  }

  if (!res.ok) return null;
  const data = await res.json();
  if (!data.valid) return null;

  return { userId: data.userId, email: data.email, displayName: data.displayName ?? null, role: data.role };
}

export async function registerWithStore(
  email: string,
  password: string,
  displayName: string | null,
): Promise<StoreUser | StoreAuthError> {
  const token = getStoreToken();
  if (!token) throw new Error('STORE_AUTH_TOKEN not configured');

  let res: Response;
  try {
    res = await fetch(`${getStoreUrl()}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ email, password, displayName }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err: any) {
    throw new Error(`Store unreachable: ${err.message}`);
  }

  const data = await res.json();
  if (!res.ok) return { error: data.error || 'Registration failed' };

  return { userId: data.userId, email: data.email, displayName: data.displayName ?? null, role: data.role };
}
