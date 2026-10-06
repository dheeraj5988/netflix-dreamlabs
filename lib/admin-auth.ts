import 'server-only';
import crypto from 'crypto';
import { NextRequest } from 'next/server';

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Signing secret for admin tokens. ADMIN_SESSION_SECRET if set; otherwise
 * derived from ADMIN_PASSWORD, so changing the password signs everyone out.
 */
function signingSecret(): string | null {
  if (process.env.ADMIN_SESSION_SECRET) return process.env.ADMIN_SESSION_SECRET;
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  return crypto.createHash('sha256').update(`dreamlabs-admin-session:${password}`).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function isAdminPasswordConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

export function checkAdminPassword(password: unknown): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || typeof password !== 'string') return false;
  return safeEqual(password, expected);
}

export function issueAdminToken(): string {
  const secret = signingSecret();
  if (!secret) throw new Error('ADMIN_PASSWORD is not set');
  const ts = Date.now().toString();
  const sig = crypto.createHmac('sha256', secret).update(`admin.${ts}`).digest('hex');
  return `v2.${ts}.${sig}`;
}

export function isValidAdminToken(token: string | null | undefined): boolean {
  const secret = signingSecret();
  if (!secret || !token) return false;
  const [version, ts, sig] = token.trim().split('.');
  if (version !== 'v2' || !ts || !sig) return false;
  const issued = Number(ts);
  if (!Number.isFinite(issued) || Date.now() - issued > TOKEN_TTL_MS || issued > Date.now() + 60_000) return false;
  const expected = crypto.createHmac('sha256', secret).update(`admin.${ts}`).digest('hex');
  return safeEqual(sig, expected);
}

export function verifyAdminRequest(request: NextRequest): boolean {
  const auth = request.headers.get('authorization') || '';
  return isValidAdminToken(auth.replace(/^Bearer\s+/i, ''));
}
