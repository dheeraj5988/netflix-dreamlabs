import { NextRequest, NextResponse } from 'next/server';
import {
  normalizeMobile,
  recordTvLogin,
  nextMonthLabel,
  TvLoginResult,
  getAccount,
  finalizeTvLogin,
  updateAccountAfterTvLogin,
} from '@/lib/store';
import { clientIp, describeError, whatsappLink } from '@/lib/api-response';
import { confirmTvCode, TvPairResult } from '@/lib/netflix-tv';

export const maxDuration = 45;

function pairFailureMessage(p: TvPairResult): string {
  switch (p.outcome) {
    case 'invalid_code':
      return `Netflix did not accept this code${p.netflixMessage ? ` ("${p.netflixMessage}")` : ''}. Codes expire after a few minutes: get a fresh code on your TV and try again. Your attempt was not counted.`;
    case 'session_expired':
      return 'Your linked Netflix account needs to be refreshed by our team. Please contact support on WhatsApp. Your attempt was not counted.';
    case 'blocked':
      return 'Netflix could not be reached right now. Please try again in a minute. Your attempt was not counted.';
    default:
      return 'Netflix gave an unexpected answer. Please try again with a fresh code, or contact support on WhatsApp. Your attempt was not counted.';
  }
}

function failureMessage(r: TvLoginResult): string {
  switch (r.reason) {
    case 'not_found':
      return 'No active Netflix subscription found for this mobile number. Please check your number or contact support on WhatsApp.';
    case 'blocked':
      return 'Your access has been blocked. Please contact support on WhatsApp.';
    case 'expired':
      return `Your Netflix subscription expired${r.expiryDate ? ` on ${r.expiryDate}` : ''}. Please renew to continue.`;
    case 'monthly_limit':
      return `Monthly TV login limit reached: you have used ${r.used}/${r.max} TV logins this month. Your limit resets on ${nextMonthLabel()}.`;
    case 'account_unavailable':
      return 'Your Netflix account is being refreshed by our team. Please contact support on WhatsApp.';
    case 'no_account':
      return 'TV login is not set up for your Netflix account yet. Please contact support on WhatsApp.';
    default:
      return 'TV login failed. Please contact support on WhatsApp.';
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const raw = String(body?.mobile || '').replace(/\D/g, '');
  const mobile = normalizeMobile(raw);
  const code = String(body?.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  const fail = (message: string, status: number, extra: Record<string, unknown> = {}) =>
    NextResponse.json({ success: false, message, whatsappUrl: whatsappLink(mobile || raw, message), ...extra }, { status });

  if (!mobile) return fail('Please enter a valid 10-digit mobile number', 400);
  if (code.length < 4) return fail('Please enter a valid TV code (at least 4 characters)', 400);

  try {
    const r = await recordTvLogin(mobile, code, clientIp(request));
    if (!r.ok) {
      return fail(failureMessage(r), r.reason === 'not_found' ? 404 : 403, {
        reason: r.reason,
        currentCount: r.used,
        maxCount: r.max,
        nextAllowedDate: r.reason === 'monthly_limit' ? nextMonthLabel() : undefined,
      });
    }

    // Quota is reserved; now actually confirm the code on Netflix as the account linked to the customer's Netflix ID.
    const account = r.accountId ? await getAccount(r.accountId) : null;
    if (!account) {
      await finalizeTvLogin(mobile, code, false, 'Linked account not found');
      return fail('TV login is not set up for your Netflix account yet. Please contact support on WhatsApp.', 503);
    }

    const pair = await confirmTvCode(account, code);
    await updateAccountAfterTvLogin(account.id, pair.cookies, pair.outcome === 'session_expired', pair.detail);
    await finalizeTvLogin(
      mobile,
      code,
      pair.ok,
      `${pair.ok ? 'Netflix confirmed' : `Netflix: ${pair.outcome}`} - ${pair.detail}${pair.netflixMessage ? ` - "${pair.netflixMessage}"` : ''}`
    );

    if (!pair.ok) {
      console.warn('[tv-login] not confirmed', { account: account.id, outcome: pair.outcome, detail: pair.detail });
      return fail(pairFailureMessage(pair), 502, {
        reason: `netflix_${pair.outcome}`,
        detail: pair.detail,
        currentCount: Math.max(0, r.used - 1),
        maxCount: r.max,
      });
    }

    return NextResponse.json({
      success: true,
      message: 'TV signed in',
      code,
      currentCount: r.used,
      maxCount: r.max,
    });
  } catch (err) {
    const { status, message } = describeError(err);
    return fail(status === 503 ? 'Service temporarily unavailable. Please contact support on WhatsApp.' : message, status);
  }
}
