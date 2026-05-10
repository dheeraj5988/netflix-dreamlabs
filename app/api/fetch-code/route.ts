import { NextRequest, NextResponse } from 'next/server';
import { fetchLatestNetflixEmail } from '@/lib/gmailService';
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

    // Fetch the latest Netflix email from the last 24 hours
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const email = await fetchLatestNetflixEmail(userEmail, appPassword, twentyFourHoursAgo);

    if (!email) {
      return NextResponse.json(
        { error: 'No Netflix verification email found in the last 24 hours.' },
        { status: 404 }
      );
    }

    // Parse the email to find Netflix verification link
    const verificationLink = parseNetflixVerificationLink(email);
    if (verificationLink) {
      return NextResponse.json({
        success: true,
        url: verificationLink.url,
      });
    }

    return NextResponse.json(
      { error: 'No valid Netflix verification link found in the email.' },
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
