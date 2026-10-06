import 'server-only';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Raised whenever the database is missing, unreachable or rejects a query.
 * API routes turn it into a 503 with a clear message instead of pretending
 * the data was saved.
 */
export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

let client: SupabaseClient | null = null;

/**
 * Server-side Supabase client using the service role key. There is no
 * fallback to the publishable key or to local files: if the service role key
 * is missing, every data access fails with a StorageError.
 */
export function db(): SupabaseClient {
  if (client) return client;

  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url) throw new StorageError('Database is not configured: SUPABASE_URL is missing.');
  if (!key) throw new StorageError('Database is not configured: SUPABASE_SERVICE_ROLE_KEY is missing.');

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
  return client;
}

/** Unwraps a Supabase result, throwing a StorageError on any error. */
export function must<T>(
  result: { data: T | null; error: { message: string } | null },
  action: string
): T {
  if (result.error) {
    throw new StorageError(`Database error while ${action}: ${result.error.message}`);
  }
  return result.data as T;
}
