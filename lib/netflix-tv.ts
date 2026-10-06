import 'server-only';
import { BrowserCookie, buildCookieHeader } from './netflix-cookies';
import { mergeUpdatedCookies } from './netflix-keepalive';
import { NetflixAccount } from './store';

/**
 * Confirms a TV sign-in code on netflix.com/tv2 as the given account, the same
 * as a signed-in member typing the code on the website:
 *   1. GET  /tv2  with the account cookies -> page contains a one-time authURL
 *   2. POST /tv2  with authURL + code      -> Netflix links the TV
 */

const TV_URL = 'https://www.netflix.com/tv2';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CODE_MODE = 'enterTvLoginRendezvousCode';

export type TvPairOutcome = 'success' | 'invalid_code' | 'session_expired' | 'blocked' | 'unknown';

export interface TvPairResult {
  ok: boolean;
  outcome: TvPairOutcome;
  /** Short, non-secret description for logs and the admin activity view. */
  detail: string;
  /** Netflix's own error text, if it showed one. */
  netflixMessage?: string;
  /** Cookies after merging anything Netflix refreshed during the exchange. */
  cookies: BrowserCookie[];
}

function setCookies(res: Response): string[] {
  const h = res.headers as any;
  if (typeof h.getSetCookie === 'function') return h.getSetCookie();
  const raw = res.headers.get('set-cookie');
  return raw ? [raw] : [];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function hiddenInput(html: string, name: string): string | null {
  const m = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*value="([^"]*)"`, 'i'));
  return m ? decodeEntities(m[1]) : null;
}

/** Page "mode" from Netflix's embedded reactContext (e.g. enterTvLoginRendezvousCode). */
function pageMode(html: string): string | null {
  const m = html.match(/"trackingInfo":\{[^}]*"mode":"([^"]+)"/) || html.match(/"mode":"([^"]+)"/);
  return m ? m[1] : null;
}

function errorText(html: string): string | undefined {
  const m =
    html.match(/class="[^"]*ui-message-contents[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
    html.match(/data-uia="[^"]*(?:error|UIMessage)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p|span)>/i);
  if (!m) return undefined;
  const text = decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  return text || undefined;
}

function isLoginRedirect(res: Response): boolean {
  const loc = (res.headers.get('location') || '').toLowerCase();
  return res.status >= 300 && res.status < 400 && loc.includes('/login');
}

export async function confirmTvCode(account: NetflixAccount, rawCode: string): Promise<TvPairResult> {
  const code = rawCode.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  let cookies = account.cookies || [];
  const ua = account.userAgent?.trim() || DEFAULT_USER_AGENT;
  const baseHeaders = {
    'User-Agent': ua,
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
  };
  const absorb = (res: Response) => {
    cookies = mergeUpdatedCookies(cookies, setCookies(res)).merged;
  };
  const result = (ok: boolean, outcome: TvPairOutcome, detail: string, netflixMessage?: string): TvPairResult => ({
    ok,
    outcome,
    detail,
    netflixMessage,
    cookies,
  });

  try {
    // 1. Load the code page as the account
    const page = await fetch(TV_URL, {
      headers: {
        ...baseHeaders,
        Cookie: buildCookieHeader(cookies),
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(12000),
      cache: 'no-store',
    });
    absorb(page);

    if (isLoginRedirect(page)) {
      return result(false, 'session_expired', 'Netflix redirected the code page to login: account cookies are logged out');
    }
    if (page.status !== 200) {
      return result(false, 'blocked', `Netflix code page answered HTTP ${page.status}${page.headers.get('location') ? ` -> ${page.headers.get('location')}` : ''}`);
    }

    const html = await page.text();

    // The code page also loads when logged out, so check who Netflix thinks we are.
    const membership = html.match(/"membershipStatus":"([A-Z_]+)"/)?.[1];
    if (membership && membership !== 'CURRENT_MEMBER') {
      return result(
        false,
        'session_expired',
        membership === 'ANONYMOUS'
          ? 'Netflix treats these cookies as logged out (membershipStatus=ANONYMOUS)'
          : `Netflix account is not an active member (membershipStatus=${membership})`
      );
    }

    const authURL = hiddenInput(html, 'authURL');
    if (!authURL) {
      return result(false, 'unknown', `Netflix code page had no authURL (mode=${pageMode(html) || 'none'})`);
    }

    // 2. Submit the code exactly as the website form does
    const form = new URLSearchParams({
      flow: hiddenInput(html, 'flow') || 'websiteSignUp',
      authURL,
      flowMode: hiddenInput(html, 'flowMode') || CODE_MODE,
      withFields: hiddenInput(html, 'withFields') || 'tvLoginRendezvousCode,isTvUrl2',
      code,
      tvLoginRendezvousCode: code,
      isTvUrl2: 'true',
      action: hiddenInput(html, 'action') || 'nextAction',
    });

    const submit = await fetch(TV_URL, {
      method: 'POST',
      headers: {
        ...baseHeaders,
        Cookie: buildCookieHeader(cookies),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Origin: 'https://www.netflix.com',
        Referer: TV_URL,
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Upgrade-Insecure-Requests': '1',
      },
      body: form.toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
    absorb(submit);

    if (isLoginRedirect(submit)) {
      return result(false, 'session_expired', 'Netflix redirected the code submission to login: account cookies are logged out');
    }

    // A redirect away from the code page means Netflix accepted the code.
    const location = submit.headers.get('location') || '';
    if (submit.status >= 300 && submit.status < 400) {
      if (/tv2|tv8/i.test(location) && !/success/i.test(location)) {
        return result(false, 'unknown', `Netflix redirected back to the code page (${location})`);
      }
      return result(true, 'success', `Netflix accepted the code (HTTP ${submit.status} -> ${location || 'no location'})`);
    }

    const body = await submit.text();
    const mode = pageMode(body);
    const message = errorText(body);

    if (submit.status === 200 && mode && mode !== CODE_MODE) {
      return /success|complete|done/i.test(mode) || !message
        ? result(true, 'success', `Netflix accepted the code (page mode=${mode})`)
        : result(false, 'unknown', `Netflix showed page mode=${mode}`, message);
    }
    if (submit.status === 200 && mode === CODE_MODE) {
      return result(false, 'invalid_code', 'Netflix rejected the code (still on the code page)', message);
    }
    return result(false, submit.status === 403 || submit.status === 429 ? 'blocked' : 'unknown', `Netflix answered HTTP ${submit.status} (mode=${mode || 'none'})`, message);
  } catch (err: any) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return result(false, 'blocked', timeout ? 'Netflix did not respond in time' : `Could not reach Netflix: ${err?.message || 'network error'}`);
  }
}
