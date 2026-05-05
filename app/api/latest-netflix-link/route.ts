import { fetchEmails } from '@/lib/gmailService';
import { parseNetflixVerificationLink } from '@/lib/emailParser';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const accountStr = searchParams.get('account');
  const minutesStr = searchParams.get('minutes') || '30';

  // Validate account number
  const account = parseInt(accountStr || '');
  if (isNaN(account) || account < 1 || account > 5) {
    return Response.json({
      success: false,
      message: 'Invalid account number. Must be between 1 and 5.',
    });
  }

  const minutes = parseInt(minutesStr);
  const searchSince = new Date(Date.now() - minutes * 60 * 1000);

  // Get credentials from environment variables
  const emailKey = `GMAIL_USER_${account}`;
  const passwordKey = `GMAIL_APP_PASSWORD_${account}`;

  const userEmail = process.env[emailKey];
  const appPassword = process.env[passwordKey];

  if (!userEmail || !appPassword) {
    return Response.json({
      success: false,
      message: `Credentials for account ${account} not found.`,
    });
  }

  try {
    // Fetch emails from Gmail
    const emails = await fetchEmails(userEmail, appPassword, searchSince);

    // Parse emails to find Netflix verification link
    for (const email of emails) {
      const verificationLink = parseNetflixVerificationLink(email);
      if (verificationLink) {
        return Response.json({
          success: true,
          url: verificationLink.url,
          message: 'Update link found successfully.',
        });
      }
    }

    return Response.json({
      success: false,
      message: `No Netflix verification link found in the last ${minutes} minutes.`,
    });
  } catch (error: any) {
    console.error('Error fetching Netflix verification link:', error);
    return Response.json({
      success: false,
      message: 'Service is temporarily unavailable. Please try again shortly.',
    });
  }
}
