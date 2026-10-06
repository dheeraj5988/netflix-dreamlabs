import { NextResponse } from 'next/server';
import { adminRoute } from '@/lib/api-response';
import { keepaliveAllAccounts } from '@/lib/keepalive-all';

export const maxDuration = 60;

export const POST = adminRoute(async () => {
  return NextResponse.json({ ok: true, ...(await keepaliveAllAccounts()) });
});
