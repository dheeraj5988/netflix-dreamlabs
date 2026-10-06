import { NextRequest, NextResponse } from 'next/server';
import { getPaypurSummary, savePaypurCredentials, saveSettings } from '@/lib/store';
import { adminRoute } from '@/lib/api-response';
import { normalizePlans } from '@/lib/plans';
import { normalizeWhatsapp } from '@/lib/support';

const bad = (message: string) => NextResponse.json({ ok: false, message }, { status: 400 });

/**
 * Everything that used to be an environment variable or a constant, saved from
 * Admin > Settings. One request saves one section:
 *   { paypur: { key, salt } | { clear: true } }   PayPur Gateway Key / Salt
 *   { plans: [...] }                              the plans and prices
 *   { general: { companyName, supportWhatsapp, maxUpdatesPerMonth, logRetentionDays,
 *                householdLookbackMinutes, siteUrl } }
 */
export const POST = adminRoute(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));

  // PayPur Gateway Key / Salt: never echoed back (only the key's last 4 characters are shown).
  if (body.paypur !== undefined) {
    const p = body.paypur || {};
    if (p.clear === true) {
      await savePaypurCredentials({ clear: true });
    } else {
      const key = typeof p.key === 'string' ? p.key.trim() : '';
      const salt = typeof p.salt === 'string' ? p.salt.trim() : '';
      if (!key && !salt) return bad('Enter the Gateway Key and/or Gateway Salt to save.');
      if ((key && /\s/.test(key)) || (salt && /\s/.test(salt))) {
        return bad('The key and salt must not contain spaces. Copy them again from PayPur.');
      }
      if ((key && key.length < 8) || (salt && salt.length < 8)) {
        return bad('That key or salt looks too short. Copy it again from PayPur.');
      }
      await savePaypurCredentials({ key: key || undefined, salt: salt || undefined });
    }
    return NextResponse.json({ ok: true, paypur: await getPaypurSummary() });
  }

  if (body.plans !== undefined) {
    const parsed = normalizePlans(body.plans);
    if (!parsed.ok) return bad(parsed.message);
    const settings = await saveSettings({ plans: parsed.plans });
    return NextResponse.json({ ok: true, settings });
  }

  const g = body.general ?? body;
  const patch: Parameters<typeof saveSettings>[0] = {};

  if (g.companyName !== undefined) {
    const name = String(g.companyName).replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 60) return bad('The company name must be 2 to 60 characters.');
    patch.companyName = name;
  }
  if (g.supportWhatsapp !== undefined) {
    const number = normalizeWhatsapp(g.supportWhatsapp);
    if (!number) return bad('Enter the support WhatsApp number with its country code, for example 91 99914 83279.');
    patch.supportWhatsapp = number;
  }
  if (g.maxUpdatesPerMonth !== undefined) {
    const n = parseInt(g.maxUpdatesPerMonth, 10);
    if (!Number.isInteger(n) || n < 1 || n > 31) return bad('TV logins per month must be between 1 and 31.');
    patch.maxUpdatesPerMonth = n;
  }
  if (g.logRetentionDays !== undefined) {
    const n = parseInt(g.logRetentionDays, 10);
    if (!Number.isInteger(n) || n < 31 || n > 3650) return bad('Keep the activity log for 31 to 3650 days.');
    patch.logRetentionDays = n;
  }
  if (g.householdLookbackMinutes !== undefined) {
    const n = parseInt(g.householdLookbackMinutes, 10);
    if (!Number.isInteger(n) || n < 5 || n > 120) return bad('Look back for the Netflix email 5 to 120 minutes.');
    patch.householdLookbackMinutes = n;
  }
  if (g.siteUrl !== undefined) {
    const raw = String(g.siteUrl).trim();
    if (!raw) {
      patch.siteUrl = '';
    } else {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        return bad('The site URL must look like https://your-domain.com');
      }
      const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return bad('The site URL must start with https://');
      patch.siteUrl = url.origin;
    }
  }
  if (Object.keys(patch).length === 0) return bad('Nothing to save.');

  const settings = await saveSettings(patch);
  return NextResponse.json({ ok: true, settings });
});
