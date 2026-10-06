import { NextRequest, NextResponse } from 'next/server';
import { getOrder, getPaypurCredentials, updateOrder } from '@/lib/store';
import { adminRoute } from '@/lib/api-response';
import { amountsMatch, fetchStatus } from '@/lib/paypur';

export const maxDuration = 30;

/**
 * Admin actions on one order:
 *   refresh   ask PayPur for the transaction's status (needs the txn id)
 *   mark_paid for a payment you confirmed in the PayPur dashboard
 */
export const POST = adminRoute(async (request: NextRequest) => {
  const { orderId, action } = await request.json().catch(() => ({}));
  const order = orderId ? await getOrder(String(orderId)) : null;
  if (!order) return NextResponse.json({ ok: false, message: 'Order not found' }, { status: 404 });

  if (action === 'mark_paid') {
    const updated = await updateOrder(order.orderId, { status: 'paid', notes: 'Marked as paid by admin' });
    return NextResponse.json({ ok: true, order: updated, message: 'Order marked as paid' });
  }

  if (action === 'refresh') {
    if (!order.txnId) {
      return NextResponse.json(
        { ok: false, message: 'No PayPur transaction id yet: the customer has not come back from the payment page.' },
        { status: 400 }
      );
    }
    const creds = await getPaypurCredentials();
    if (!creds) return NextResponse.json({ ok: false, message: 'Save the PayPur Gateway Key and Salt in Settings first.' }, { status: 400 });

    const st = await fetchStatus(creds, order.txnId);
    if (!st.ok) return NextResponse.json({ ok: false, message: st.message }, { status: 502 });
    if (st.orderId && st.orderId !== order.orderId) {
      return NextResponse.json({ ok: false, message: 'PayPur says this transaction belongs to a different order.' }, { status: 409 });
    }

    const paid = st.outcome === 'success' && amountsMatch(order.amount, st.amount || order.amount);
    const updated = await updateOrder(order.orderId, {
      status: paid ? 'paid' : st.outcome === 'failed' ? 'failed' : 'pending',
      gatewayStatus: st.rawStatus,
      notes: `PayPur status check: "${st.rawStatus}"`,
    });
    return NextResponse.json({ ok: true, order: updated, message: `PayPur says: ${st.rawStatus}` });
  }

  return NextResponse.json({ ok: false, message: 'Unknown action' }, { status: 400 });
});
