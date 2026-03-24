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
    <a href="${escapeHtml(resetUrl)}" style="display: inline-block; padding: 10px 24px; background: #C2410C; color: #fff; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600;">Reset password</a>
    <p style="font-size: 12px; color: #5A5A72; margin-top: 16px;">
      Or copy this link: <span style="font-family: monospace; word-break: break-all;">${escapeHtml(resetUrl)}</span>
    </p>
  `);
  return send(to, '[StdOut] Reset your password', html);
}

export async function sendWelcomeEmail(to: string, displayName?: string | null): Promise<boolean> {
  const name = escapeHtml(displayName || 'there');
  const html = wrap(`
    <h2 style="font-size: 18px; margin: 0 0 12px;">Welcome to StdOut, ${name}</h2>
    <p style="font-size: 14px; color: #9090A8; line-height: 1.6; margin: 0 0 20px;">
      Your incident companion is ready. Here's a quick overview of what StdOut does and how to get the most out of it.
    </p>
    <a href="${APP_URL}/app" style="display: inline-block; padding: 10px 24px; background: #C2410C; color: #fff; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600;">Open your dashboard</a>

    <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid #1F1F35;">
      <h3 style="font-size: 14px; color: #E0E0E8; margin: 0 0 12px;">Quick guide to StdOut</h3>

      <p style="font-size: 13px; color: #9090A8; line-height: 1.6; margin: 0 0 10px;">
        <strong style="color: #E0E0E8;">Dashboard</strong><br>
        Your command center. See service health, active incidents, and recent activity at a glance.
      </p>

      <p style="font-size: 13px; color: #9090A8; line-height: 1.6; margin: 0 0 10px;">
        <strong style="color: #E0E0E8;">Scanner</strong><br>
        A Docker sidecar that discovers your infrastructure automatically. Run it once and StdOut maps your entire stack — containers, networks, services.
      </p>

      <p style="font-size: 13px; color: #9090A8; line-height: 1.6; margin: 0 0 10px;">
        <strong style="color: #E0E0E8;">Incidents &amp; AI Diagnosis</strong><br>
        Log what broke. StdOut matches it against past resolutions and uses AI to suggest root causes and next steps.
      </p>

      <p style="font-size: 13px; color: #9090A8; line-height: 1.6; margin: 0 0 10px;">
        <strong style="color: #E0E0E8;">HUD (Uptime Monitoring)</strong><br>
        HTTP and TCP health checks on your services. Auto-creates incidents when something goes down, auto-resolves when it comes back.
      </p>

      <p style="font-size: 13px; color: #9090A8; line-height: 1.6; margin: 0 0 10px;">
        <strong style="color: #E0E0E8;">Knowledge Base</strong><br>
        Build runbooks, postmortems, and guides from your resolutions. Community docs are included so you're not starting from scratch.
      </p>

      <p style="font-size: 13px; color: #9090A8; line-height: 1.6; margin: 0 0 10px;">
        <strong style="color: #E0E0E8;">Infrastructure</strong><br>
        Your Docker stacks visualized — container health, ports, and related incidents grouped by compose project.
      </p>
    </div>

    <p style="font-size: 12px; color: #5A5A72; margin-top: 16px;">
      Questions? Reply to this email — it goes straight to a human.
    </p>
  `);
  return send(to, "Welcome to StdOut — here's how to get started", html);
}

export async function sendVerificationEmail(to: string, token: string): Promise<boolean> {
  const verifyUrl = `${APP_URL}/app/verify-email?token=${encodeURIComponent(token)}`;
  const html = wrap(`
    <h2 style="font-size: 18px; margin: 0 0 12px;">Verify your email</h2>
    <p style="font-size: 14px; color: #9090A8; line-height: 1.6; margin: 0 0 20px;">
      Welcome to StdOut. Click the button below to verify your email address.
    </p>
    <a href="${escapeHtml(verifyUrl)}" style="display: inline-block; padding: 10px 24px; background: #C2410C; color: #fff; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600;">Verify email</a>
  `);
  return send(to, '[StdOut] Verify your email', html);
}
