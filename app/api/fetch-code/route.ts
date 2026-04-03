import { NextRequest, NextResponse } from 'next/server';
import { fetchEmails } from '@/lib/gmailService';
import { parseNetflixVerificationLink } from '@/lib/emailParser';

export async function POST(request: NextRequest) {
  try {
    const { accountNumber } = await request.json();

    // Validate account number
    const account = parseInt(accountNumber, 10);
    if (isNaN(account) || account < 1 || account > 5) {
      return NextResponse.json(
        { error: 'Invalid account number. Must be between 1 and 5.' },
        { status: 400 }
      );
    }

    // Get credentials from environment
    const userEmail = process.env[`GMAIL_USER_${account}`];
    const appPassword = process.env[`GMAIL_APP_PASSWORD_${account}`];

    if (!userEmail || !appPassword) {
      return NextResponse.json(
        { error: `Credentials for account ${account} not configured.` },
        { status: 500 }
      );
    }

    // Fetch emails from the last 24 hours
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const emails = await fetchEmails(userEmail, appPassword, twentyFourHoursAgo);

    // Find Netflix verification link
    for (const email of emails) {
      const verificationLink = parseNetflixVerificationLink(email);
      if (verificationLink) {
        return NextResponse.json({
          success: true,
          code: verificationLink.code,
          url: verificationLink.url,
        });
      }
    }

    return NextResponse.json(
      { error: 'No Netflix verification email found in the last 24 hours.' },
      { status: 404 }
    );
  } catch (error) {
    console.error('Error fetching verification code:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to fetch verification code',
      },
      { status: 500 }
    );
  }
}
