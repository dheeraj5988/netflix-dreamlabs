/** Branding and support contact, shared by the public page and the API routes. */
export const COMPANY_NAME = 'Dream Labs Solutions';

/** WhatsApp number (country code + number, no +) that every error screen sends customers to. */
export const SUPPORT_WHATSAPP = '919991483279';

export function whatsappLink(mobile: string, issue: string): string {
  const text = `Hi ${COMPANY_NAME}, I need help with Netflix for mobile number: ${mobile || 'N/A'}.\nIssue: ${issue}`;
  return `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(text)}`;
}
