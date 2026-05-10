import { EmailData } from './gmailService'

export interface VerificationLink {
  url: string
  foundIn: string
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
    .replace(/&apos;/g, "'")
}

/**
 * Sanitize URL by removing trailing punctuation and whitespace
 */
function sanitizeUrl(url: string): string {
  return url.replace(/[.,;:!?)\]}>'"&\s]+$/, '').replace(/&amp;/g, '&')
}

export function parseNetflixVerificationLink(
  email: EmailData
): VerificationLink | null {
  // Check if email is from Netflix
  const fromLower = email.from.toLowerCase()
  const isFromNetflix =
    fromLower.includes('netflix.com') ||
    fromLower.includes('info@account.netflix') ||
    fromLower.includes('noreply@netflix')

  if (!isFromNetflix) return null

  // Decode HTML entities and use the content
  let content = email.html || email.text
  content = decodeHtmlEntities(content)

  // Look for "Update Primary Location" URL first (priority for household updates)
  const updatePrimaryLocationRegex = /https:\/\/www\.netflix\.com\/account\/update-primary-location\?[^\s"'<>&]+/i
  const updateMatch = content.match(updatePrimaryLocationRegex)
  if (updateMatch) {
    const url = sanitizeUrl(updateMatch[0])
    return { url, foundIn: email.from }
  }

  // Fall back to other Netflix verification/household URLs
  const linkPatterns = [
    /https:\/\/www\.netflix\.com\/account\/travel\/[^\s"'<>&]+/gi,
    /https:\/\/www\.netflix\.com\/account\/household\/[^\s"'<>&]+/gi,
    /https:\/\/www\.netflix\.com\/verify[^\s"'<>&]+/gi,
    /https:\/\/www\.netflix\.com\/account\/[^\s"'<>&]*verify[^\s"'<>&]*/gi,
    /https:\/\/www\.netflix\.com[^\s"'<>&]*confirm[^\s"'<>&]*/gi,
  ]

  for (const pattern of linkPatterns) {
    const matches = content.match(pattern)
    if (matches && matches.length > 0) {
      const url = sanitizeUrl(matches[0])
      return { url, foundIn: email.from }
    }
  }

  return null
}
