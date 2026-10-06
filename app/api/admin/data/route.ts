import { NextRequest, NextResponse } from 'next/server';
import {
  getStorageStatus,
  listAccounts,
  listActivations,
  listCustomers,
  listTvLoginsThisMonth,
  getSettings,
  getPaypurSummary,
  listOrders,
  importCustomers,
  indiaToday,
  indiaMonthStart,
} from '@/lib/store';
import { adminRoute } from '@/lib/api-response';
import { aliasKey, mailboxKey } from '@/lib/emails';
import { hasMailbox } from '@/lib/gmailService';

export const GET = adminRoute(async () => {
  const storage = await getStorageStatus();
  if (!storage.ok) {
    return NextResponse.json({ ok: false, storageError: true, message: storage.details, storage }, { status: 503 });
  }

  const [customers, accounts, settings, activations, monthLogins] = await Promise.all([
    listCustomers(),
    listAccounts(),
    getSettings(),
    listActivations(2000),
    listTvLoginsThisMonth(),
  ]);

  // Orders and PayPur keys live in the payments SQL; an install that has not run it yet still works.
  let orders: Awaited<ReturnType<typeof listOrders>> = [];
  let ordersError: string | null = null;
  try {
    orders = await listOrders(500);
  } catch (err: any) {
    ordersError = err?.message || 'Could not load orders';
  }
  const paypur = await getPaypurSummary();

  const historyBySubscriber = new Map<string, typeof activations>();
  for (const a of activations) {
    if (!a.subscriberId) continue;
    const list = historyBySubscriber.get(a.subscriberId) || [];
    list.push(a);
    historyBySubscriber.set(a.subscriberId, list);
  }

  // A customer's cookie account is the vault entry with the same Netflix ID.
  const accountByKey = new Map<string, (typeof accounts)[number]>();
  for (const a of accounts) {
    const key = aliasKey(a.accountEmail);
    const prev = accountByKey.get(key);
    const rank = (s: string) => (s === 'live' || s === 'expiring_soon' ? 0 : s === 'unverified' || s === 'unknown' ? 1 : 2);
    if (key && (!prev || rank(a.status) < rank(prev.status))) accountByKey.set(key, a);
  }

  const monthStart = indiaMonthStart();
  const customersOut = customers.map((c) => {
    const countFrom = c.tvQuotaResetAt && new Date(c.tvQuotaResetAt) > monthStart ? c.tvQuotaResetAt : monthStart.toISOString();
    const history = historyBySubscriber.get(c.id) || [];
    const linked = accountByKey.get(aliasKey(c.netflixEmail));
    return {
      ...c,
      linkedAccountId: linked?.id || null,
      linkedAccountStatus: linked?.status || null,
      tvLoginsThisMonth: monthLogins.filter((l) => l.subscriberId === c.id && l.timestamp >= countFrom).length,
      totalUpdates: history.filter((h) => h.status === 'success').length,
      lastUpdateAt: history.find((h) => h.status === 'success')?.timestamp || null,
      history: history.map((h) => ({
        id: h.id,
        date: h.timestamp,
        action: h.action,
        status: h.status,
        code: h.code,
        notes: h.notes,
      })),
    };
  });

  const today = indiaToday();

  // One row per Netflix ID: who uses it, whether its cookies and its Gmail inbox are set up.
  const ids = new Map<string, { email: string; customers: number; activeCustomers: number }>();
  for (const c of customers) {
    const key = aliasKey(c.netflixEmail);
    const row = ids.get(key) || { email: c.netflixEmail, customers: 0, activeCustomers: 0 };
    row.customers++;
    if ((!c.expiryDate || c.expiryDate >= today) && !c.isBlocked) row.activeCustomers++;
    ids.set(key, row);
  }
  for (const a of accounts) {
    const key = aliasKey(a.accountEmail);
    if (key && !ids.has(key)) ids.set(key, { email: a.accountEmail || key, customers: 0, activeCustomers: 0 });
  }
  const netflixIds = [...ids.entries()]
    .map(([key, row]) => ({
      ...row,
      inbox: mailboxKey(row.email),
      gmailConfigured: hasMailbox(row.email),
      vaultAccountId: accountByKey.get(key)?.id || null,
      vaultStatus: accountByKey.get(key)?.status || null,
    }))
    .sort((a, b) => a.email.localeCompare(b.email));

  const startOfDay = new Date(new Date(`${today}T00:00:00+05:30`).getTime()).toISOString();
  const metrics = {
    totalSubscribers: customers.length,
    activeSubscribers: customers.filter((c) => (!c.expiryDate || c.expiryDate >= today) && !c.isBlocked).length,
    expiredSubscribers: customers.filter((c) => c.expiryDate && c.expiryDate < today).length,
    blockedSubscribers: customers.filter((c) => c.isBlocked).length,
    activationsToday: activations.filter((a) => a.status === 'success' && a.timestamp >= startOfDay).length,
    activationsMonth: activations.filter((a) => a.status === 'success' && a.timestamp >= monthStart.toISOString()).length,
    totalCookieAccounts: accounts.length,
    activeCookies: accounts.filter((a) => a.status === 'live' || a.status === 'expiring_soon').length,
    netflixIds: netflixIds.length,
    idsMissingGmail: netflixIds.filter((i) => i.customers > 0 && !i.gmailConfigured).length,
  };

  return NextResponse.json({
    ok: true,
    storage,
    data: {
      customers: customersOut,
      netflixCookies: accounts,
      netflixIds,
      settings,
      activationsLog: activations,
      metrics,
      orders,
      ordersError,
      paypur,
    },
  });
});

/**
 * Restore from a backup file. Customers are merged by mobile number
 * (no duplicates); nothing is deleted.
 */
export const POST = adminRoute(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  const rows = body?.restoreData?.customers;
  if (!Array.isArray(rows)) {
    return NextResponse.json({ ok: false, message: 'Invalid backup format' }, { status: 400 });
  }
  const result = await importCustomers(rows);
  return NextResponse.json({
    ok: true,
    message: `Restored customers: ${result.imported} added, ${result.updated} updated.${
      result.invalid.length ? ` ${result.invalid.length} row(s) skipped.` : ''
    }`,
  });
});
