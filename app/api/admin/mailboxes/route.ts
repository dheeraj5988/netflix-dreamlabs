import { NextRequest, NextResponse } from 'next/server';
import { adminRoute } from '@/lib/api-response';
import { deleteMailbox, getMailboxSecrets, listMailboxes, recordMailboxTest, saveMailbox } from '@/lib/store';
import { envMailboxes, testMailboxCredentials } from '@/lib/gmailService';
import { mailboxKey } from '@/lib/emails';

export const maxDuration = 60;

/**
 * Gmail inboxes saved from Admin > Settings > Gmail Inboxes.
 *   POST { gmailUser, appPassword, label?, id? }   add / update an inbox, then test the login
 *   POST { action: 'test', id }                     test a saved inbox
 *   POST { action: 'test_env', gmailUser }          test an inbox that is still in the environment
 *   POST { action: 'import_env' }                   copy the GMAIL_USER_n inboxes from the environment
 *   DELETE ?id=
 * The app password is write-only: it is never sent back to the browser.
 */
export const POST = adminRoute(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));

  if (body.action === 'test') {
    const secret = (await getMailboxSecrets()).find((m) => m.id === body.id);
    if (!secret) {
      return NextResponse.json({ ok: false, message: 'Inbox not found, or its password can no longer be read: enter it again.' }, { status: 404 });
    }
    const result = await testMailboxCredentials(secret);
    await recordMailboxTest(secret.id, result.ok, result.message);
    return NextResponse.json({ ok: true, test: result });
  }

  if (body.action === 'test_env') {
    const env = envMailboxes().find((m) => mailboxKey(m.user) === mailboxKey(String(body.gmailUser || '')));
    if (!env) return NextResponse.json({ ok: false, message: 'That inbox is not in the environment.' }, { status: 404 });
    return NextResponse.json({ ok: true, test: await testMailboxCredentials(env) });
  }

  if (body.action === 'import_env') {
    const have = new Set((await listMailboxes()).map((m) => mailboxKey(m.gmailUser)));
    let imported = 0;
    for (const env of envMailboxes()) {
      if (have.has(mailboxKey(env.user))) continue;
      const saved = await saveMailbox({ gmailUser: env.user, appPassword: env.password, label: 'Imported from Vercel' });
      const secret = (await getMailboxSecrets()).find((m) => m.id === saved.id);
      if (secret) {
        const result = await testMailboxCredentials(secret);
        await recordMailboxTest(saved.id, result.ok, result.message);
      }
      imported++;
    }
    return NextResponse.json({
      ok: true,
      imported,
      message: imported
        ? `Copied ${imported} inbox(es) from Vercel. You can now delete the GMAIL_USER_n / GMAIL_APP_PASSWORD_n variables there.`
        : 'Nothing to copy: every inbox from Vercel is already saved here.',
    });
  }

  const saved = await saveMailbox({
    id: body.id || undefined,
    gmailUser: String(body.gmailUser || ''),
    appPassword: typeof body.appPassword === 'string' ? body.appPassword : undefined,
    label: typeof body.label === 'string' ? body.label : undefined,
  });

  // Log in straight away, so a wrong password is seen now and not by a customer later.
  let test: { ok: boolean; message: string } | null = null;
  if (body.appPassword) {
    const secret = (await getMailboxSecrets()).find((m) => m.id === saved.id);
    if (secret) {
      test = await testMailboxCredentials(secret);
      await recordMailboxTest(saved.id, test.ok, test.message);
    }
  }
  const mailbox = (await listMailboxes()).find((m) => m.id === saved.id) ?? saved;
  return NextResponse.json({
    ok: true,
    mailbox,
    test,
    message: test ? (test.ok ? 'Saved and connected to Gmail.' : `Saved, but Gmail did not accept the login: ${test.message}`) : 'Saved.',
  });
});

export const DELETE = adminRoute(async (request: NextRequest) => {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, message: 'Missing inbox id' }, { status: 400 });
  await deleteMailbox(id);
  return NextResponse.json({ ok: true });
});
