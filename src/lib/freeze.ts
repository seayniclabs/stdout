// Registration freeze — blocks new account creation when enabled.
// Set REGISTRATION_FREEZE=true to enable.
// Set REGISTRATION_ALLOWLIST to a comma-separated list of emails that can still register.

export function isRegistrationFrozen(): boolean {
  return process.env.REGISTRATION_FREEZE === 'true';
}

export function isEmailAllowlisted(email: string): boolean {
  const raw = process.env.REGISTRATION_ALLOWLIST || '';
  if (!raw) return false;
  const allowed = raw.split(',').map(e => e.trim().toLowerCase());
  return allowed.includes(email.toLowerCase());
}

export function canRegister(email: string): boolean {
  if (!isRegistrationFrozen()) return true;
  return isEmailAllowlisted(email);
}
