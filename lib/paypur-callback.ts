import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getOrder, getPaypurCredentials, getSettingsCached, updateOrder } from './store';
import { amountsMatch, classifyStatus, fetchStatus, siteOrigin, verifyCallbackSignature } from './paypur';

/**
 * Where PayPur sends the payer after paying (surl / furl). The query string is
 * not trusted. An order is only marked paid if
 *   1. the callback signature (HMAC of txn_id|order_id|status|amount with the Salt)
 *      is valid, or PayPur itself confirms a transaction that belongs to this order
 *      when asked server to server, and
 *   2. the amount matches the order (the plan and price were fixed by us when the
 *      order was created), and
 *   3. the transaction has not already paid another order (unique index in the DB).
 * A transaction id is only stored if it came from PayPur's init reply or from a
 * correctly signed callback, so a forged callback cannot attach someone else's
 * successful payment to an order.
 * The payer is then sent to /buy/result, which shows the outcome and the WhatsApp
 * button for sending the order details.
 */
async function readParams(request: NextRequest): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URL(request.url).searchParams) out[k] = v;
  if (request.method === 'POST') {
    const type = request.headers.get('content-type') || '';
    try {
      if (type.includes('application/json')) {
        const body = await request.json();
        for (const [k, v] of Object.entries(body || {})) out[k] = String(v);
      } else {
        const form = await request.formData();
        form.forEach((v, k) => {
          out[k] = String(v);
        });
      }
    } catch {
      // no body
    }
  }
  return out;
}

export async function handlePaypurCallback(request: NextRequest): Promise<NextResponse> {
  const params = await readParams(request);
  const origin = siteOrigin(request, (await getSettingsCached()).siteUrl);
  const go = (path: string) => NextResponse.redirect(new URL(path, origin), 303);

  const orderId = String(params.order_id || '').trim();
  try {
    const order = orderId ? await getOrder(orderId) : null;
    if (!order) return go('/buy/result?error=notfound');
    const result = go(`/buy/result?order=${encodeURIComponent(order.orderId)}`);

    const creds = await getPaypurCredentials();
    if (!creds) return result;

    const queryTxn = String(params.txn_id || '').trim();
    const status = String(params.status || '').trim();
    const amount = String(params.amount || '').trim();
    const signatureOk = verifyCallbackSignature(
      { txnId: queryTxn, orderId: order.orderId, status, amount, signature: String(params.signature || '') },
      creds.salt
    );

    // The transaction we may rely on: the signed one, else the one PayPur gave us at init.
    const trustedTxn = (signatureOk && queryTxn) || order.txnId || '';

    let outcome = signatureOk ? classifyStatus(status) : ('pending' as ReturnType<typeof classifyStatus>);
    let note = signatureOk ? `Callback verified, PayPur status "${status}"` : 'Callback signature did not match';
    let rawStatus = signatureOk ? status : '';

    if (signatureOk && outcome === 'success' && !amountsMatch(order.amount, amount)) {
      outcome = 'pending';
      note = `Callback amount ${amount} does not match the order amount ${order.amount}`;
    }

    // Unverified or undecided: ask PayPur directly about the transaction that belongs to this order.
    if ((!signatureOk || outcome === 'pending') && trustedTxn) {
      const st = await fetchStatus(creds, trustedTxn);
      if (!st.ok) {
        if (!signatureOk) note = `Callback signature did not match and PayPur could not confirm it (${st.message})`;
      } else if (st.orderId && st.orderId !== order.orderId) {
        outcome = 'pending';
        note = `PayPur says transaction ${trustedTxn} belongs to a different order`;
      } else {
        rawStatus = st.rawStatus;
        if (st.outcome === 'success') {
          const amountOk = amountsMatch(order.amount, st.amount || amount || order.amount);
          outcome = amountOk ? 'success' : 'pending';
          note = amountOk
            ? `Confirmed by PayPur status check ("${st.rawStatus}")`
            : `PayPur reports success but the amount ${st.amount} differs from the order amount ${order.amount}`;
        } else {
          outcome = st.outcome;
          note = `PayPur status check: "${st.rawStatus}"`;
        }
      }
    }

    const status2 = outcome === 'success' ? 'paid' : outcome === 'failed' ? 'failed' : 'pending';
    try {
      await updateOrder(order.orderId, {
        status: status2,
        txnId: signatureOk && queryTxn ? queryTxn : undefined,
        gatewayStatus: rawStatus || null,
        notes: note,
      });
    } catch (err: any) {
      if (!/duplicate key|dl_orders_paid_txn_uniq/i.test(String(err?.message))) throw err;
      await updateOrder(order.orderId, { status: 'pending', notes: 'This transaction has already paid another order' });
    }
    return result;
  } catch (err) {
    console.error('[paypur-callback]', err);
    return go(orderId ? `/buy/result?order=${encodeURIComponent(orderId)}` : '/buy/result?error=notfound');
  }
}
