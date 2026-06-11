import type { APIRoute } from 'astro';
import crypto from 'node:crypto';

const ED25519_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEActdpqlMQUnc3ObmJXZTVhrJdIXwjsZVzjLl33HxMOwY=
-----END PUBLIC KEY-----`;

const RSA_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAqml6Jvswz/YQOxsw+ipo
YP60nMaqAMJZJbbbjmq7qKZPkkWOuC1NIfTx5y9MM9ULjeVXGmcL19d/AZ0T2mvC
+977g1KBP6cf4cj+xSmSGvpELAO+wpFZOmnnYEsIrNE8xMnk9SftMtYkbuFgFUJh
0Ze8StslLstlbJZUCAOrTOcwGn3DPZDHRZSDFQ+PlSgFOoCxau2LotWMxTpyIcWm
CtV/HTjkIcftunSF9o3scqEilwD9Z/yxuDVUXtfTsHHyj5JysdbR68KpDQQ7ETsl
PjnDE6dSUcJpSxyJo7WlgBeQlXQE5E8hMTN5rJ2d2hbb+Znn+tA0KQKT27tGwrQm
OMGrZiPvthrgpfpQy+Gzj8Zl8GxNxZBZqmwYvtAYY6+mwH32DEutA8+ffQLT5lrq
TR32lMbjyr7xpLmwkut2JX4r38FLD0aav9t3vvHGZNQp/4PFowsO8GSRpyu2WHjC
nZu3hGhf3MUH3V5B3GMH/P18PdVzfuzxry++M+OUFwpB8AFFZCHH1IeGl3k3pBls
EYtOdTfUKXgO1mzUn/xzXLkgVRwTcD8177qc+TjgiuH4vjZ7Mznd6AYxLnZsU/1t
mUsSL37+laA0Ats3L/B3GepcraOuXluV/0YbkAEIFzNkuA64apLeDoH4FmKvfisD
v0orsvF3/0gETuC17zRFFB0CAwEAAQ==
-----END PUBLIC KEY-----`;

function verifySignature(key: string): { valid: boolean; payload?: Record<string, unknown>; reason?: string } {
  if (!key.startsWith('SL-')) return { valid: false, reason: 'Invalid license format' };

  const parts = key.slice(3).split('.');
  if (parts.length !== 2) return { valid: false, reason: 'Invalid license format' };

  const [payloadB64, signatureB64] = parts;
  const sigBytes = Buffer.from(signatureB64, 'base64url');

  try {
    let isValid = false;
    if (sigBytes.length === 64) {
      isValid = crypto.verify(null, Buffer.from(payloadB64), ED25519_PUBLIC_KEY_PEM, sigBytes);
    }
    if (!isValid && sigBytes.length > 64) {
      const verify = crypto.createVerify('RSA-SHA256');
      verify.update(payloadB64);
      verify.end();
      isValid = verify.verify(RSA_PUBLIC_KEY_PEM, signatureB64, 'base64url');
    }
    if (!isValid) return { valid: false, reason: 'Invalid signature' };

    const raw = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    const expires = raw.x ?? raw.expires ?? null;
    if (expires && now > expires) {
      return { valid: false, reason: `License expired on ${new Date(expires * 1000).toLocaleDateString()}` };
    }
    return { valid: true, payload: raw };
  } catch {
    return { valid: false, reason: 'Verification error' };
  }
}

/**
 * POST /api/licenses/activate
 *
 * Called by StdOut during setup when "online" mode is selected.
 * Validates the cryptographic signature server-side and returns
 * the license metadata. No database write — the caller stores the key.
 *
 * Body: { key: string, email: string }
 * Response: { activated: true, email, edition, expires } | { activated: false, error }
 */
export const POST: APIRoute = async ({ request }) => {
  let body: { key?: string; email?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ activated: false, error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const key = (body.key || '').trim();
  const email = (body.email || '').trim().toLowerCase();

  if (!key || !email) {
    return new Response(JSON.stringify({ activated: false, error: 'License key and email are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const result = verifySignature(key);
  if (!result.valid) {
    return new Response(JSON.stringify({ activated: false, error: result.reason }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const raw = result.payload!;
  const keyEmail = ((raw.e ?? raw.email ?? '') as string).toLowerCase();

  // Soft email check — warn but don't block (user may have different purchase email)
  const emailMatch = !keyEmail || keyEmail === email;

  return new Response(JSON.stringify({
    activated: true,
    email: keyEmail || email,
    edition: 'self-host',
    emailMatch,
    expires: (raw.x ?? raw.expires) ? new Date(((raw.x ?? raw.expires) as number) * 1000).toISOString() : null,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
