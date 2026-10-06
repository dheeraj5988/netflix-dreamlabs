/**
 * Helpers for Netflix IDs (the customer's Netflix login email). Most of them
 * are Gmail addresses, where `name+4@gmail.com`, `name+5@gmail.com` and
 * `na.me@gmail.com` all land in the same inbox but are different Netflix
 * accounts. Shared by the server and the admin page.
 */

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

export function normalizeEmail(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

export function isValidEmail(raw: unknown): boolean {
  return /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(normalizeEmail(raw));
}

function split(email: string): { local: string; domain: string } | null {
  const at = email.indexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  return { local: email.slice(0, at), domain: email.slice(at + 1) };
}

/**
 * Identity of the exact address Netflix writes to: dots in a Gmail name are
 * ignored, the +tag is kept. Must match dl_private.email_key() in the SQL.
 */
export function aliasKey(raw: unknown): string {
  const email = normalizeEmail(raw);
  const parts = split(email);
  if (!parts) return email;
  if (GMAIL_DOMAINS.has(parts.domain)) {
    const plus = parts.local.indexOf('+');
    const base = (plus === -1 ? parts.local : parts.local.slice(0, plus)).replace(/\./g, '');
    const tag = plus === -1 ? '' : parts.local.slice(plus);
    return `${base}${tag}@gmail.com`;
  }
  return `${parts.local}@${parts.domain}`;
}

/** The Gmail inbox an address delivers into: dots and +tag are ignored. */
export function mailboxKey(raw: unknown): string {
  const email = normalizeEmail(raw);
  const parts = split(email);
  if (!parts) return email;
  if (GMAIL_DOMAINS.has(parts.domain)) {
    const base = parts.local.split('+')[0].replace(/\./g, '');
    return `${base}@gmail.com`;
  }
  return `${parts.local}@${parts.domain}`;
}
