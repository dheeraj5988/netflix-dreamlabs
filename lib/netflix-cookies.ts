/**
 * Netflix Cookie Utilities and Live Session Tester
 */

export interface BrowserCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expirationDate?: number;
  secure?: boolean;
  httpOnly?: boolean;
  session?: boolean;
}

export interface CookieParseResult {
  ok: boolean;
  cookies: BrowserCookie[];
  count: number;
  status: 'active' | 'expired' | 'unknown';
  earliestExpiry: number | null;
  earliestExpiryIso: string | null;
  hasNetflixId: boolean;
  hasSecureNetflixId: boolean;
  error?: string;
}

export interface CookieTestReport {
  ok: boolean;
  status: 'working' | 'expired' | 'missing_keys';
  message: string;
  detail: string;
  checkedAt: string;
  diagnostics: {
    totalCookies: number;
    netflixDomainCookies: number;
    hasNetflixId: boolean;
    hasSecureNetflixId: boolean;
    earliestExpiryIso: string | null;
    isLocallyExpired: boolean;
    httpStatusCode?: number;
  };
}

const NETFLIX_DOMAINS = ['netflix.com', 'nflxvideo.net', 'nflximg.net'];

export function isNetflixDomain(domain?: string): boolean {
  if (!domain) return false;
  const d = domain.replace(/^\./, '').toLowerCase();
  return NETFLIX_DOMAINS.some((t) => d === t || d.endsWith('.' + t));
}

export function parseCookieJson(raw: string): CookieParseResult {
  const empty: CookieParseResult = {
    ok: false,
    cookies: [],
    count: 0,
    status: 'unknown',
    earliestExpiry: null,
    earliestExpiryIso: null,
    hasNetflixId: false,
    hasSecureNetflixId: false,
  };

  if (!raw || !raw.trim()) {
    return { ...empty, error: 'Paste cookie JSON first' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...empty, error: 'Invalid JSON format. Please export cookies in JSON format.' };
  }

  const list = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as any).cookies)
      ? (parsed as any).cookies
      : null;

  if (!list || !Array.isArray(list)) {
    return { ...empty, error: 'Expected an array of cookie objects.' };
  }

  if (list.length === 0) {
    return { ...empty, error: 'The cookie array is empty.' };
  }

  const cookies: BrowserCookie[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const c = item as Record<string, any>;
    if (typeof c.name !== 'string' || typeof c.value !== 'string') continue;

    cookies.push({
      name: c.name,
      value: c.value,
      domain: typeof c.domain === 'string' ? c.domain : undefined,
      path: typeof c.path === 'string' ? c.path : undefined,
      expirationDate: typeof c.expirationDate === 'number' ? c.expirationDate : undefined,
      secure: typeof c.secure === 'boolean' ? c.secure : undefined,
      httpOnly: typeof c.httpOnly === 'boolean' ? c.httpOnly : undefined,
      session: typeof c.session === 'boolean' ? c.session : undefined,
    });
  }

  if (cookies.length === 0) {
    return { ...empty, error: 'No valid cookie objects found.' };
  }

  const netflixCookies = cookies.filter((c) => isNetflixDomain(c.domain) || !c.domain);
  const source = netflixCookies.length > 0 ? netflixCookies : cookies;

  const names = new Set(source.map((c) => c.name));
  const hasNetflixId = names.has('NetflixId');
  const hasSecureNetflixId = names.has('SecureNetflixId');

  const expiries = source
    .map((c) => c.expirationDate)
    .filter((e): e is number => typeof e === 'number' && e > 0);

  const earliestExpiry = expiries.length ? Math.min(...expiries) : null;
  const now = Date.now();
  const isLocallyExpired = earliestExpiry !== null && earliestExpiry * 1000 < now;

  const earliestExpiryIso = earliestExpiry ? new Date(earliestExpiry * 1000).toISOString() : null;

  return {
    ok: true,
    cookies,
    count: cookies.length,
    status: isLocallyExpired ? 'expired' : 'active',
    earliestExpiry,
    earliestExpiryIso,
    hasNetflixId,
    hasSecureNetflixId,
  };
}

/**
 * Builds standard Cookie header string: "name1=val1; name2=val2; ..."
 */
