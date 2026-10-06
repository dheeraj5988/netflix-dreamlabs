import 'server-only';
import { listAccounts } from './store';
import { checkAndSaveAccount } from './netflix-keepalive';

/** Checks every account in parallel and saves each result (and refreshed cookies). */
export async function keepaliveAllAccounts() {
  const accounts = await listAccounts();
  const results = await Promise.all(
    accounts.map(async (account) => {
      const name = account.accountLabel || account.profileName;
      try {
        const { report } = await checkAndSaveAccount(account);
        return { id: account.id, name, ok: report.ok, status: report.status, renewedCount: report.renewedCount, message: report.message };
      } catch (err: any) {
        return { id: account.id, name, ok: false, status: 'error', renewedCount: 0, message: err?.message || 'Check failed' };
      }
    })
  );
  return {
    total: accounts.length,
    working: results.filter((r) => r.ok).length,
    renewedTokens: results.reduce((n, r) => n + r.renewedCount, 0),
    results,
  };
}
