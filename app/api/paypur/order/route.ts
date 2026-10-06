import { NextRequest, NextResponse } from 'next/server';
import { getOrder, getPaypurCredentials, updateOrder } from '@/lib/store';
import { describeError } from '@/lib/api-response';
import { orderWhatsappLink, whatsappLink } from '@/lib/support';
import { getBrand } from '@/lib/branding';
import { amountsMatch, fetchStatus } from '@/lib/paypur';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Status of one order for the /buy/result page. The random order id is the
 * only key. `refresh=1` asks PayPur again for an order that is not paid yet
 * (at most every 10 seconds per order).
 */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const id = String(params.get('id') || '').trim();
  if (!/^order_[a-z0-9]{6,40}$/i.test(id)) {
    return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
  }

  try {
    let order = await getOrder(id);
    if (!order) return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });

    if (params.get('refresh') === '1' && order.status !== 'paid' && order.txnId) {
      const recent = Date.now() - new Date(order.updatedAt).getTime() < 10_000;
      const creds = recent ? null : await getPaypurCredentials();
      if (creds) {
        const st = await fetchStatus(creds, order.txnId);
        if (st.ok && (!st.orderId || st.orderId === order.orderId)) {
          const paid = st.outcome === 'success' && amountsMatch(order.amount, st.amount || order.amount);
          order =
            (await updateOrder(order.orderId, {
              status: paid ? 'paid' : st.outcome === 'failed' ? 'failed' : 'pending',
              gatewayStatus: st.rawStatus,
              notes: `PayPur status check: "${st.rawStatus}"`,
            })) || order;
        }
      }
    }

    const brand = await getBrand();
    const whatsappUrl =
      order.status === 'paid'
        ? orderWhatsappLink(brand, {
            orderId: order.orderId,
            txnId: order.txnId,
            planLabel: order.planLabel,
            amount: order.amount,
            mobile: order.mobile,
            name: order.customerName,
          })
        : whatsappLink(
            brand,
            order.mobile,
            `Payment ${order.status === 'failed' ? 'failed' : 'not confirmed'} for order ${order.orderId} (${order.planLabel}, Rs ${order.amount})`
          );

    return NextResponse.json({
      success: true,
      order: {
        orderId: order.orderId,
        status: order.status,
        planLabel: order.planLabel,
        amount: order.amount,
        txnId: order.txnId,
        mobile: order.mobile,
      },
      whatsappUrl,
    });
  } catch (err) {
    const { status } = describeError(err);
    return NextResponse.json({ success: false, message: 'Could not load the order. Please try again.' }, { status });
  }
}
