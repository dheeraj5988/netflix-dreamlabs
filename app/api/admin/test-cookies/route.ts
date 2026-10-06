import { NextRequest, NextResponse } from 'next/server';
import { getAccount } from '@/lib/store';
import { adminRoute } from '@/lib/api-response';
import { checkAndSaveAccount } from '@/lib/netflix-keepalive';

export const maxDuration = 60;

export const POST = adminRoute(async (request: NextRequest) => {
  const { accountId } = await request.json().catch(() => ({}));
  if (!accountId) return NextResponse.json({ ok: false, message: 'Missing account ID' }, { status: 400 });

  const account = await getAccount(accountId);
  if (!account) return NextResponse.json({ ok: false, message: 'Account not found' }, { status: 404 });

  const { report, account: saved } = await checkAndSaveAccount(account);
  return NextResponse.json({ ok: true, report, account: saved });
});
