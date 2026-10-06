import { NextRequest, NextResponse } from 'next/server';
import { checkAdminPassword, isAdminPasswordConfigured, issueAdminToken } from '@/lib/admin-auth';

export async function POST(request: NextRequest) {
  if (!isAdminPasswordConfigured()) {
    return NextResponse.json(
      { ok: false, message: 'Admin login is disabled: set ADMIN_PASSWORD in the Vercel environment variables.' },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => ({}));
  if (!checkAdminPassword(body?.password)) {
    return NextResponse.json({ ok: false, message: 'Invalid admin password' }, { status: 401 });
  }
  return NextResponse.json({ ok: true, token: issueAdminToken() });
}
