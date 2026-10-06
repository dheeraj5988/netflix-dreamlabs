/** Branding and support contact, shared by the public page and the API routes. */
export const COMPANY_NAME = 'Dream Labs Solutions';

/** WhatsApp number (country code + number, no +) that every error screen sends customers to. */
export const SUPPORT_WHATSAPP = '919991483279';

export function whatsappLink(mobile: string, issue: string): string {
  const text = `Hi ${COMPANY_NAME}, I need help with Netflix for mobile number: ${mobile || 'N/A'}.\nIssue: ${issue}`;
  return `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(text)}`;
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
export function orderWhatsappLink(o: OrderDetails): string {
  const lines = [
    `Hi ${COMPANY_NAME}, I have paid for a Netflix subscription. Please activate it.`,
    '',
    `Order ID: ${o.orderId}`,
    ...(o.txnId ? [`Transaction ID: ${o.txnId}`] : []),
    `Plan: ${o.planLabel} (4K UHD, 1 Device)`,
    `Amount: Rs ${o.amount}`,
    `Mobile: ${o.mobile}`,
    ...(o.name ? [`Name: ${o.name}`] : []),
  ];
  return `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(lines.join('\n'))}`;
}
