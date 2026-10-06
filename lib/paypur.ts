import 'server-only';
import crypto from 'crypto';
import { NextRequest } from 'next/server';
import type { PaypurCredentials } from './store';

/**
 * PayPur UPI gateway (https://upi.paypur.in).
 *
 *   init    POST /api/merchant/init       header X-PAYPUR-KEY, body signed with the salt
 *           signature = HMAC_SHA256(order_id|amount|surl|furl, salt)
 *   status  GET  /api/merchant/status?txn_id=...   header X-PAYPUR-KEY
 *   return  the payer comes back to surl / furl with order_id, txn_id, status, amount, signature
 *           signature = HMAC_SHA256(txn_id|order_id|status|amount, salt)
 *
 * The Gateway Key is PayPur's API key and the Gateway Salt is its signing
 * secret; both are saved from the admin Settings and read with
 * getPaypurCredentials(). The salt never leaves the server.
 */

const DEFAULT_BASE_URL = 'https://upi.paypur.in';

/** PAYPUR_BASE_URL is only for pointing the app at a sandbox / test double. */
export function paypurBaseUrl(): string {
  return (process.env.PAYPUR_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
}

export function hmacHex(secret: string, message: string): string {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

export function signInit(p: { orderId: string; amount: string; surl: string; furl: string }, salt: string): string {
  return hmacHex(salt, [p.orderId, p.amount, p.surl, p.furl].join('|'));
}

export function verifyCallbackSignature(
  p: { txnId: string; orderId: string; status: string; amount: string; signature: string },
  salt: string
): boolean {
  const expected = hmacHex(salt, [p.txnId, p.orderId, p.status, p.amount].join('|'));
  const given = String(p.signature || '').trim().toLowerCase();
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export type GatewayOutcome = 'success' | 'failed' | 'pending';

const SUCCESS = new Set(['success', 'successful', 'succeeded', 'paid', 'completed', 'complete', 'captured', 'credit', 'approved']);
const FAILED = new Set([
  'failed', 'failure', 'fail', 'cancelled', 'canceled', 'expired', 'declined', 'rejected', 'error', 'timeout', 'aborted',
]);

/**
 * Maps the gateway's status text to paid / failed / still pending. Anything
 * unrecognised counts as pending (never as paid), so an unexpected value can
 * only delay an order, not wrongly activate one.
 */
export function classifyStatus(raw: unknown): GatewayOutcome {
  const s = String(raw ?? '').trim().toLowerCase();
  if (SUCCESS.has(s)) return 'success';
  if (FAILED.has(s)) return 'failed';
  return 'pending';
}

export function amountsMatch(expectedRupees: number, got: unknown): boolean {
  const n = parseFloat(String(got ?? ''));
  return Number.isFinite(n) && Math.abs(n - expectedRupees) < 0.005;
}

/**
 * Public origin of this site (for the return URLs): the Site URL saved in Settings, else the
 * SITE_URL environment variable, else the host the request came in on.
 */
export function siteOrigin(request: NextRequest, configured?: string): string {
  const fixed = (configured || process.env.SITE_URL || '').trim().replace(/\/+$/, '');
  if (fixed) return fixed;
  const url = new URL(request.url);
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0].trim() || url.protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host')?.split(',')[0].trim() || request.headers.get('host') || url.host;
  return `${proto}://${host}`;
}

function pick(obj: any, ...keys: string[]): string | undefined {
  for (const root of [obj, obj?.data]) {
    if (!root || typeof root !== 'object') continue;
    for (const k of keys) {
      const v = root[k];
      if (v !== undefined && v !== null && String(v) !== '') return String(v);
    }
  }
  return undefined;
}

function safePayUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const baseIsHttp = paypurBaseUrl().startsWith('http://');
    if (u.protocol === 'https:' || (baseIsHttp && u.protocol === 'http:')) return u.toString();
  } catch {
    // not a URL
  }
  return null;
}

export type InitResult = { ok: true; payUrl: string; txnId?: string } | { ok: false; message: string };

export async function initPayment(
  creds: PaypurCredentials,
  p: {
    orderId: string;
    amount: string;
    surl: string;
    furl: string;
    productinfo: string;
    firstname: string;
    email: string;
    phone: string;
  }
): Promise<InitResult> {
  const body = {
    order_id: p.orderId,
    amount: p.amount,
    surl: p.surl,
    furl: p.furl,
    productinfo: p.productinfo,
    firstname: p.firstname,
    email: p.email,
    phone: p.phone,
    signature: signInit({ orderId: p.orderId, amount: p.amount, surl: p.surl, furl: p.furl }, creds.salt),
  };
  try {
    const res = await fetch(`${paypurBaseUrl()}/api/merchant/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PAYPUR-KEY': creds.key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    });
    const data: any = await res.json().catch(() => null);
    const ok = res.ok && data && (data.ok === true || data.success === true || pick(data, 'pay_url', 'payUrl'));
    if (!ok) {
      return { ok: false, message: String(pick(data, 'error', 'message') || `PayPur answered HTTP ${res.status}`) };
    }
    const payUrl = safePayUrl(pick(data, 'pay_url', 'payUrl'));
    if (!payUrl) return { ok: false, message: 'PayPur did not return a payment link' };
    return { ok: true, payUrl, txnId: pick(data, 'txn_id', 'txnId', 'transaction_id') };
  } catch (err: any) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return { ok: false, message: timeout ? 'PayPur did not respond in time' : `Could not reach PayPur: ${err?.message || 'network error'}` };
  }
}

export type StatusResult =
  | { ok: true; outcome: GatewayOutcome; rawStatus: string; amount?: string; orderId?: string }
  | { ok: false; message: string };

/** Asks PayPur directly (server to server) what happened to a transaction. */
export async function fetchStatus(creds: PaypurCredentials, txnId: string): Promise<StatusResult> {
  try {
    const res = await fetch(`${paypurBaseUrl()}/api/merchant/status?txn_id=${encodeURIComponent(txnId)}`, {
      headers: { 'X-PAYPUR-KEY': creds.key },
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
    const data: any = await res.json().catch(() => null);
    if (!res.ok || !data) {
      return { ok: false, message: String(pick(data, 'error', 'message') || `PayPur answered HTTP ${res.status}`) };
    }
    const rawStatus = pick(data, 'status', 'payment_status', 'txn_status');
    if (!rawStatus) return { ok: false, message: 'PayPur did not return a status' };
    return { ok: true, outcome: classifyStatus(rawStatus), rawStatus, amount: pick(data, 'amount'), orderId: pick(data, 'order_id', 'orderId') };
  } catch (err: any) {
    return { ok: false, message: `Could not reach PayPur: ${err?.message || 'network error'}` };
  }
}
