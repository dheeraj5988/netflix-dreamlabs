import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { StorageError } from './db';
import { UserError } from './store';
import { verifyAdminRequest } from './admin-auth';

export { SUPPORT_WHATSAPP, whatsappLink } from './support';

export function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown'
  );
}

/** Maps an exception to a status code and a message that is safe to show. */
export function describeError(err: unknown): { status: number; message: string } {
  if (err instanceof StorageError) {
    console.error('[storage]', err.message);
    return { status: 503, message: `Storage unavailable: ${err.message}` };
  }
  if (err instanceof UserError) return { status: 400, message: err.message };
  console.error(err);
  return { status: 500, message: (err as Error)?.message || 'Unexpected server error' };
}

/** Error response for admin routes. */
export function adminError(err: unknown) {
  const { status, message } = describeError(err);
  return NextResponse.json({ ok: false, message, storageError: status === 503 }, { status });
}

export function unauthorized() {
  return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
}

/** Wraps an admin route handler with auth and error handling. */
export function adminRoute(handler: (request: NextRequest) => Promise<Response>) {
  return async (request: NextRequest) => {
    if (!verifyAdminRequest(request)) return unauthorized();
    try {
      return await handler(request);
    } catch (err) {
      return adminError(err);
    }
  };
}
