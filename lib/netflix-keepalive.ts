import { BrowserCookie, buildCookieHeader } from './netflix-cookies';
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
    let expirationDate: number | undefined = undefined;
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
          expirationDate = Math.floor(parsedTime / 1000);
        }
      } else if (lower.startsWith('max-age=')) {
        const sec = parseInt(attr.slice(8).trim(), 10);
        if (!isNaN(sec)) {
          expirationDate = Math.floor(Date.now() / 1000) + sec;
        }
      } else if (lower === 'secure') {
        secure = true;
      } else if (lower === 'httponly') {
        httpOnly = true;
      }
    }

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

  return {
    merged: Array.from(cookieMap.values()),
    renewedCount,
  };
}

/**
 * Validates and keeps an individual Netflix account session alive.
 * - Pings Netflix with the account's bound User-Agent.
 * - Captures updated Set-Cookie tokens from Netflix response.
 * - Detects live / expiring_soon / needs_reimport / expired statuses.
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

  // 2. Check local cookie expiry
  const expiries = cookies
    .map((c) => c.expirationDate)
    .filter((e): e is number => typeof e === 'number' && e > 0);
  const earliestExpiry = expiries.length ? Math.min(...expiries) : null;
  const earliestExpiryIso = earliestExpiry ? new Date(earliestExpiry * 1000).toISOString() : null;
  const nowMs = Date.now();
  const isLocallyExpired = earliestExpiry !== null && earliestExpiry * 1000 < nowMs;

  if (isLocallyExpired) {
    return {
      ok: false,
      status: 'expired',
      message: 'Netflix cookies are expired',
      detail: `Cookies expired on ${earliestExpiryIso ? new Date(earliestExpiryIso).toLocaleDateString('en-IN') : 'unknown'}. Re-import required.`,
      checkedAt,
      refreshedAt: account.lastRefreshedAt || null,
      cookiesCount: cookies.length,
      renewedCount: 0,
      earliestExpiryIso,
      updatedCookies: cookies,
    };
  }

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
        detail: `Netflix answered HTTP ${res.status} without a login redirect. The session may still be fine; try again later.`,
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

    // Recalculate expiry with merged cookies
    const newExpiries = merged
      .map((c) => c.expirationDate)
      .filter((e): e is number => typeof e === 'number' && e > 0);
    const newEarliest = newExpiries.length ? Math.min(...newExpiries) : earliestExpiry;
    const newEarliestIso = newEarliest ? new Date(newEarliest * 1000).toISOString() : earliestExpiryIso;

    // Check if expiring soon (< 7 days)
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const isExpiringSoon = newEarliest !== null && newEarliest * 1000 - nowMs < sevenDaysMs;

    const finalStatus: 'live' | 'expiring_soon' = isExpiringSoon ? 'expiring_soon' : 'live';
    const refreshedAt = renewedCount > 0 ? checkedAt : account.lastRefreshedAt || null;

    let detail = `Verified with Netflix (HTTP ${res.status}). Session is active`;
    if (renewedCount > 0) {
      detail += ` • Renewed ${renewedCount} session token(s) from Netflix`;
    }
    if (newEarliestIso) {
      detail += ` • Valid until ${new Date(newEarliestIso).toLocaleDateString('en-IN')}`;
    }

    return {
      ok: true,
      status: finalStatus,
      message: isExpiringSoon ? 'Session Expiring Soon' : 'Session Live & Kept Alive',
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
      detail: `Netflix check failed (${err?.name === 'AbortError' ? 'timeout' : err?.message || 'network error'}). Status unknown until the next check.`,
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
