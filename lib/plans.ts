/**
 * Subscription plans sold on the site. The price is always taken from here on
 * the server; the browser only sends the plan id.
 */
export interface Plan {
  id: string;
  label: string;
  months: number;
  /** Price in rupees. */
  price: number;
}

export const PLANS: Plan[] = [
  { id: '3m', label: '3 Months', months: 3, price: 449 },
  { id: '6m', label: '6 Months', months: 6, price: 798 },
  { id: '12m', label: '1 Year', months: 12, price: 1498 },
];

/** Shown under every plan. */
export const PLAN_DESCRIPTION = '4K UHD · 1 Device';

export function getPlan(id: unknown): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

/** Order amount the way PayPur signs it: two decimals ("449.00"). */
export function formatAmount(price: number): string {
  return price.toFixed(2);
}

/** "Netflix 4K UHD - 3 Months - 1 Device" (plain ASCII: it is sent to the gateway). */
export function planProductInfo(plan: Plan): string {
  return `Netflix 4K UHD - ${plan.label} - 1 Device`;
}
