import type { EmailData } from './gmailService';

export interface VerificationLink {
  url: string;
  foundIn: string;
  /** "primary" is the real Update Primary Location link; "fallback" is any other household/verify link. */
  kind: 'primary' | 'fallback';
}

/**
 * Decode HTML entities in email content (e.g., &amp; to &, &quot; to ")
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'");
}

/**
 * Strip trailing punctuation and whitespace from a URL cut out of free text.
 * Query parameters (including the & between them) are kept intact.
 */
function sanitizeUrl(url: string): string {
  return url.replace(/[.,;:!?)\]}>'"\s]+$/, '');
}

export function parseNetflixVerificationLink(email: EmailData): VerificationLink | null {
  // Check if email is from Netflix
  const fromLower = email.from.toLowerCase();
  const isFromNetflix =
    fromLower.includes('netflix.com') ||
    fromLower.includes('info@account.netflix') ||
    fromLower.includes('noreply@netflix');

  if (!isFromNetflix) return null;

  // Decode HTML entities and use the content
  const content = decodeHtmlEntities(email.html || email.text);

  // The "Update Primary Location" URL first (priority for household updates).
  // The whole URL is kept: Netflix puts the sign-in token and tracking in separate parameters.
  const updatePrimaryLocationRegex = /https:\/\/www\.netflix\.com\/account\/update-primary-location\?[^\s"'<>]+/i;
  const updateMatch = content.match(updatePrimaryLocationRegex);
  if (updateMatch) {
    return { url: sanitizeUrl(updateMatch[0]), foundIn: email.from, kind: 'primary' };
  }

  // Fall back to other Netflix verification/household URLs
  const linkPatterns = [
    /https:\/\/www\.netflix\.com\/account\/travel\/[^\s"'<>]+/gi,
    /https:\/\/www\.netflix\.com\/account\/household\/[^\s"'<>]+/gi,
    /https:\/\/www\.netflix\.com\/verify[^\s"'<>]+/gi,
    /https:\/\/www\.netflix\.com\/account\/[^\s"'<>]*verify[^\s"'<>]*/gi,
    // No catch-all for links that merely contain "confirm": that also matches billing and sign-up emails.
  ];

  for (const pattern of linkPatterns) {
    const matches = content.match(pattern);
    if (matches && matches.length > 0) {
      return { url: sanitizeUrl(matches[0]), foundIn: email.from, kind: 'fallback' };
    }
  }

  return null;
}
