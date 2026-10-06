import 'server-only';
import { getSettingsCached } from './store';
import type { Brand } from './support';
import type { Plan } from './plans';

/** Company name and support WhatsApp from the admin settings. Never throws (falls back to the defaults). */
export async function getBrand(): Promise<Brand> {
  const s = await getSettingsCached();
  return { companyName: s.companyName, supportWhatsapp: s.supportWhatsapp };
}

/** What the public pages need from the settings. */
export async function getPublicConfig(): Promise<{ brand: Brand; plans: Plan[] }> {
  const s = await getSettingsCached();
  return {
    brand: { companyName: s.companyName, supportWhatsapp: s.supportWhatsapp },
    plans: s.plans.filter((p) => p.enabled),
  };
}
