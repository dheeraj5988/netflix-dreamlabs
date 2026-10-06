import { NextRequest, NextResponse } from 'next/server';
import { saveSettings } from '@/lib/store';
import { adminRoute } from '@/lib/api-response';

export const POST = adminRoute(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  const patch: Parameters<typeof saveSettings>[0] = {};
  if (typeof body.companyName === 'string' && body.companyName.trim()) patch.companyName = body.companyName.trim();
  if (body.maxUpdatesPerMonth !== undefined) {
    patch.maxUpdatesPerMonth = Math.max(1, parseInt(body.maxUpdatesPerMonth, 10) || 2);
  }
  const settings = await saveSettings(patch);
  return NextResponse.json({ ok: true, settings });
});
