import { EmailData } from './gmailService'

export interface VerificationLink {
  url: string
  foundIn: string
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

  const content = email.html || email.text

  // Look for "Update Primary Location" URL first (priority for household updates)
  const updatePrimaryLocationRegex = /https:\/\/www\.netflix\.com\/account\/update-primary-location\?[^\s"'<>]+/i
  const updateMatch = content.match(updatePrimaryLocationRegex)
  if (updateMatch) {
    const url = updateMatch[0].replace(/['">\s]+$/, '')
    return { url, foundIn: email.from }
  }

  // Fall back to other Netflix verification/household URLs
  const linkPatterns = [
    /https:\/\/www\.netflix\.com\/account\/travel\/[^\s"'<>]+/gi,
    /https:\/\/www\.netflix\.com\/account\/household\/[^\s"'<>]+/gi,
    /https:\/\/www\.netflix\.com\/verify[^\s"'<>]+/gi,
    /https:\/\/www\.netflix\.com\/account\/[^\s"'<>]*verify[^\s"'<>]*/gi,
    /https:\/\/www\.netflix\.com[^\s"'<>]*confirm[^\s"'<>]*/gi,
  ]

  for (const pattern of linkPatterns) {
    const matches = content.match(pattern)
    if (matches && matches.length > 0) {
      const url = matches[0].replace(/['">\s]+$/, '')
      return { url, foundIn: email.from }
    }
  }

  return null
}
