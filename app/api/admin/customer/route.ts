import { NextRequest, NextResponse } from 'next/server';
import { deleteCustomer, saveCustomer, setCustomerBlocked } from '@/lib/store';
import { adminRoute } from '@/lib/api-response';
import { isValidEmail } from '@/lib/emails';

export const POST = adminRoute(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  const { id, mobile, netflixEmail, expiryDate, isBlocked } = body;

  // Block/unblock toggle sends only id + isBlocked
  if (id && mobile === undefined && typeof isBlocked === 'boolean') {
    await setCustomerBlocked(id, isBlocked);
    return NextResponse.json({ ok: true });
  }

  const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);
  if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
    return NextResponse.json({ ok: false, message: 'Please enter a valid 10-digit mobile number' }, { status: 400 });
  }
  if (!isValidEmail(netflixEmail)) {
    return NextResponse.json({ ok: false, message: 'Please enter the Netflix ID (email)' }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(expiryDate || ''))) {
    return NextResponse.json({ ok: false, message: 'Please enter the expiry date' }, { status: 400 });
  }

  const { customer, created } = await saveCustomer(
    { mobile: cleanMobile, netflixEmail, expiryDate, isBlocked: Boolean(isBlocked) },
    id || undefined
  );
  return NextResponse.json({
    ok: true,
    customer,
    created,
    message: created
      ? 'Customer added'
      : id
        ? 'Customer updated'
        : 'This mobile number already existed: its Netflix ID and expiry were updated.',
  });
});

export const DELETE = adminRoute(async (request: NextRequest) => {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, message: 'Missing customer ID' }, { status: 400 });
  await deleteCustomer(id);
  return NextResponse.json({ ok: true });
});
