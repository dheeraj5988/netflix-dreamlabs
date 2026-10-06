import { NextRequest, NextResponse } from 'next/server';
import { findHouseholdLink, MailboxError } from '@/lib/gmailService';
import { checkCustomerEligibility, logActivation, normalizeMobile } from '@/lib/store';
import { clientIp, describeError, whatsappLink } from '@/lib/api-response';

export const maxDuration = 60; // 60 seconds for Vercel serverless functions

/**
 * Household update: only for a valid, active customer (checked here on the
 * server). The link is read from the Gmail inbox of the customer's own Netflix
 * ID, which comes from the database, never from the request. Unlimited uses;
 * each attempt is logged.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const raw = String(body?.mobile || '').replace(/\D/g, '');
  const mobile = normalizeMobile(raw);
  const minutesAgo = Math.min(120, Math.max(5, parseInt(String(body?.minutes || '30'), 10) || 30));

  const fail = (message: string, status: number, extra: Record<string, unknown> = {}) =>
    NextResponse.json({ success: false, message, whatsappUrl: whatsappLink(mobile || raw, message), ...extra }, { status });

  if (!mobile) return fail('Please enter a valid 10-digit mobile number', 400);

  let eligibility;
  try {
    eligibility = await checkCustomerEligibility(mobile, 'household_update');
  } catch (err) {
    const { status, message } = describeError(err);
    return fail(status === 503 ? 'Service temporarily unavailable. Please contact support on WhatsApp.' : message, status);
  }
  if (!eligibility.eligible || !eligibility.customer) {
    return fail(eligibility.message, 403, { reason: eligibility.reason });
  }

  const customer = eligibility.customer;
  const log = async (status: 'success' | 'failed', notes: string) => {
    try {
      await logActivation({
        subscriberId: customer.id,
        mobile,
        netflixEmail: customer.netflixEmail,
        action: 'household_update',
        status,
        ip: clientIp(request),
        notes,
      });
    } catch (err) {
      // The customer still gets the link; the failed log write is visible in Vercel logs.
      describeError(err);
    }
  };

  try {
    const found = await findHouseholdLink(customer.netflixEmail, minutesAgo);

    if (!found.ok) {
      const message =
        found.reason === 'no_email'
          ? `No Netflix update email has arrived for your account in the last ${minutesAgo} minutes. Request the update from your TV or phone first, then try again.`
          : "Netflix's email arrived but the update link could not be read from it. Please request the update again, or contact support on WhatsApp.";
      await log('failed', found.reason === 'no_email' ? 'No recent Netflix email for this Netflix ID' : 'Email found but no update link in it');
      return fail(message, 404, { reason: found.reason });
    }

    await log('success', `Household update link delivered (email received ${found.emailDate.toISOString()})`);
    return NextResponse.json({
      success: true,
      link: found.url,
      emailDate: found.emailDate.toISOString(),
      linkExpiry: '15 minutes from email receipt',
    });
  } catch (err) {
    if (err instanceof MailboxError) {
      console.error('[household]', err.code, err.message, { netflixId: customer.netflixEmail });
      await log('failed', `Mailbox error (${err.code}): ${err.message}`);
      const message =
        err.code === 'not_configured' || err.code === 'auth'
          ? "We couldn't open the mailbox for your Netflix account. Please contact support on WhatsApp."
          : 'Could not reach Gmail right now. Please try again in a minute.';
      return fail(message, err.code === 'not_configured' || err.code === 'auth' ? 503 : 502, { reason: `mailbox_${err.code}` });
    }
    const { status, message } = describeError(err);
    return fail(status === 503 ? 'Service temporarily unavailable. Please contact support on WhatsApp.' : message, status);
  }
}
