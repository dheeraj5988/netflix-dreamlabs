import { NextRequest, NextResponse } from 'next/server';
import { getPaypurSummary, savePaypurCredentials, saveSettings } from '@/lib/store';
import { adminRoute } from '@/lib/api-response';

export const POST = adminRoute(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));

  // PayPur Gateway Key / Salt: saved on their own, never echoed back (only the key's last 4 characters are shown).
  if (body.paypur !== undefined) {
    const p = body.paypur || {};
    if (p.clear === true) {
      await savePaypurCredentials({ clear: true });
    } else {
      const key = typeof p.key === 'string' ? p.key.trim() : '';
      const salt = typeof p.salt === 'string' ? p.salt.trim() : '';
      if (!key && !salt) {
        return NextResponse.json({ ok: false, message: 'Enter the Gateway Key and/or Gateway Salt to save.' }, { status: 400 });
      }
      if ((key && /\s/.test(key)) || (salt && /\s/.test(salt))) {
        return NextResponse.json({ ok: false, message: 'The key and salt must not contain spaces. Copy them again from PayPur.' }, { status: 400 });
      }
      if ((key && key.length < 8) || (salt && salt.length < 8)) {
        return NextResponse.json({ ok: false, message: 'That key or salt looks too short. Copy it again from PayPur.' }, { status: 400 });
      }
      await savePaypurCredentials({ key: key || undefined, salt: salt || undefined });
    }
    return NextResponse.json({ ok: true, paypur: await getPaypurSummary() });
  }

  const patch: Parameters<typeof saveSettings>[0] = {};
  if (typeof body.companyName === 'string' && body.companyName.trim()) patch.companyName = body.companyName.trim();
  if (body.maxUpdatesPerMonth !== undefined) {
    patch.maxUpdatesPerMonth = Math.max(1, parseInt(body.maxUpdatesPerMonth, 10) || 2);
  }
  const settings = await saveSettings(patch);
  return NextResponse.json({ ok: true, settings });
});
