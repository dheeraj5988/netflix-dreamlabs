import { EmailData } from './gmailService';

export interface VerificationLink {
  code: string;
  url: string;
  foundIn: string;
}

export function parseNetflixVerificationLink(
  email: EmailData
): VerificationLink | null {
  // Check if this is a Netflix email
  const subjectLower = email.subject.toLowerCase();
  if (
    !subjectLower.includes('netflix') ||
    !subjectLower.includes('verification')
  ) {
    return null;
  }

  const content = email.html || email.text;

  // Extract verification link - look for Netflix verify or confirm links
  const linkPatterns = [
    /https:\/\/www\.netflix\.com[^\s"'<>]*(verify|confirm)[^\s"'<>]*/gi,
    /https:\/\/www\.netflix\.com[^\s"'<>]*code[^\s"'<>]*/gi,
    /https:\/\/www\.netflix\.com[^\s"'<>]*household[^\s"'<>]*/gi,
  ];

  for (const pattern of linkPatterns) {
    const matches = content.match(pattern);
    if (matches && matches.length > 0) {
      const url = matches[0];
      // Extract code from URL
      const codeMatch = url.match(/[?&]code=([^&\s"'<>]+)/);
      const code = codeMatch ? codeMatch[1] : '';

      if (code) {
        return {
          code,
          url,
          foundIn: email.from,
        };
      }
    }
  }

  return null;
}
