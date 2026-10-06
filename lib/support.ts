/**
 * Branding and the support contact. The values are edited in Admin > Settings;
 * DEFAULT_BRAND is what the site uses until they are saved.
 */
export interface Brand {
  companyName: string;
  /** WhatsApp number with country code and no +, e.g. 919991483279. */
  supportWhatsapp: string;
}

export const DEFAULT_BRAND: Brand = {
  companyName: 'Dream Labs Solutions',
  supportWhatsapp: '919991483279',
};

/** Digits only, 91 added to a 10-digit Indian number; null if it cannot be a phone number. */
export function normalizeWhatsapp(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(d)) return `91${d}`;
  if (/^\d{11,15}$/.test(d)) return d;
  return null;
}

/** "+91 99914 83279" style label for showing the number. */
export function formatWhatsapp(number: string): string {
  if (/^91\d{10}$/.test(number)) return `+91 ${number.slice(2, 7)} ${number.slice(7)}`;
  return `+${number}`;
}

export function whatsappLink(brand: Brand, mobile: string, issue: string): string {
  const text = `Hi ${brand.companyName}, I need help with Netflix for mobile number: ${mobile || 'N/A'}.\nIssue: ${issue}`;
  return `https://wa.me/${brand.supportWhatsapp}?text=${encodeURIComponent(text)}`;
}

export interface OrderDetails {
  orderId: string;
  txnId?: string | null;
  planLabel: string;
  amount: number | string;
  mobile: string;
  name?: string;
}

/** WhatsApp message a customer sends after paying, so the team can activate the plan. */
export function orderWhatsappLink(brand: Brand, o: OrderDetails): string {
  const lines = [
    `Hi ${brand.companyName}, I have paid for a Netflix subscription. Please activate it.`,
    '',
    `Order ID: ${o.orderId}`,
    ...(o.txnId ? [`Transaction ID: ${o.txnId}`] : []),
    `Plan: ${o.planLabel} (4K UHD, 1 Device)`,
    `Amount: Rs ${Number.isInteger(Number(o.amount)) ? Number(o.amount) : Number(o.amount).toFixed(2)}`,
    `Mobile: ${o.mobile}`,
    ...(o.name ? [`Name: ${o.name}`] : []),
  ];
  return `https://wa.me/${brand.supportWhatsapp}?text=${encodeURIComponent(lines.join('\n'))}`;
}
