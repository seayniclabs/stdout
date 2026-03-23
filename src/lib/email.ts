import fs from 'node:fs';

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const FROM = process.env.EMAIL_FROM || 'StdOut <noreply@stdout.app>';

function getApiKey(): string {
  try {
    const keyPath = process.env.RESEND_API_KEY_FILE || '/run/secrets/resend_api_key';
    return fs.readFileSync(keyPath, 'utf8').trim();
  } catch {
    return '';
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function wrap(content: string): string {
  return `
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 20px;">
      <div style="font-size: 12px; font-family: monospace; color: #9090A8; margin-bottom: 24px;">
        <span style="color: #FB923C;">></span>_ StdOut
      </div>
      ${content}
      <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #1F1F35; font-size: 11px; color: #5A5A72;">
        You're receiving this because you have a StdOut account. If you didn't request this, you can safely ignore it.
      </div>
    </div>
  `;
}

async function send(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error('Resend API key not found — skipping email');
    return false;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    });
    return res.ok;
  } catch (err) {
    console.error('Email send failed:', err);
    return false;
  }
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<boolean> {
  const resetUrl = `${APP_URL}/app/reset-password?token=${encodeURIComponent(token)}`;
  const html = wrap(`
    <h2 style="font-size: 18px; margin: 0 0 12px;">Reset your password</h2>
    <p style="font-size: 14px; color: #9090A8; line-height: 1.6; margin: 0 0 20px;">
      Someone requested a password reset for your StdOut account. Click the button below to choose a new password. This link expires in 1 hour.
    </p>
    <a href="${escapeHtml(resetUrl)}" style="display: inline-block; padding: 10px 24px; background: #F97316; color: #fff; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600;">Reset password</a>
    <p style="font-size: 12px; color: #5A5A72; margin-top: 16px;">
      Or copy this link: <span style="font-family: monospace; word-break: break-all;">${escapeHtml(resetUrl)}</span>
    </p>
  `);
  return send(to, '[StdOut] Reset your password', html);
}

export async function sendVerificationEmail(to: string, token: string): Promise<boolean> {
  const verifyUrl = `${APP_URL}/app/verify-email?token=${encodeURIComponent(token)}`;
  const html = wrap(`
    <h2 style="font-size: 18px; margin: 0 0 12px;">Verify your email</h2>
    <p style="font-size: 14px; color: #9090A8; line-height: 1.6; margin: 0 0 20px;">
      Welcome to StdOut. Click the button below to verify your email address.
    </p>
    <a href="${escapeHtml(verifyUrl)}" style="display: inline-block; padding: 10px 24px; background: #F97316; color: #fff; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600;">Verify email</a>
  `);
  return send(to, '[StdOut] Verify your email', html);
}
