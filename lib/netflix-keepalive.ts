import { BrowserCookie, buildCookieHeader, isAuthCookie, isCookieExpired, loginExpiry } from './netflix-cookies';
import { NetflixAccount, saveAccountHealth } from './store';

export interface KeepaliveReport {
  ok: boolean;
  status: 'live' | 'expiring_soon' | 'needs_reimport' | 'expired' | 'unverified';
  message: string;
  detail: string;
  checkedAt: string;
  refreshedAt: string | null;
  cookiesCount: number;
  renewedCount: number;
  earliestExpiryIso: string | null;
  updatedCookies: BrowserCookie[];
}

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Parses a single Set-Cookie header string into a BrowserCookie object.
 * e.g. "SecureNetflixId=v1...; Path=/; Domain=.netflix.com; Max-Age=31536000; Secure; HttpOnly"
 */
export function parseSetCookieHeader(setCookieStr: string): BrowserCookie | null {
  try {
    const parts = setCookieStr.split(';').map((p) => p.trim());
    if (parts.length === 0) return null;
    const [nameVal, ...attrs] = parts;
    const eqIdx = nameVal.indexOf('=');
    if (eqIdx === -1) return null;

    const name = nameVal.slice(0, eqIdx).trim();
    const value = nameVal.slice(eqIdx + 1).trim();
    if (!name) return null;

    let domain: string | undefined = undefined;
    let path: string | undefined = '/';
    let expires: number | undefined = undefined;
    let maxAge: number | undefined = undefined;
    let secure = false;
    let httpOnly = false;

    for (const attr of attrs) {
      const lower = attr.toLowerCase();
      if (lower.startsWith('domain=')) {
        domain = attr.slice(7).trim();
      } else if (lower.startsWith('path=')) {
        path = attr.slice(5).trim();
      } else if (lower.startsWith('expires=')) {
        const expStr = attr.slice(8).trim();
        const parsedTime = Date.parse(expStr);
        if (!isNaN(parsedTime)) {
          // `Expires=Thu, 01 Jan 1970` is how a cookie is deleted. Keep it above 0 so it is not mistaken for
          // "no expiry date" (a session cookie).
          expires = Math.max(1, Math.floor(parsedTime / 1000));
        }
      } else if (lower.startsWith('max-age=')) {
        const sec = parseInt(attr.slice(8).trim(), 10);
        if (!isNaN(sec)) {
          maxAge = sec;
        }
      } else if (lower === 'secure') {
        secure = true;
      } else if (lower === 'httponly') {
        httpOnly = true;
      }
    }

    // Max-Age wins over Expires (RFC 6265), whatever order Netflix lists them in.
    const expirationDate = maxAge !== undefined ? Math.floor(Date.now() / 1000) + maxAge : expires;

    return {
      name,
      value,
      domain: domain || '.netflix.com',
      path: path || '/',
      expirationDate,
      secure,
      httpOnly,
    };
  } catch {
    return null;
  }
}

/**
 * Merges refreshed Set-Cookie headers into existing cookie pool.
 */
export function mergeUpdatedCookies(
  existing: BrowserCookie[],
  setCookieHeaders: string[]
): { merged: BrowserCookie[]; renewedCount: number } {
  let renewedCount = 0;
  const cookieMap = new Map<string, BrowserCookie>();

  for (const c of existing) {
    if (c.name) {
      cookieMap.set(c.name, { ...c });
    }
  }

  for (const str of setCookieHeaders) {
    const parsed = parseSetCookieHeader(str);
    if (!parsed) continue;

    // Netflix clears a cookie with an empty value or a past expiry. Drop a helper cookie like a
    // browser would, but never let a header erase a stored login cookie: whether the session still
    // works is decided by Netflix's answer to the live check, not by a header we cannot verify.
    if (!parsed.value || isCookieExpired(parsed)) {
      if (!isAuthCookie(parsed.name)) cookieMap.delete(parsed.name);
      continue;
    }

    const prev = cookieMap.get(parsed.name);
    if (!prev || prev.value !== parsed.value) {
      renewedCount++;
    }

    cookieMap.set(parsed.name, {
      name: parsed.name,
      value: parsed.value,
      domain: parsed.domain || prev?.domain || '.netflix.com',
      path: parsed.path || prev?.path || '/',
      expirationDate: parsed.expirationDate ?? prev?.expirationDate,
      secure: parsed.secure || prev?.secure,
      httpOnly: parsed.httpOnly || prev?.httpOnly,
    });
  }

  // Helper cookies that have run out (e.g. a stale 24-hour `gsid`) are dead weight: a browser would not send them.
  const nowMs = Date.now();
  const merged = Array.from(cookieMap.values()).filter((c) => isAuthCookie(c.name) || !isCookieExpired(c, nowMs));

  return { merged, renewedCount };
}

/**
 * Validates and keeps an individual Netflix account session alive.
 * - Pings Netflix with the account's bound User-Agent.
 * - Captures updated Set-Cookie tokens from Netflix response.
 * - Detects live / expiring_soon / needs_reimport / unverified statuses.
 *
 * Netflix is the authority on whether a login still works, so the check always asks Netflix. The
 * expiry dates stored in the cookies are only used to warn early, and only the login cookies
 * (NetflixId / SecureNetflixId) count: Netflix also sets a 24-hour `gsid` and other short-lived helper
 * cookies that say nothing about the session.
 */
