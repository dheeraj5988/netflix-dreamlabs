/**
 * Subscription plans sold on the site. They are edited in Admin > Settings and
 * stored in dl_settings.plans; DEFAULT_PLANS is what a new install starts with.
 * The price is always taken from the saved plan on the server; the browser only
 * sends the plan id.
 */
export interface Plan {
  id: string;
  label: string;
  months: number;
  /** Price in rupees. */
  price: number;
  /** Disabled plans are hidden from customers (old orders keep their details). */
  enabled: boolean;
}

export const DEFAULT_PLANS: Plan[] = [
  { id: '3m', label: '3 Months', months: 3, price: 449, enabled: true },
  { id: '6m', label: '6 Months', months: 6, price: 798, enabled: true },
  { id: '12m', label: '1 Year', months: 12, price: 1498, enabled: true },
];

/** Shown under every plan. */
export const PLAN_DESCRIPTION = '4K UHD · 1 Device';

export function findPlan(plans: Plan[], id: unknown): Plan | undefined {
  return plans.find((p) => p.id === id);
}

/** Price for people: 449 stays 449, 399.5 becomes 399.50. */
export function displayPrice(price: number | string): string {
  const n = Number(price);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Order amount the way PayPur signs it: two decimals ("449.00"). */
export function formatAmount(price: number): string {
  return price.toFixed(2);
}

/** "Netflix 4K UHD - 3 Months - 1 Device" (plain ASCII: it is sent to the gateway). */
export function planProductInfo(plan: Plan): string {
  return `Netflix 4K UHD - ${plan.label.replace(/[^\x20-\x7E]/g, '')} - 1 Device`;
}

export const MAX_PLANS = 8;

/**
 * Validates and cleans the plan list sent from the admin panel. The id comes
 * from the duration ("3m", "12m"), so it stays the same when a plan is renamed
 * or repriced, and two plans cannot have the same duration.
 */
export function normalizePlans(input: unknown): { ok: true; plans: Plan[] } | { ok: false; message: string } {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, message: 'Add at least one plan.' };
  if (input.length > MAX_PLANS) return { ok: false, message: `You can have at most ${MAX_PLANS} plans.` };

  const seen = new Set<number>();
  const plans: Plan[] = [];
  for (const raw of input) {
    const months = Math.round(Number(raw?.months));
    const price = Math.round(Number(raw?.price) * 100) / 100;
    const label = String(raw?.label ?? '').replace(/\s+/g, ' ').trim();
    if (!Number.isInteger(months) || months < 1 || months > 60) return { ok: false, message: 'Plan duration must be 1 to 60 months.' };
    if (!Number.isFinite(price) || price < 1 || price > 100000) return { ok: false, message: 'Plan price must be between ₹1 and ₹100000.' };
    if (label.length < 1 || label.length > 40) return { ok: false, message: 'Each plan needs a name (up to 40 characters).' };
    if (seen.has(months)) return { ok: false, message: `Two plans have the same duration (${months} months). Each duration can be used once.` };
    seen.add(months);
    plans.push({ id: `${months}m`, label, months, price, enabled: raw?.enabled !== false });
  }
  if (!plans.some((p) => p.enabled)) return { ok: false, message: 'At least one plan must be enabled.' };
  plans.sort((a, b) => a.months - b.months);
  return { ok: true, plans };
}

/** Reads the plans column defensively (it is missing until the settings SQL has been run). */
export function plansFromRow(value: unknown): Plan[] {
  const parsed = normalizePlans(value);
  return parsed.ok ? parsed.plans : DEFAULT_PLANS;
}
