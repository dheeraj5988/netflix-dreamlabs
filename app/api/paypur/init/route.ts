import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { countRecentOrders, createOrder, getPaypurCredentials, normalizeMobile, updateOrder } from '@/lib/store';
import { clientIp, describeError, whatsappLink } from '@/lib/api-response';
import { formatAmount, getPlan, planProductInfo } from '@/lib/plans';
import { isValidEmail, normalizeEmail } from '@/lib/emails';
import { initPayment, siteOrigin } from '@/lib/paypur';

export const maxDuration = 30;

/**
 * Starts a purchase: creates the order (price taken from the plan, never from
 * the browser), asks PayPur for a payment link and returns it. The browser then
 * sends the payer to that link. The signing Salt is only used here, on the server.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const mobile = normalizeMobile(String(body?.mobile || '').replace(/\D/g, ''));
  const plan = getPlan(body?.plan);
  const name = String(body?.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const email = normalizeEmail(body?.email);

  const fail = (message: string, status: number, extra: Record<string, unknown> = {}) =>
    NextResponse.json({ success: false, message, whatsappUrl: whatsappLink(mobile || '', message), ...extra }, { status });

  if (!plan) return fail('Please choose a plan', 400);
  if (name.length < 2) return fail('Please enter your name', 400);
  if (!mobile) return fail('Please enter a valid 10-digit mobile number', 400);
  if (!isValidEmail(email)) return fail('Please enter a valid email address', 400);

  try {
    const creds = await getPaypurCredentials();
    if (!creds) {
      return fail('Online payment is not available right now. Please contact us on WhatsApp to buy.', 503, {
        reason: 'gateway_not_configured',
      });
    }
    if ((await countRecentOrders(mobile, 60)) >= 6) {
      return fail('Too many payment attempts for this number. Please try again in an hour or contact us on WhatsApp.', 429);
    }

    const orderId = `order_${crypto.randomBytes(6).toString('hex')}`;
    const amount = formatAmount(plan.price);
    await createOrder({
      orderId,
      mobile,
      customerName: name,
      customerEmail: email,
      planId: plan.id,
      planLabel: plan.label,
      amount: plan.price,
      ip: clientIp(request),
    });

    const origin = siteOrigin(request);
    const init = await initPayment(creds, {
      orderId,
      amount,
      surl: `${origin}/api/paypur/callback/success`,
      furl: `${origin}/api/paypur/callback/failure`,
      productinfo: planProductInfo(plan),
      firstname: name,
      email,
      phone: mobile,
    });

    if (!init.ok) {
      console.error('[paypur] init failed', { orderId, message: init.message });
      await updateOrder(orderId, { status: 'failed', notes: `Init failed: ${init.message}` });
      return fail('We could not start the payment. Please try again in a minute or contact us on WhatsApp.', 502, {
        reason: 'gateway_error',
      });
    }

    await updateOrder(orderId, { status: 'pending', txnId: init.txnId, notes: 'Payment link created' });
    return NextResponse.json({ success: true, orderId, payUrl: init.payUrl });
  } catch (err) {
    const { status, message } = describeError(err);
    return fail(status === 503 ? 'Online payment is not available right now. Please contact us on WhatsApp to buy.' : message, status);
  }
}
