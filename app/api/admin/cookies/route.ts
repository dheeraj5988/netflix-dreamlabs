import { NextRequest, NextResponse } from 'next/server';
import { deleteAccount, saveAccount, AccountStatus } from '@/lib/store';
import { adminRoute } from '@/lib/api-response';
import { parseCookieJson, BrowserCookie } from '@/lib/netflix-cookies';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export const POST = adminRoute(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  const { id, profileName, accountLabel, accountEmail, cookiesRaw, cookies, userAgent, deviceMetadata } = body;

  let parsed: BrowserCookie[] | null = null;
  if (typeof cookiesRaw === 'string' && cookiesRaw.trim()) {
    const result = parseCookieJson(cookiesRaw);
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.error || 'Invalid cookie JSON' }, { status: 400 });
    }
    parsed = result.cookies;
  } else if (Array.isArray(cookies)) {
    parsed = cookies;
  }
  if (!parsed || parsed.length === 0) {
    return NextResponse.json({ ok: false, message: 'Please provide valid cookie data' }, { status: 400 });
  }

  const expiries = parsed
    .map((c) => c.expirationDate)
    .filter((e): e is number => typeof e === 'number' && e > 0);
  const earliest = expiries.length ? Math.min(...expiries) * 1000 : null;
  const now = Date.now();
  const status: AccountStatus =
    earliest !== null && earliest < now
      ? 'expired'
      : earliest !== null && earliest - now < 7 * 24 * 60 * 60 * 1000
        ? 'expiring_soon'
        : 'live';

  // The user-agent the cookies were exported with: Netflix ties sessions to it.
  const ua = (typeof userAgent === 'string' && userAgent.trim()) || request.headers.get('user-agent') || DEFAULT_USER_AGENT;
  const name = String(profileName || accountLabel || 'Netflix Account').trim();

  const account = await saveAccount(
    {
      profileName: name,
      accountLabel: String(accountLabel || name).trim(),
      accountEmail: String(accountEmail || '').trim(),
      userAgent: ua,
      deviceMetadata: deviceMetadata || (id ? undefined : { platform: 'web', importedAt: new Date().toISOString() }),
      cookies: parsed,
      status,
      earliestExpiryIso: earliest ? new Date(earliest).toISOString() : null,
    },
    id || undefined
  );
  return NextResponse.json({ ok: true, account });
});

export const DELETE = adminRoute(async (request: NextRequest) => {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, message: 'Missing account ID' }, { status: 400 });
  await deleteAccount(id);
  return NextResponse.json({ ok: true });
});
