import { EmailData } from './gmailService'

export interface VerificationLink {
  url: string
  foundIn: string
}

export function parseNetflixVerificationLink(
  email: EmailData
): VerificationLink | null {
  // Check if email is from Netflix (subject check is loose — Netflix uses
  // many subjects like "Verify your Netflix account", "Someone is using 
  // your Netflix account" etc.)
  const fromLower = email.from.toLowerCase()
  const isFromNetflix =
    fromLower.includes('netflix.com') ||
    fromLower.includes('info@account.netflix') ||
    fromLower.includes('noreply@netflix')

  if (!isFromNetflix) return null

  const content = email.html || email.text

  // Netflix verification links — match all possible URL patterns
  // Do NOT require ?code= param — the full URL is the link
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
