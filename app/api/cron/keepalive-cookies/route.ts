import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { describeError } from '@/lib/api-response';
import { keepaliveAllAccounts } from '@/lib/keepalive-all';
import { getSettings, pruneActivations } from '@/lib/store';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Keeps Netflix sessions alive. Called by the GitHub Actions schedule every
 * 6 hours and by the daily Vercel cron, both with `Authorization: Bearer
 * $CRON_SECRET`. An admin token also works (manual run).
 */
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') || '';
  const authorized = (secret && auth === `Bearer ${secret}`) || verifyAdminRequest(request);
  if (!authorized) {
    return NextResponse.json({ ok: false, message: 'Unauthorized cron request' }, { status: 401 });
  }

  try {
    const summary = await keepaliveAllAccounts();
    const settings = await getSettings();
    await pruneActivations(settings.logRetentionDays);
    return NextResponse.json({ ok: true, timestamp: new Date().toISOString(), ...summary });
  } catch (err) {
    const { status, message } = describeError(err);
    return NextResponse.json({ ok: false, message }, { status });
  }
}

export const GET = handle;
export const POST = handle;
