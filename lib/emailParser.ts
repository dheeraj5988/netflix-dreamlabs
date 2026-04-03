import { EmailData } from './gmailService';

export interface VerificationLink {
  code: string;
  url: string;
  foundIn: string;
}

function parseNetflixVerificationLink(email: EmailData): VerificationLink | null {
  // Check if this is a Netflix email
  if (
    !email.subject.includes('Netflix') ||
    !email.subject.includes('verification')
  ) {
    return null;
  }

  let content = email.html || email.text;

  // Extract verification link - look for Netflix verify or confirm links
  const linkPatterns = [
    /https:\/\/www\.netflix\.com[^\s"'<>]*(verify|confirm)[^\s"'<>]*/gi,
    /https:\/\/www\.netflix\.com[^\s"'<>]*code[^\s"'<>]*/gi,
    /https:\/\/www\.netflix\.com[^\s"'<>]*household[^\s"'<>]*/gi,
  ];

  for (const pattern of linkPatterns) {
    const match = content.match(pattern);
    if (match) {
      const url = match[0];
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

export { parseNetflixVerificationLink };
