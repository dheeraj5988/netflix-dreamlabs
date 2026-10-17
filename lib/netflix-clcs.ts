import 'server-only';

/**
 * Netflix's redesigned TV-code page (the "CLCS" page, served on /tv8 and /tv2 to some accounts).
 *
 * It has no classic <form>: the website's script sends the code with a GraphQL mutation
 *   POST https://www.netflix.com/graphql
 *   { operationName: "CLCSScreenUpdate",
 *     variables: { serverState, serverScreenUpdate, inputFields: [{ name: "rendezvousCode", value: { stringValue } }], ... },
 *     extensions: { persistedQuery: { id, version: 102 } } }
 * where serverState and serverScreenUpdate are one-time tokens embedded in the page, and the answer is a screen
 * (or an effect). A wrong code comes back as the same code screen with "That code was incorrect".
 *
 * Everything here is read from the page Netflix just served, and anything we do not recognise is reported as
 * "unknown" with non-secret facts, never as success.
 */

export type ClcsOutcome = 'success' | 'invalid_code' | 'session_expired' | 'blocked' | 'unknown';

export interface ClcsResult {
  outcome: ClcsOutcome;
  detail: string;
  netflixMessage?: string;
}

const GRAPHQL_URL = 'https://www.netflix.com/graphql';
const CODE_SCREEN = 'RENDEZVOUS_CODE_ENTRY';
/** Id of the CLCSScreenUpdate persisted query in the script we studied; used only if it cannot be read from the live script. */
const FALLBACK_QUERY_ID = '43a29c42-1f93-4e18-80b6-97dfbb6483c6';
const queryIdCache = new Map<string, string>();

/** Screens / texts that mean "the TV is now signed in". */
const SUCCESS_SCREEN = /SUCCESS|COMPLETE|CONNECTED|LINKED|ALL_SET|DONE/i;
const SUCCESS_TEXT = /all set|signed in|you.re in|successfully|connected/i;
/** Effects that move the browser on to the next page (for the TV code flow: the success page). */
const NAVIGATION_EFFECTS = new Set(['CLCSReloadCurrentRoute', 'CLCSInAppNavigation', 'CLCSDismissCurrentExperience']);
const SUCCESS_URL = /\/tv\/(?:in|out)\/success|tvLoginSuccess/i;

/** The page's embedded data (netflix.reactContext), with its \xNN escapes decoded. */
export function readPageData(html: string): any | null {
  const m = html.match(/netflix\.reactContext\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1].replace(/\\x([0-9A-Fa-f]{2})/g, '\\u00$1'));
  } catch {
    return null;
  }
}

function findFirst(node: any, test: (o: any) => boolean): any | null {
  if (node && typeof node === 'object') {
    if (!Array.isArray(node) && test(node)) return node;
    for (const v of Object.values(node)) {
      const hit = findFirst(v, test);
      if (hit) return hit;
    }
  }
  return null;
}

export interface SubmitTokens {
  serverState: string;
  serverScreenUpdate: string;
  locale: string;
}

/** serverState and the code-submit effect's serverScreenUpdate from the page. null when the page has neither. */
export function readSubmitTokens(html: string): SubmitTokens | null {
  const data = readPageData(html);
  const clcs = data?.models?.graphqlClcs?.data;
  if (!clcs || typeof clcs !== 'object') return null;
  for (const [key, entry] of Object.entries(clcs)) {
    const screen = findFirst(entry, (o) => typeof o.serverState === 'string' && o.componentTree);
    if (!screen) continue;
    const effect = findFirst(
      screen,
      (o) =>
        o.effectType === 'CLCSRequestScreenUpdate' &&
        typeof o.serverScreenUpdate === 'string' &&
        Array.isArray(o.inputFieldRequirements) &&
        o.inputFieldRequirements.some((r: any) => r?.field?.id === 'rendezvousCode')
    );
    if (!effect) continue;
    // The locale the page itself asked for (it is in the key of the page's own query), else the member's.
    const locale =
      key.match(/"locale":"([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,4})?)"/)?.[1]?.replace('_', '-') ||
      (typeof data?.models?.userInfo?.data?.userLocale?.locale?.id === 'string' ? data.models.userInfo.data.userLocale.locale.id : 'en-US');
    return { serverState: screen.serverState, serverScreenUpdate: effect.serverScreenUpdate, locale };
  }
  return null;
}

