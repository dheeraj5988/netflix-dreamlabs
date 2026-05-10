import { fetchLatestNetflixEmail } from '@/lib/gmailService';
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
    // Fetch the latest Netflix email from Gmail
    const email = await fetchLatestNetflixEmail(
      userEmail,
      appPassword,
      searchSince
    );

    if (!email) {
      return Response.json({
        success: false,
        message: `No Netflix verification link found in the last ${minutes} minutes.`,
      });
    }

    // Strict JavaScript-level time filtering
    // IMAP SINCE only filters by date (midnight), not minutes
    const emailTimestamp = email.date.getTime();
    const cutoffTimestamp = Date.now() - minutes * 60 * 1000;

    if (emailTimestamp < cutoffTimestamp) {
      return Response.json({
        success: false,
        message: `No recent Netflix verification link found. The latest email is older than ${minutes} minutes.`,
      });
    }

    // Parse the email to find Netflix verification link
    const verificationLink = parseNetflixVerificationLink(email);
    if (verificationLink) {
      return Response.json({
        success: true,
        url: verificationLink.url,
        message: 'Update link found successfully.',
      });
    }

    return Response.json({
      success: false,
      message: 'No valid Netflix verification link found in the email.',
    });
  } catch (error: any) {
    console.error('Error fetching Netflix verification link:', error);

    // Provide specific error messages
    const errorMessage = error.message || '';
    if (errorMessage.includes('Authentication failed')) {
      return Response.json({
        success: false,
        message: 'Authentication failed. Please check your credentials.',
      });
    } else if (
      errorMessage.includes('timeout') ||
      errorMessage.includes('ETIMEDOUT')
    ) {
      return Response.json({
        success: false,
        message: 'Request timed out. Please try again shortly.',
      });
    }

    return Response.json({
      success: false,
      message: 'Service is temporarily unavailable. Please try again shortly.',
    });
  }
}
