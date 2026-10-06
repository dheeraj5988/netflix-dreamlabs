import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { encryptionEnabled } from '@/lib/secrets';

export const dynamic = 'force-dynamic';

// Columns the app writes to each table. Used only to report what is missing.
const EXPECTED_COLUMNS: Record<string, string[]> = {
  dl_accounts: [
    'id', 'profile_name', 'account_label', 'account_email', 'user_agent', 'device_metadata', 'cookies',
    'status', 'earliest_expiry', 'last_checked_at', 'last_refreshed_at', 'last_result', 'last_detail',
    'consecutive_failures', 'created_at', 'updated_at',
  ],
  dl_subscribers: [
    'id', 'mobile', 'netflix_email', 'expiry_date', 'is_blocked', 'tv_quota_reset_at', 'created_at', 'updated_at',
  ],
  dl_activations: [
    'id', 'subscriber_id', 'mobile', 'netflix_email', 'action', 'code', 'ip', 'status', 'account_id', 'notes', 'created_at',
  ],
  dl_settings: ['id', 'company_name', 'support_whatsapp', 'max_tv_logins_per_month', 'log_retention_days', 'updated_at'],
};

type TableReport = {
  exists: boolean;
  rows?: number | null;
  missingColumns?: string[];
  anonCanRead?: boolean;
  error?: string;
};

/**
 * Public health check. Reports storage configuration and table shape only,
 * never row contents.
 */
export async function GET() {
  const url = (process.env.SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const publishableKey = (process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();

  const env = {
    SUPABASE_URL: Boolean(url),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(serviceKey),
    SUPABASE_PUBLISHABLE_KEY: Boolean(publishableKey),
    ADMIN_PASSWORD: Boolean(process.env.ADMIN_PASSWORD),
    ADMIN_SESSION_SECRET: Boolean(process.env.ADMIN_SESSION_SECRET),
    CRON_SECRET: Boolean(process.env.CRON_SECRET),
    SETTINGS_ENCRYPTION_KEY: encryptionEnabled(),
    // Inboxes still read from the old GMAIL_USER_n variables (they are managed in the admin panel now).
    GMAIL_ENV_INBOXES: Array.from({ length: 31 }, (_, i) => (i === 0 ? '' : `_${i}`)).filter(
      (s) => process.env[`GMAIL_USER${s}`] && process.env[`GMAIL_APP_PASSWORD${s}`]
    ).length,
  };

  if (!url || !serviceKey) {
    return NextResponse.json(
      {
        status: 'error',
        storage: 'error',
        message: !url ? 'SUPABASE_URL is not set' : 'SUPABASE_SERVICE_ROLE_KEY is not set',
        env,
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }

  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, serviceKey, opts);
  const anon = publishableKey ? createClient(url, publishableKey, opts) : null;

  const tables: Record<string, TableReport> = {};
  await Promise.all(
    Object.entries(EXPECTED_COLUMNS).map(async ([table, columns]) => {
      const { count, error } = await admin.from(table).select('*', { count: 'exact', head: true });
      // count is null (with no error) when the table does not exist: HEAD requests get an empty 404.
      if (error || count === null) {
        tables[table] = {
          exists: false,
          error: error?.message || error?.code || 'Table not found in this Supabase project: run the schema SQL',
        };
        return;
      }

      const missing: string[] = [];
      await Promise.all(
        columns.map(async (col) => {
          const { error: colErr } = await admin.from(table).select(col).limit(0);
          if (colErr) missing.push(col);
        })
      );

      let anonCanRead: boolean | undefined;
      if (anon) {
        const { data, error: anonErr } = await anon.from(table).select('id').limit(1);
        anonCanRead = !anonErr && Array.isArray(data) && data.length > 0;
      }

      tables[table] = {
        exists: true,
        rows: count,
        missingColumns: missing.sort(),
        anonCanRead,
      };
    })
  );

  // Online purchase is optional: reported, but it does not decide whether the app is healthy.
  const ordersProbe = await admin.from('dl_orders').select('order_id', { count: 'exact' }).limit(1);
  const keysProbe = await admin.from('dl_settings').select('paypur_key, paypur_salt').eq('id', 'default').maybeSingle();
  const payments = {
    ordersTable: !ordersProbe.error,
    gatewayConfigured: !keysProbe.error && Boolean((keysProbe.data as any)?.paypur_key && (keysProbe.data as any)?.paypur_salt),
  };

  // Settings managed in the admin panel (needs the panel-settings SQL).
  const mailboxProbe = await admin.from('dl_mailboxes').select('id', { count: 'exact' }).limit(1);
  const settingsProbe = await admin
    .from('dl_settings')
    .select('site_url, household_lookback_minutes, plans')
    .eq('id', 'default')
    .maybeSingle();
  const panel = {
    mailboxesTable: !mailboxProbe.error,
    savedInboxes: mailboxProbe.error ? 0 : mailboxProbe.count ?? 0,
    settingsColumns: !settingsProbe.error,
  };

  const { data: rpcProbe, error: rpcErr } = await admin.rpc('dl_record_tv_login', {
    p_mobile: '0000000000',
    p_code: 'HEALTH',
    p_ip: 'health-check',
  });
  const tvLoginFunction = !rpcErr && (rpcProbe as any)?.reason === 'not_found';

  const ok =
    tvLoginFunction &&
    Object.values(tables).every((t) => t.exists && !t.missingColumns?.length && !t.anonCanRead) &&
    (tables.dl_settings?.rows ?? 0) > 0;
  return NextResponse.json(
    {
      status: ok ? 'ok' : 'error',
      storage: ok ? 'Supabase (permanent)' : 'error',
      env,
      tables,
      payments,
      panel,
      tvLoginFunction: tvLoginFunction ? 'ok' : rpcErr?.message || 'missing',
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 }
  );
}
