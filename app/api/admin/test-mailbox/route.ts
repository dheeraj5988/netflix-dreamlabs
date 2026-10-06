import { NextRequest, NextResponse } from 'next/server';
import { adminRoute } from '@/lib/api-response';
import { isValidEmail } from '@/lib/emails';
import { testMailbox } from '@/lib/gmailService';

export const maxDuration = 60;

/** Checks that the Gmail login for a Netflix ID is configured and accepted by Gmail. */
export const POST = adminRoute(async (request: NextRequest) => {
  const { email } = await request.json().catch(() => ({}));
  if (!isValidEmail(email)) return NextResponse.json({ ok: false, message: 'Missing Netflix ID' }, { status: 400 });
  const result = await testMailbox(email);
  return NextResponse.json({ ok: true, mailbox: result });
});
