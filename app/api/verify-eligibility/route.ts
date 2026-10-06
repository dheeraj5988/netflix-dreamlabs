import { NextRequest, NextResponse } from 'next/server';
import { checkCustomerEligibility, normalizeMobile } from '@/lib/store';
import { describeError, whatsappLink } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const raw = String(body?.mobile || '').replace(/\D/g, '');
  const action = body?.action === 'household_update' ? 'household_update' : 'tv_login';
  const mobile = normalizeMobile(raw);

  if (!mobile) {
    const message = 'Please enter a valid 10-digit mobile number';
    return NextResponse.json({ eligible: false, message, whatsappUrl: whatsappLink(raw, message) }, { status: 400 });
  }

  try {
    const r = await checkCustomerEligibility(mobile, action);
    return NextResponse.json({
      eligible: r.eligible,
      reason: r.reason,
      message: r.message,
      currentCount: r.currentCount,
      maxCount: r.maxCount,
      nextAllowedDate: r.nextAllowedDate,
      whatsappUrl: r.eligible ? undefined : whatsappLink(mobile, r.message),
      // The customer's Netflix ID is never sent to the public page.
      customer: r.customer ? { mobile: r.customer.mobile, expiryDate: r.customer.expiryDate } : undefined,
    });
  } catch (err) {
    const { status, message } = describeError(err);
    const shown = status === 503 ? 'Service temporarily unavailable. Please contact support on WhatsApp.' : message;
    return NextResponse.json({ eligible: false, message: shown, whatsappUrl: whatsappLink(mobile, shown) }, { status });
  }
}
