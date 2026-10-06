import 'server-only';
import { BrowserCookie } from './netflix-cookies';
import { db, must, StorageError } from './db';
import { aliasKey, isValidEmail, normalizeEmail } from './emails';
import { normalizeMobileNumber } from './validity';

/**
 * Supabase-backed storage. Supabase is the only source of truth: there is no
 * cache, no /tmp file and no seed fallback. Every function throws a
 * StorageError if the database cannot be read or written.
 *
 * All tables are prefixed dl_ so this app can share a Supabase project with
 * tetra-household without touching its tables.
 */

export type AccountStatus = 'live' | 'expiring_soon' | 'expired' | 'needs_reimport' | 'unverified' | 'unknown';
export type ActivationAction = 'tv_login' | 'household_update';
export type ActivationStatus = 'success' | 'failed' | 'rate_limited' | 'blocked';

export interface NetflixAccount {
  id: string;
  profileName: string;
  accountLabel: string;
  accountEmail?: string;
  userAgent?: string;
  deviceMetadata?: Record<string, unknown>;
  cookies: BrowserCookie[];
  status: AccountStatus;
  earliestExpiryIso?: string | null;
  lastCheckedAt: string | null;
  lastRefreshedAt?: string | null;
  lastResult: string | null;
  lastDetail: string;
  consecutiveFailures?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id: string;
  mobile: string;
  /** The customer's Netflix ID: selects the Gmail inbox and the cookie account. */
  netflixEmail: string;
  expiryDate: string;
  isBlocked: boolean;
  tvQuotaResetAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActivationLogItem {
  id: string;
  subscriberId: string | null;
  mobile: string;
  netflixEmail?: string;
  action: ActivationAction;
  code?: string;
  ip: string;
  status: ActivationStatus;
  accountUsed?: string;
  notes?: string;
  timestamp: string;
}

export interface AppSettings {
  companyName: string;
  supportWhatsapp: string;
  maxUpdatesPerMonth: number;
  logRetentionDays: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalizes to a 10-digit mobile (strips +91 / 0 prefixes), or null. */
export function normalizeMobile(raw: unknown): string | null {
  return normalizeMobileNumber(raw);
}

/** Start of the current calendar month in India time, as a UTC Date. */
export function indiaMonthStart(now = new Date()): Date {
  const ist = new Date(now.getTime() + 330 * 60 * 1000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 330 * 60 * 1000);
}

/** Today's date (YYYY-MM-DD) in India time. */
export function indiaToday(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

/** "1st November 2026" style label for the first day of next month (India time). */
export function nextMonthLabel(now = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60 * 1000);
  const next = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 1));
  return `1st ${next.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`;
}

