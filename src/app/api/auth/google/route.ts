import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUrl } from '@/lib/gdrive';
import { getOwnerSession } from '@/lib/auth-guard';

const OAUTH_STATE_COOKIE = 'drive_oauth_state';

export async function GET(request: NextRequest) {
  try {
    const session = await getOwnerSession(request.headers);
    if (!session) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

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
  } catch {
    return NextResponse.json(
      { error: 'Unable to start Google Drive connection. Check server configuration and try again.' },
      { status: 500 }
    );
  }
}
