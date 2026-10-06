import { NextRequest } from 'next/server';
import { handlePaypurCallback } from '@/lib/paypur-callback';

export const dynamic = 'force-dynamic';

export const GET = (request: NextRequest) => handlePaypurCallback(request);
export const POST = (request: NextRequest) => handlePaypurCallback(request);