export async function runAccountKeepalive(account: NetflixAccount): Promise<KeepaliveReport> {
  const checkedAt = new Date().toISOString();
  const cookies = account.cookies || [];

  // 1. Verify essential Netflix auth tokens exist
  const names = new Set(cookies.map((c) => c.name));
  const hasNetflixId = names.has('NetflixId');
  const hasSecureNetflixId = names.has('SecureNetflixId');

  if (!hasNetflixId || !hasSecureNetflixId) {
    const missing: string[] = [];
    if (!hasNetflixId) missing.push('NetflixId');
    if (!hasSecureNetflixId) missing.push('SecureNetflixId');
    return {
      ok: false,
      status: 'needs_reimport',
      message: 'Missing essential Netflix auth tokens',
      detail: `Session is missing ${missing.join(', ')}. Please re-import cookies.`,
      checkedAt,
      refreshedAt: account.lastRefreshedAt || null,
      cookiesCount: cookies.length,
      renewedCount: 0,
      earliestExpiryIso: null,
      updatedCookies: cookies,
    };
  }

  // 2. When do the login cookies run out? (Informational: Netflix decides below.)
  const nowMs = Date.now();
  const login = loginExpiry(cookies, nowMs);
  const earliestExpiryIso = login.earliestIso;
  const stale = login.pastExpiry
    ? ` The login cookies passed their expiry date (${new Date(login.earliestIso!).toLocaleDateString('en-IN')}).`
    : '';

  // 3. User-Agent binding: use stored userAgent to prevent session revocation
  const userAgent = account.userAgent?.trim() || DEFAULT_USER_AGENT;
  const cookieHeader = buildCookieHeader(cookies);

  // 4. Live request to Netflix account endpoint
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);

    const res = await fetch('https://www.netflix.com/youraccount', {
      method: 'GET',
      headers: {
        Cookie: cookieHeader,
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      },
      redirect: 'manual',
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const location = res.headers.get('location') || '';

    // Netflix sends logged-out sessions to /login
    if (location.toLowerCase().includes('/login')) {
      return {
        ok: false,
        status: 'needs_reimport',
        message: 'Netflix session invalidated',
        detail: `Netflix rejected the session and redirected to login (${location || res.status}). Manual re-import required.`,
        checkedAt,
        refreshedAt: account.lastRefreshedAt || null,
        cookiesCount: cookies.length,
        renewedCount: 0,
        earliestExpiryIso,
        updatedCookies: cookies,
      };
    }

    // Any other non-success answer (e.g. bot protection blocking the server's IP)
    // says nothing about the session itself.
    if (res.status >= 400) {
      return {
        ok: false,
        status: 'unverified',
        message: 'Could not verify with Netflix',
        detail: `Netflix answered HTTP ${res.status} without a login redirect. The session may still be fine; try again later.${stale}`,
        checkedAt,
        refreshedAt: account.lastRefreshedAt || null,
        cookiesCount: cookies.length,
        renewedCount: 0,
        earliestExpiryIso,
        updatedCookies: cookies,
      };
    }

    // Capture updated Set-Cookie headers from Netflix
    let setCookieHeaders: string[] = [];
    if (typeof (res.headers as any).getSetCookie === 'function') {
      setCookieHeaders = (res.headers as any).getSetCookie();
    } else {
      const raw = res.headers.get('set-cookie');
      if (raw) setCookieHeaders = [raw];
    }

    const { merged, renewedCount } = mergeUpdatedCookies(cookies, setCookieHeaders);

    // Netflix accepted the session. Work out when the login cookies run out after any renewal.
    const after = loginExpiry(merged, nowMs);
    // A stored date in the past on a session Netflix still accepts is meaningless: do not show it.
    const newEarliestIso = after.pastExpiry ? null : after.earliestIso;

    const finalStatus: 'live' | 'expiring_soon' = after.expiringSoon ? 'expiring_soon' : 'live';
    const refreshedAt = renewedCount > 0 ? checkedAt : account.lastRefreshedAt || null;

    let detail = `Verified with Netflix (HTTP ${res.status}). Session is active`;
    if (renewedCount > 0) {
      detail += ` • Renewed ${renewedCount} session token(s) from Netflix`;
    }
    if (newEarliestIso) {
      detail += ` • Login valid until ${new Date(newEarliestIso).toLocaleDateString('en-IN')}`;
    } else if (after.pastExpiry) {
      detail += ' • Netflix still accepts this login although its cookie date has passed';
    } else {
      detail += ' • Login cookies have no fixed expiry date';
    }

    return {
      ok: true,
      status: finalStatus,
      message: after.expiringSoon ? 'Session Expiring Soon' : 'Session Live & Kept Alive',
      detail,
      checkedAt,
      refreshedAt,
      cookiesCount: merged.length,
      renewedCount,
      earliestExpiryIso: newEarliestIso,
      updatedCookies: merged,
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 'unverified',
      message: 'Could not reach Netflix',
      detail: `Netflix check failed (${err?.name === 'AbortError' ? 'timeout' : err?.message || 'network error'}). Status unknown until the next check.${stale}`,
      checkedAt,
      refreshedAt: account.lastRefreshedAt || null,
      cookiesCount: cookies.length,
      renewedCount: 0,
      earliestExpiryIso,
      updatedCookies: cookies,
    };
  }
}

/**
 * Runs the keepalive for one account and saves the result to Supabase,
 * including any refreshed cookies Netflix returned.
 */
export async function checkAndSaveAccount(account: NetflixAccount) {
  const report = await runAccountKeepalive(account);
  const saved = await saveAccountHealth(account, {
    ok: report.ok,
    cookies: report.updatedCookies,
    status: report.status,
    lastResult: report.ok ? (report.renewedCount > 0 ? 'refreshed' : 'working') : report.status,
    lastDetail: report.detail || report.message,
    lastCheckedAt: report.checkedAt,
    lastRefreshedAt: report.refreshedAt,
    earliestExpiryIso: report.earliestExpiryIso,
  });
  return { report, account: saved };
}