function toAccount(r: any): NetflixAccount {
  return {
    id: r.id,
    profileName: r.profile_name,
    accountLabel: r.account_label || r.profile_name,
    accountEmail: r.account_email || '',
    userAgent: r.user_agent || '',
    deviceMetadata: r.device_metadata || {},
    cookies: Array.isArray(r.cookies) ? r.cookies : [],
    status: r.status,
    earliestExpiryIso: r.earliest_expiry,
    lastCheckedAt: r.last_checked_at,
    lastRefreshedAt: r.last_refreshed_at,
    lastResult: r.last_result,
    lastDetail: r.last_detail || '',
    consecutiveFailures: r.consecutive_failures || 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toCustomer(r: any): Customer {
  return {
    id: r.id,
    mobile: r.mobile,
    netflixEmail: r.netflix_email,
    expiryDate: r.expiry_date || '',
    isBlocked: r.is_blocked,
    tvQuotaResetAt: r.tv_quota_reset_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toActivation(r: any): ActivationLogItem {
  return {
    id: String(r.id),
    subscriberId: r.subscriber_id,
    mobile: r.mobile,
    netflixEmail: r.netflix_email || undefined,
    action: r.action,
    code: r.code || undefined,
    ip: r.ip || 'unknown',
    status: r.status,
    accountUsed: r.account_id || undefined,
    notes: r.notes || undefined,
    timestamp: r.created_at,
  };
}

// ---------------------------------------------------------------------------
// Netflix accounts (dl_accounts, the cookie vault)
// ---------------------------------------------------------------------------

export async function listAccounts(): Promise<NetflixAccount[]> {
  const rows = must(
    await db().from('dl_accounts').select('*').order('created_at', { ascending: false }),
    'loading Netflix accounts'
  );
  return rows.map(toAccount);
}

export async function getAccount(id: string): Promise<NetflixAccount | null> {
  const row = must(await db().from('dl_accounts').select('*').eq('id', id).maybeSingle(), 'loading Netflix account');
  return row ? toAccount(row) : null;
}

export interface AccountInput {
  profileName: string;
  accountLabel: string;
  accountEmail: string;
  userAgent: string;
  deviceMetadata?: Record<string, unknown>;
  cookies: BrowserCookie[];
  status: AccountStatus;
  earliestExpiryIso: string | null;
}

/**
 * Creates an account, or replaces the cookies/details of an existing one.
 * A vault account is identified by its Netflix ID (email): adding cookies for
 * an email that is already in the vault re-imports them instead of creating a
 * duplicate.
 */
export async function saveAccount(input: AccountInput, id?: string): Promise<NetflixAccount> {
  if (!isValidEmail(input.accountEmail)) {
    throw new UserError('Enter the Netflix ID (email) these cookies belong to. It links the account to your customers.');
  }
  const email = normalizeEmail(input.accountEmail);

  if (!id) {
    const key = aliasKey(email);
    const existing = (await listAccounts()).find((a) => aliasKey(a.accountEmail) === key);
    if (existing) id = existing.id;
  }

  const payload: Record<string, unknown> = {
    profile_name: input.profileName,
    account_label: input.accountLabel,
    account_email: email,
    user_agent: input.userAgent,
    cookies: input.cookies,
    status: input.status,
    earliest_expiry: input.earliestExpiryIso,
    consecutive_failures: 0,
  };
  if (input.deviceMetadata) payload.device_metadata = input.deviceMetadata;

  if (id) {
    payload.last_detail = 'Cookies re-imported, ready to test';
    const row = must(
      await db().from('dl_accounts').update(payload).eq('id', id).select('*').maybeSingle(),
      'updating Netflix account'
    );
    if (!row) throw new StorageError('Netflix account not found');
    return toAccount(row);
  }

  payload.last_detail = 'Imported, ready to test and keep alive';
  const row = must(await db().from('dl_accounts').insert(payload).select('*').single(), 'saving Netflix account');
  return toAccount(row);
}

export interface AccountHealth {
  cookies: BrowserCookie[];
  status: AccountStatus;
  lastResult: string;
  lastDetail: string;
  lastCheckedAt: string;
  lastRefreshedAt: string | null;
  earliestExpiryIso: string | null;
  ok: boolean;
}

/** Persists a keepalive/test result, including any refreshed cookies from Netflix. */
export async function saveAccountHealth(account: NetflixAccount, h: AccountHealth): Promise<NetflixAccount> {
  const row = must(
    await db()
      .from('dl_accounts')
      .update({
        cookies: h.cookies,
        status: h.status,
        last_result: h.lastResult,
        last_detail: h.lastDetail,
        last_checked_at: h.lastCheckedAt,
        last_refreshed_at: h.lastRefreshedAt,
        earliest_expiry: h.earliestExpiryIso,
        consecutive_failures: h.ok ? 0 : (account.consecutiveFailures || 0) + 1,
      })
      .eq('id', account.id)
      .select('*')
      .maybeSingle(),
    'saving Netflix account status'
  );
  if (!row) throw new StorageError('Netflix account was deleted while it was being checked');
  return toAccount(row);
}

/** Deletes an account. Activity rows keep their history (ON DELETE SET NULL). */
export async function deleteAccount(id: string): Promise<void> {
  must(await db().from('dl_accounts').delete().eq('id', id), 'deleting Netflix account');
}

// ---------------------------------------------------------------------------
// Customers (dl_subscribers)
// ---------------------------------------------------------------------------

export async function listCustomers(): Promise<Customer[]> {
  const out: Customer[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const rows = must(
      await db()
        .from('dl_subscribers')
        .select('*')
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, from + page - 1),
      'loading customers'
    );
    out.push(...rows.map(toCustomer));
    if (rows.length < page) return out;
  }
}

export async function getCustomerByMobile(mobile: string): Promise<Customer | null> {
  const clean = normalizeMobile(mobile);
  if (!clean) return null;
  const row = must(
    await db().from('dl_subscribers').select('*').eq('mobile', clean).maybeSingle(),
    'looking up customer'
  );
  return row ? toCustomer(row) : null;
}

export interface CustomerInput {
  mobile: string;
  netflixEmail: string;
  expiryDate: string;
  isBlocked: boolean;
}

function customerRow(c: CustomerInput) {
  return {
    mobile: c.mobile,
    netflix_email: normalizeEmail(c.netflixEmail),
    expiry_date: c.expiryDate,
    is_blocked: c.isBlocked,
  };
}

/**
 * Saves a customer from the admin form. Adding a mobile number that already
 * exists does not fail: the existing record gets the new Netflix ID and
 * expiry (a renewal on a different account).
 */
export async function saveCustomer(
  input: CustomerInput,
  id?: string
): Promise<{ customer: Customer; created: boolean }> {
  if (!isValidEmail(input.netflixEmail)) throw new UserError('Enter a valid Netflix ID (email)');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiryDate || '')) throw new UserError('Enter a valid expiry date');

  let targetId = id;
  if (!targetId) {
    const existing = await getCustomerByMobile(input.mobile);
    targetId = existing?.id;
  }

  if (targetId) {
    const res = await db().from('dl_subscribers').update(customerRow(input)).eq('id', targetId).select('*').maybeSingle();
    if (res.error?.code === '23505') {
      throw new UserError('That mobile number already belongs to another customer. Edit that customer instead.');
    }
    const row = must(res, 'saving customer');
    if (!row) throw new UserError('Customer not found');
    return { customer: toCustomer(row), created: false };
  }

  const row = must(
    await db().from('dl_subscribers').insert(customerRow(input)).select('*').single(),
    'saving customer'
  );
  return { customer: toCustomer(row), created: true };
}

export async function setCustomerBlocked(id: string, isBlocked: boolean): Promise<void> {
  must(await db().from('dl_subscribers').update({ is_blocked: isBlocked }).eq('id', id), 'updating customer');
}

export async function deleteCustomer(id: string): Promise<void> {
  must(await db().from('dl_subscribers').delete().eq('id', id), 'deleting customer');
}

/** Lets a customer use their full monthly TV login allowance again from now. */
export async function resetTvQuota(id: string): Promise<boolean> {
  const row = must(
    await db()
      .from('dl_subscribers')
      .update({ tv_quota_reset_at: new Date().toISOString() })
      .eq('id', id)
      .select('id')
      .maybeSingle(),
    'resetting TV login counter'
  );
  return Boolean(row);
}

export interface ImportRow {
  mobile: string;
  netflixEmail: string;
  expiryDate: string;
}

export interface ImportResult {
  imported: number;
  updated: number;
  /** Existing customers whose Netflix ID changed (a renewal on a new account). */
  movedToNewAccount: number;
  invalid: string[];
}

/**
 * Imports sheet rows (Netflix ID, mobile, expiry): one record per mobile
 * number. A mobile that already exists is NOT rejected: it is updated with the
 * new Netflix ID and expiry, so a customer whose old plan expired and who took
 * a new Netflix gets moved to it. Their block flag, TV quota and history are
 * left untouched.
 */
export async function importCustomers(rows: ImportRow[]): Promise<ImportResult> {
  const byMobile = new Map<string, { mobile: string; netflix_email: string; expiry_date: string }>();
  const invalid: string[] = [];

  for (const r of rows) {
    const mobile = normalizeMobile(r.mobile);
    const email = normalizeEmail(r.netflixEmail);
    const expiry = String(r.expiryDate || '');
    if (!mobile) {
      if (String(r.mobile || '').trim()) invalid.push(String(r.mobile));
      continue;
    }
    if (!isValidEmail(email)) {
      invalid.push(`${mobile} (invalid Netflix ID)`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
      invalid.push(`${mobile} (invalid expiry date)`);
      continue;
    }
    const prev = byMobile.get(mobile);
    if (prev && prev.expiry_date > expiry) continue; // keep the later expiry
    byMobile.set(mobile, { mobile, netflix_email: email, expiry_date: expiry });
  }

  const mobiles = [...byMobile.keys()];
  const existing = new Map<string, string>();
  for (let i = 0; i < mobiles.length; i += 200) {
    const found = must(
      await db().from('dl_subscribers').select('mobile, netflix_email').in('mobile', mobiles.slice(i, i + 200)),
      'checking existing customers'
    );
    found.forEach((f: any) => existing.set(f.mobile, f.netflix_email));
  }

  const payload = [...byMobile.values()];
  for (let i = 0; i < payload.length; i += 200) {
    must(
      await db().from('dl_subscribers').upsert(payload.slice(i, i + 200), { onConflict: 'mobile' }),
      'importing customers'
    );
  }

  let moved = 0;
  for (const p of payload) {
    const before = existing.get(p.mobile);
    if (before !== undefined && aliasKey(before) !== aliasKey(p.netflix_email)) moved++;
  }

  return {
    imported: mobiles.length - existing.size,
    updated: existing.size,
    movedToNewAccount: moved,
    invalid,
  };
}

// ---------------------------------------------------------------------------
// Activations
// ---------------------------------------------------------------------------

export async function listActivations(limit = 1000): Promise<ActivationLogItem[]> {
  const rows = must(
    await db().from('dl_activations').select('*').order('created_at', { ascending: false }).limit(limit),
    'loading activity log'
  );
  return rows.map(toActivation);
}

/** Successful TV logins since the start of this India calendar month. */
export async function listTvLoginsThisMonth(): Promise<ActivationLogItem[]> {
  const rows = must(
    await db()
      .from('dl_activations')
      .select('*')
      .eq('action', 'tv_login')
      .eq('status', 'success')
      .gte('created_at', indiaMonthStart().toISOString())
      .limit(10000),
    'counting TV logins'
  );
  return rows.map(toActivation);
}

export async function logActivation(entry: {
  subscriberId: string | null;
  mobile: string;
  netflixEmail?: string | null;
  action: ActivationAction;
  status: ActivationStatus;
  ip?: string;
  code?: string;
  accountId?: string | null;
  notes?: string;
}): Promise<void> {
  must(
    await db().from('dl_activations').insert({
      subscriber_id: entry.subscriberId,
      mobile: entry.mobile,
      netflix_email: entry.netflixEmail || null,
      action: entry.action,
      status: entry.status,
      ip: entry.ip || null,
      code: entry.code || null,
      account_id: entry.accountId || null,
      notes: entry.notes || null,
    }),
    'writing activity log'
  );
}

export async function pruneActivations(retentionDays: number): Promise<void> {
  const cutoff = new Date(Date.now() - Math.max(31, retentionDays) * 24 * 60 * 60 * 1000);
  must(await db().from('dl_activations').delete().lt('created_at', cutoff.toISOString()), 'pruning old activity log');
}

// ---------------------------------------------------------------------------
// TV login (atomic, enforced in the database)
// ---------------------------------------------------------------------------

export interface TvLoginResult {
  ok: boolean;
  reason?: 'not_found' | 'blocked' | 'expired' | 'monthly_limit' | 'account_unavailable' | 'no_account';
  used: number;
  max: number;
  expiryDate?: string;
  accountId?: string;
  accountLabel?: string;
  accountEmail?: string | null;
}

/**
 * Checks eligibility, enforces the monthly limit, finds the account linked to
 * the customer's Netflix ID and logs the attempt in a single database
 * transaction (see dl_record_tv_login in the migration).
 */
export async function recordTvLogin(mobile: string, code: string, ip: string): Promise<TvLoginResult> {
  const r: any = must(
    await db().rpc('dl_record_tv_login', { p_mobile: mobile, p_code: code, p_ip: ip }),
    'recording TV login'
  );
  return {
    ok: Boolean(r?.ok),
    reason: r?.reason,
    used: Number(r?.used) || 0,
    max: Number(r?.max) || 2,
    expiryDate: r?.expiry_date,
    accountId: r?.account_id,
    accountLabel: r?.account_label,
    accountEmail: r?.account_email,
  };
}

/**
 * Finalizes the TV login that recordTvLogin just logged as a success, once
 * Netflix has answered. A failed confirmation is re-marked as failed so it
 * does not count toward the monthly limit.
 */
export async function finalizeTvLogin(
  subscriberMobile: string,
  code: string,
  ok: boolean,
  notes: string
): Promise<void> {
  const row: any = must(
    await db()
      .from('dl_activations')
      .select('id')
      .eq('mobile', subscriberMobile)
      .eq('action', 'tv_login')
      .eq('status', 'success')
      .eq('code', code)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    'finding TV login record'
  );
  if (!row) return;
  must(
    await db()
      .from('dl_activations')
      .update({ status: ok ? 'success' : 'failed', notes: notes.slice(0, 500) })
      .eq('id', row.id),
    'updating TV login record'
  );
}

/** Saves cookies Netflix refreshed during a TV sign-in, and flags a logged-out session. */
export async function updateAccountAfterTvLogin(
  accountId: string,
  cookies: BrowserCookie[],
  sessionExpired: boolean,
  detail: string
): Promise<void> {
  const patch: Record<string, unknown> = { cookies };
  if (sessionExpired) {
    patch.status = 'needs_reimport';
    patch.last_result = 'needs_reimport';
    patch.last_detail = detail;
    patch.last_checked_at = new Date().toISOString();
  }
  must(await db().from('dl_accounts').update(patch).eq('id', accountId), 'saving account cookies');
}

// ---------------------------------------------------------------------------
// Eligibility (used for household update and for showing quota)
// ---------------------------------------------------------------------------

export interface EligibilityResult {
  eligible: boolean;
  reason?: 'not_found' | 'blocked' | 'expired' | 'monthly_limit';
  message: string;
  customer?: Customer;
  currentCount: number;
  maxCount: number;
  nextAllowedDate?: string;
}

async function countTvLoginsThisMonth(c: Customer): Promise<number> {
  const monthStart = indiaMonthStart();
  const from =
    c.tvQuotaResetAt && new Date(c.tvQuotaResetAt) > monthStart ? new Date(c.tvQuotaResetAt) : monthStart;
  const res = await db()
    .from('dl_activations')
    .select('id', { count: 'exact', head: true })
    .eq('subscriber_id', c.id)
    .eq('action', 'tv_login')
    .eq('status', 'success')
    .gte('created_at', from.toISOString());
  if (res.error) throw new StorageError(`Database error while counting TV logins: ${res.error.message}`);
  return res.count || 0;
}

/**
 * TV login: max N per calendar month (India time). Household update: unlimited.
 * The authoritative TV check happens in recordTvLogin; this is for display
 * and for gating the household link.
 */
export async function checkCustomerEligibility(
  mobile: string,
  action: ActivationAction
): Promise<EligibilityResult> {
  const [customer, settings] = await Promise.all([getCustomerByMobile(mobile), getSettings()]);
  const max = settings.maxUpdatesPerMonth;

  if (!customer) {
    return {
      eligible: false,
      reason: 'not_found',
      message:
        'No active Netflix subscription found for this mobile number. Please check your number or contact support on WhatsApp.',
      currentCount: 0,
      maxCount: max,
    };
  }
  if (customer.isBlocked) {
    return {
      eligible: false,
      reason: 'blocked',
      message: 'Your access has been blocked. Please contact support on WhatsApp.',
      customer,
      currentCount: 0,
      maxCount: max,
    };
  }
  if (customer.expiryDate && customer.expiryDate < indiaToday()) {
    return {
      eligible: false,
      reason: 'expired',
      message: `Your Netflix subscription expired on ${customer.expiryDate}. Please renew to continue.`,
      customer,
      currentCount: 0,
      maxCount: max,
    };
  }
  if (action === 'household_update') {
    return { eligible: true, message: 'Eligible for household update', customer, currentCount: 0, maxCount: 0 };
  }

  const used = await countTvLoginsThisMonth(customer);
  if (used >= max) {
    const next = nextMonthLabel();
    return {
      eligible: false,
      reason: 'monthly_limit',
      message: `Monthly TV login limit reached: you have used ${used}/${max} TV logins this month. Your limit resets on ${next}.`,
      customer,
      currentCount: used,
      maxCount: max,
      nextAllowedDate: next,
    };
  }
  return { eligible: true, message: 'Eligible for TV login', customer, currentCount: used, maxCount: max };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSettings(): Promise<AppSettings> {
  const row: any = must(
    await db().from('dl_settings').select('*').eq('id', 'default').maybeSingle(),
    'loading settings'
  );
  if (!row) throw new StorageError('Settings row is missing. Run the Supabase migration.');
  return {
    companyName: row.company_name,
    supportWhatsapp: row.support_whatsapp,
    maxUpdatesPerMonth: row.max_tv_logins_per_month,
    logRetentionDays: row.log_retention_days,
  };
}

export async function saveSettings(s: Partial<AppSettings>): Promise<AppSettings> {
  const patch: Record<string, unknown> = {};
  if (s.companyName !== undefined) patch.company_name = s.companyName;
  if (s.supportWhatsapp !== undefined) patch.support_whatsapp = s.supportWhatsapp;
  if (s.maxUpdatesPerMonth !== undefined) patch.max_tv_logins_per_month = s.maxUpdatesPerMonth;
  if (s.logRetentionDays !== undefined) patch.log_retention_days = s.logRetentionDays;
  must(await db().from('dl_settings').update(patch).eq('id', 'default'), 'saving settings');
  return getSettings();
}

// ---------------------------------------------------------------------------
// Storage status (read-only)
// ---------------------------------------------------------------------------

export interface StorageStatus {
  ok: boolean;
  provider: 'supabase';
  label: string;
  isPersistent: boolean;
  details: string;
  counts?: Record<string, number>;
}

export async function getStorageStatus(): Promise<StorageStatus> {
  try {
    const tables = ['dl_subscribers', 'dl_accounts', 'dl_activations', 'dl_settings'];
    const counts: Record<string, number> = {};
    // A normal (non-HEAD) read: for a table that does not exist, a HEAD request comes back
    // as an empty 404 that supabase-js reports as "no error, no rows", which would be
    // mistaken for an empty table.
    await Promise.all(
      tables.map(async (t) => {
        const res = await db().from(t).select('id', { count: 'exact' }).limit(1);
        if (res.error) throw new StorageError(`Table "${t}": ${res.error.message || res.error.code}`);
        counts[t] = res.count ?? 0;
      })
    );
    if (!counts.dl_settings) {
      throw new StorageError('The dl_settings row is missing. Run the schema SQL (01_dreamlabs_schema.sql) again; it adds the row.');
    }
    return {
      ok: true,
      provider: 'supabase',
      label: 'Supabase (permanent)',
      isPersistent: true,
      details: 'Connected to Supabase with the service role key',
      counts,
    };
  } catch (err: any) {
    const raw: string = err?.message || 'Could not reach Supabase';
    const host = (process.env.SUPABASE_URL || '').replace(/^https?:\/\//i, '').split('/')[0];
    const hint = /could not find the table|schema cache|does not exist/i.test(raw)
      ? ` The dl_* tables are not in the Supabase project this site is connected to${host ? ` (${host})` : ''}. Run the schema SQL (01_dreamlabs_schema.sql) in the SQL Editor of that same project.`
      : /invalid path/i.test(raw)
        ? ' SUPABASE_URL looks wrong: it must be just https://<project-ref>.supabase.co.'
        : /permission denied|jwt|api key|unauthorized/i.test(raw)
          ? ' SUPABASE_SERVICE_ROLE_KEY looks wrong: use the service_role / secret key, not the publishable (anon) key.'
          : '';
    return {
      ok: false,
      provider: 'supabase',
      label: 'Storage error',
      isPersistent: false,
      details: raw + hint,
    };
  }
}

// ---------------------------------------------------------------------------
// PayPur gateway credentials (dl_settings.paypur_key / paypur_salt)
// ---------------------------------------------------------------------------

export interface PaypurCredentials {
  key: string;
  salt: string;
}

export interface PaypurSummary {
  configured: boolean;
  /** Last 4 characters of the saved key, for the admin to recognise it. The salt is never returned. */
  keyHint: string;
  saltSet: boolean;
  /** Set when the payments SQL has not been run yet. */
  error?: string;
}

/** Server-only: the saved Gateway Key and Salt, or null if either is missing. */
export async function getPaypurCredentials(): Promise<PaypurCredentials | null> {
  const row: any = must(
    await db().from('dl_settings').select('paypur_key, paypur_salt').eq('id', 'default').maybeSingle(),
    'loading payment settings'
  );
  const key = String(row?.paypur_key || '').trim();
  const salt = String(row?.paypur_salt || '').trim();
  return key && salt ? { key, salt } : null;
}

export async function getPaypurSummary(): Promise<PaypurSummary> {
  try {
    const row: any = must(
      await db().from('dl_settings').select('paypur_key, paypur_salt').eq('id', 'default').maybeSingle(),
      'loading payment settings'
    );
    const key = String(row?.paypur_key || '').trim();
    const salt = String(row?.paypur_salt || '').trim();
    return { configured: Boolean(key && salt), keyHint: key ? key.slice(-4) : '', saltSet: Boolean(salt) };
  } catch (err: any) {
    return { configured: false, keyHint: '', saltSet: false, error: err?.message || 'Could not load payment settings' };
  }
}

/** Saves the gateway keys. A field that is not given is left as it is; `clear` removes both. */
export async function savePaypurCredentials(input: { key?: string; salt?: string; clear?: boolean }): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (input.clear) {
    patch.paypur_key = null;
    patch.paypur_salt = null;
  } else {
    if (input.key !== undefined) patch.paypur_key = input.key.trim();
    if (input.salt !== undefined) patch.paypur_salt = input.salt.trim();
  }
  if (Object.keys(patch).length === 0) return;
  must(await db().from('dl_settings').update(patch).eq('id', 'default'), 'saving payment settings');
}

// ---------------------------------------------------------------------------
// Orders (dl_orders): online purchases through PayPur
// ---------------------------------------------------------------------------

export type OrderStatus = 'created' | 'pending' | 'paid' | 'failed';

export interface Order {
  orderId: string;
  mobile: string;
  customerName: string;
  customerEmail: string;
  planId: string;
  planLabel: string;
  amount: number;
  status: OrderStatus;
  txnId: string | null;
  gatewayStatus: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
}

function toOrder(r: any): Order {
  return {
    orderId: r.order_id,
    mobile: r.mobile,
    customerName: r.customer_name || '',
    customerEmail: r.customer_email || '',
    planId: r.plan_id,
    planLabel: r.plan_label,
    amount: Number(r.amount),
    status: r.status,
    txnId: r.txn_id,
    gatewayStatus: r.gateway_status,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    paidAt: r.paid_at,
  };
}

export async function createOrder(o: {
  orderId: string;
  mobile: string;
  customerName: string;
  customerEmail: string;
  planId: string;
  planLabel: string;
  amount: number;
  ip?: string;
}): Promise<Order> {
  const row = must(
    await db()
      .from('dl_orders')
      .insert({
        order_id: o.orderId,
        mobile: o.mobile,
        customer_name: o.customerName,
        customer_email: o.customerEmail,
        plan_id: o.planId,
        plan_label: o.planLabel,
        amount: o.amount,
        ip: o.ip || null,
      })
      .select('*')
      .single(),
    'creating order'
  );
  return toOrder(row);
}

export async function getOrder(orderId: string): Promise<Order | null> {
  const row = must(await db().from('dl_orders').select('*').eq('order_id', orderId).maybeSingle(), 'loading order');
  return row ? toOrder(row) : null;
}

export async function listOrders(limit = 500): Promise<Order[]> {
  const rows = must(
    await db().from('dl_orders').select('*').order('created_at', { ascending: false }).limit(limit),
    'loading orders'
  );
  return rows.map(toOrder);
}

/** Purchase attempts by this number in the last `minutes` (to stop someone spamming the gateway). */
export async function countRecentOrders(mobile: string, minutes: number): Promise<number> {
  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const res = await db()
    .from('dl_orders')
    .select('order_id', { count: 'exact' })
    .eq('mobile', mobile)
    .gte('created_at', since)
    .limit(1);
  if (res.error) throw new StorageError(`Database error while counting orders: ${res.error.message}`);
  return res.count ?? 0;
}

/**
 * Updates an order. A paid order is never changed by a later failed/pending update.
 */
export async function updateOrder(
  orderId: string,
  patch: { status?: OrderStatus; txnId?: string | null; gatewayStatus?: string | null; notes?: string | null }
): Promise<Order | null> {
  const current = await getOrder(orderId);
  if (!current) return null;
  // A paid order is final: a late "failed" / "pending" callback changes nothing, not even the notes.
  if (current.status === 'paid' && patch.status && patch.status !== 'paid') return current;

  const row: Record<string, unknown> = {};
  if (patch.status) {
    row.status = patch.status;
    if (patch.status === 'paid' && !current.paidAt) row.paid_at = new Date().toISOString();
  }
  if (patch.txnId) row.txn_id = patch.txnId;
  if (patch.gatewayStatus !== undefined) row.gateway_status = patch.gatewayStatus;
  if (patch.notes !== undefined) row.notes = patch.notes === null ? null : patch.notes.slice(0, 500);
  if (Object.keys(row).length === 0) return current;

  const updated = must(
    await db().from('dl_orders').update(row).eq('order_id', orderId).select('*').maybeSingle(),
    'updating order'
  );
  return updated ? toOrder(updated) : null;
}

/** An error caused by bad input, shown to the user as a 400. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}
