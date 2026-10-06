import { NextRequest, NextResponse } from 'next/server';
import { resetTvQuota } from '@/lib/store';
import { adminRoute } from '@/lib/api-response';

export const POST = adminRoute(async (request: NextRequest) => {
  const { customerId } = await request.json().catch(() => ({}));
  if (!customerId) return NextResponse.json({ ok: false, message: 'Missing customer ID' }, { status: 400 });
  if (!(await resetTvQuota(customerId))) {
    return NextResponse.json({ ok: false, message: 'Customer not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, message: 'TV login counter reset. The customer has a full allowance again.' });
});