/** Persisted-query id of CLCSScreenUpdate, read from the page's own script so it follows Netflix's releases. */
async function resolveQueryIds(html: string, ua: string): Promise<string[]> {
  const ids: string[] = [];
  const bundle = html.match(/https:\/\/assets\.nflxext\.com\/[^"'\s\\]*\/clcs\/login\/client[^"'\s\\]*\.js/)?.[0];
  if (bundle) {
    let id = queryIdCache.get(bundle);
    if (!id) {
      try {
        const res = await fetch(bundle, { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(20000), cache: 'no-store' });
        if (res.ok) {
          const js = await res.text();
          id = js.match(
            /__meta__:\{q:"([0-9a-f-]{36})"\},kind:"Document",definitions:\[\{kind:"OperationDefinition",operation:"mutation",name:\{kind:"Name",value:"CLCSScreenUpdate"\}/
          )?.[1];
          if (id) queryIdCache.set(bundle, id);
        }
      } catch {
        // fall back to the id we know
      }
    }
    if (id) ids.push(id);
  }
  if (!ids.includes(FALLBACK_QUERY_ID)) ids.push(FALLBACK_QUERY_ID);
  return ids;
}

function parseTracking(screen: any): { screenName: string | null } {
  try {
    const t = JSON.parse(screen?.trackingInfo || '{}');
    return { screenName: typeof t.screenName === 'string' ? t.screenName : null };
  } catch {
    return { screenName: null };
  }
}

function collect<T>(node: any, pick: (o: any) => T | undefined, out: T[] = []): T[] {
  if (node && typeof node === 'object') {
    if (!Array.isArray(node)) {
      const v = pick(node);
      if (v !== undefined) out.push(v);
    }
    for (const child of Object.values(node)) collect(child, pick, out);
  }
  return out;
}

/** Turns Netflix's answer to the code submission into an outcome. Exported for tests. */
export function classifyScreenUpdate(payload: any): ClcsResult {
  const firstError = payload?.errors?.[0];
  if (firstError) {
    return {
      outcome: 'unknown',
      detail: `Netflix GraphQL error ${firstError?.extensions?.code || ''}: ${String(firstError?.message || '').slice(0, 160)}`.trim(),
    };
  }
  const result = payload?.data?.result;
  if (!result) return { outcome: 'unknown', detail: 'Netflix GraphQL answer had no result' };
  const kind = String(result.outcomeType || result.__typename || 'none');
  if (result.status === 'FAILURE') return { outcome: 'unknown', detail: `Netflix reported FAILURE (outcome=${kind})` };

  if (kind === 'CLCSScreenUpdateTransition' && result.screen) {
    const { screenName } = parseTracking(result.screen);
    const header = collect(result.screen.componentTree, (o) => (o.testId === 'header' ? o.plainContent?.value : undefined))[0];
    const error = collect(result.screen.componentTree, (o) => o.initialErrorMessage?.value)[0];

    if (screenName === CODE_SCREEN) {
      return error
        ? { outcome: 'invalid_code', detail: 'Netflix rejected the code (code page shown again with an error)', netflixMessage: error }
        : { outcome: 'unknown', detail: `Netflix showed the code page again without an error (outcome=${kind})` };
    }
    if ((screenName && SUCCESS_SCREEN.test(screenName)) || (header && SUCCESS_TEXT.test(header))) {
      return { outcome: 'success', detail: `Netflix accepted the code (screen=${screenName || 'none'}${header ? `, "${header}"` : ''})` };
    }
    return {
      outcome: 'unknown',
      detail: `Netflix moved to an unrecognised screen (outcome=${kind}, screen=${screenName || 'none'}, header=${JSON.stringify(header || '')})`,
      netflixMessage: error,
    };
  }

  if (kind === 'CLCSScreenUpdateEffect' && result.effect) {
    const types = collect(result.effect, (o) => (typeof o.effectType === 'string' ? o.effectType : undefined));
    const urls = collect(result.effect, (o) => (typeof o.url === 'string' ? o.url : typeof o.path === 'string' ? o.path : undefined));
    const toSuccessUrl = urls.some((u) => SUCCESS_URL.test(u));
    const navigates = types.some((t) => NAVIGATION_EFFECTS.has(t));
    const errorToast = types.some((t) => t === 'CLCSShowSystemToast' || t === 'CLCSShowSystemAlert');
    if (toSuccessUrl || (navigates && !errorToast)) {
      return { outcome: 'success', detail: `Netflix accepted the code (effects=${Array.from(new Set(types)).join(',')})` };
    }
    return { outcome: 'unknown', detail: `Netflix answered with effects=[${Array.from(new Set(types)).join(',')}] urls=[${urls.slice(0, 3).join(',')}]` };
  }

  return { outcome: 'unknown', detail: `Netflix answered outcome=${kind}` };
}

export interface SubmitOptions {
  html: string;
  code: string;
  ua: string;
  referer: string;
  /** Current Cookie header for netflix.com. */
  cookieHeader: () => string;
  /** Called with every response so refreshed cookies can be kept. */
  onResponse: (res: Response) => void;
}

/** Sends the TV code on the redesigned page. */
export async function submitRendezvousCode(o: SubmitOptions): Promise<ClcsResult> {
  const tokens = readSubmitTokens(o.html);
  if (!tokens) {
    return { outcome: 'unknown', detail: 'Netflix code page has no submit tokens (serverState / serverScreenUpdate not found in the page data)' };
  }

  const ids = await resolveQueryIds(o.html, o.ua);
  let last: ClcsResult = { outcome: 'unknown', detail: 'Netflix GraphQL was not reached' };

  for (const id of ids) {
    let res: Response;
    try {
      res = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'User-Agent': o.ua,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          'x-netflix.request.clcs.bucket': 'high',
          Origin: 'https://www.netflix.com',
          Referer: o.referer,
          Cookie: o.cookieHeader(),
        },
        body: JSON.stringify({
          operationName: 'CLCSScreenUpdate',
          variables: {
            format: 'HTML',
            imageFormat: 'PNG',
            locale: tokens.locale,
            serverState: tokens.serverState,
            serverScreenUpdate: tokens.serverScreenUpdate,
            inputFields: [{ name: 'rendezvousCode', value: { stringValue: o.code } }],
          },
          extensions: { persistedQuery: { id, version: 102 } },
        }),
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
        cache: 'no-store',
      });
    } catch (err: any) {
      const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      return { outcome: 'blocked', detail: timeout ? 'Netflix did not respond in time' : `Could not reach Netflix: ${err?.message || 'network error'}` };
    }
    o.onResponse(res);

    if (res.status === 401 || (res.status >= 300 && res.status < 400)) {
      return { outcome: 'session_expired', detail: `Netflix GraphQL answered HTTP ${res.status}: account cookies are logged out` };
    }
    const text = await res.text();
    let payload: any = null;
    try {
      payload = JSON.parse(text);
    } catch {
      // not JSON
    }
    if (!payload) {
      return {
        outcome: res.status === 403 || res.status === 429 ? 'blocked' : 'unknown',
        detail: `Netflix GraphQL answered HTTP ${res.status} (${text.length} bytes, not JSON)`,
      };
    }

    last = classifyScreenUpdate(payload);
    // The persisted query id changes when Netflix ships a new script: try the next candidate id.
    const notFound = JSON.stringify(payload?.errors || '').match(/PERSISTED_QUERY_NOT_FOUND|PersistedQueryNotFound/i);
    if (!notFound) return { ...last, detail: `${last.detail} [graphql HTTP ${res.status}]` };
  }
  return last;
}
