import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { getAuthUrl } from '@/lib/gdrive';

const OAUTH_STATE_COOKIE = 'drive_oauth_state';

export async function GET() {
  try {
    const state = randomBytes(32).toString('base64url');
    const response = NextResponse.redirect(getAuthUrl(state));

    response.cookies.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth/google/callback',
      maxAge: 10 * 60,
    });

    return response;
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : 'Failed to generate OAuth URL',
      },
      { status: 500 }
    );
  }
}