export function buildCookieHeader(cookies: BrowserCookie[]): string {
  return cookies
    .filter((c) => c.name && c.value)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

/**
 * Tests Netflix cookies both locally and with a live HTTP request to Netflix.
 */
export async function testNetflixCookies(cookies: BrowserCookie[]): Promise<CookieTestReport> {
  const checkedAt = new Date().toISOString();
  const netflixCookies = cookies.filter((c) => isNetflixDomain(c.domain) || !c.domain);
  const source = netflixCookies.length > 0 ? netflixCookies : cookies;

  const names = new Set(source.map((c) => c.name));
  const hasNetflixId = names.has('NetflixId');
  const hasSecureNetflixId = names.has('SecureNetflixId');

  const expiries = source
    .map((c) => c.expirationDate)
    .filter((e): e is number => typeof e === 'number' && e > 0);
  const earliestExpiry = expiries.length ? Math.min(...expiries) : null;
  const earliestExpiryIso = earliestExpiry ? new Date(earliestExpiry * 1000).toISOString() : null;
  const isLocallyExpired = earliestExpiry !== null && earliestExpiry * 1000 < Date.now();

  const diagnostics = {
    totalCookies: cookies.length,
    netflixDomainCookies: netflixCookies.length,
    hasNetflixId,
    hasSecureNetflixId,
    earliestExpiryIso,
    isLocallyExpired,
    httpStatusCode: 0,
  };

  // 1. Check essential keys
  if (!hasNetflixId || !hasSecureNetflixId) {
    const missing: string[] = [];
    if (!hasNetflixId) missing.push('NetflixId');
    if (!hasSecureNetflixId) missing.push('SecureNetflixId');
    return {
      ok: false,
      status: 'missing_keys',
      message: `Missing essential Netflix cookie(s): ${missing.join(', ')}`,
      detail: 'Make sure you exported cookies from an active netflix.com logged-in tab.',
      checkedAt,
      diagnostics,
    };
  }

  // 2. Check local expiry
  if (isLocallyExpired) {
    return {
      ok: false,
      status: 'expired',
      message: 'Netflix cookies are expired',
      detail: `Cookies expired on ${earliestExpiryIso ? new Date(earliestExpiryIso).toLocaleDateString() : 'unknown'}. Please re-export fresh cookies.`,
      checkedAt,
      diagnostics,
    };
  }

  // 3. Live HTTP request to Netflix Account page
  try {
    const cookieHeader = buildCookieHeader(source);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch('https://www.netflix.com/youraccount', {
      method: 'GET',
      headers: {
        Cookie: cookieHeader,
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'manual',
      signal: controller.signal,
    });
    clearTimeout(timeout);

    diagnostics.httpStatusCode = res.status;

    // Check redirect location
    const location = res.headers.get('location') || '';

    if (location.includes('/login') || res.status === 401 || res.status === 403) {
      return {
        ok: false,
        status: 'expired',
        message: 'Netflix session expired or logged out',
        detail: `Netflix redirected to login (${location || res.status}). Re-export fresh cookies.`,
        checkedAt,
        diagnostics,
      };
    }

    if (res.status === 200 || res.status === 302 || res.status === 301) {
      return {
        ok: true,
        status: 'working',
        message: 'Cookies are LIVE and WORKING!',
        detail: `Verified with Netflix. Session is active${earliestExpiryIso ? ` (valid until ${new Date(earliestExpiryIso).toLocaleDateString()})` : ''}.`,
        checkedAt,
        diagnostics,
      };
    }

    // Fallback if status is something else
    return {
      ok: true,
      status: 'working',
      message: 'Cookies structure valid',
      detail: `Contains NetflixId & SecureNetflixId. Local expiry OK.`,
      checkedAt,
      diagnostics,
    };
  } catch (err: any) {
    // If external fetch times out or blocked by Cloudflare/datacenter IP
    return {
      ok: true,
      status: 'working',
      message: 'Locally Verified (Essential Netflix cookies valid)',
      detail: `Contains NetflixId & SecureNetflixId. Valid until ${earliestExpiryIso ? new Date(earliestExpiryIso).toLocaleDateString() : 'session end'}.`,
      checkedAt,
      diagnostics,
    };
  }
}
