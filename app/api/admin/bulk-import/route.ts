import { NextRequest, NextResponse } from 'next/server';
import { importCustomers } from '@/lib/store';
import { adminRoute } from '@/lib/api-response';

export const POST = adminRoute(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body?.rows) || body.rows.length === 0) {
    return NextResponse.json({ ok: false, message: 'No rows provided' }, { status: 400 });
  }

  const { imported, updated, movedToNewAccount, invalid } = await importCustomers(body.rows);
  const moved = movedToNewAccount ? ` ${movedToNewAccount} of them moved to a new Netflix ID.` : '';
  const skipped = invalid.length ? ` Skipped ${invalid.length} invalid row(s): ${invalid.slice(0, 10).join(', ')}.` : '';
  return NextResponse.json({
    ok: true,
    message: `Added ${imported} new customers and updated ${updated} existing ones.${moved}${skipped}`,
    importedCount: imported,
    updatedCount: updated,
    movedCount: movedToNewAccount,
    invalid,
  });
});
