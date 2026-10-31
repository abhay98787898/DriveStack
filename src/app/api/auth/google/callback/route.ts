import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { handleOAuthCallback } from '@/lib/gdrive';
import { getOwnerSession } from '@/lib/auth-guard';
import { getPublicAppUrl } from '@/lib/public-url';

const OAUTH_STATE_COOKIE = 'drive_oauth_state';

function redirectAndClearState(appUrl: string, query: string) {
  const response = NextResponse.redirect(`${appUrl}?${query}`);
  response.cookies.set(OAUTH_STATE_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth/google/callback',
    maxAge: 0,
  });
  return response;
}

function stateMatches(expected: string | undefined, received: string | null): boolean {
  if (!expected || !received) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const returnedState = searchParams.get('state');
  const savedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const appUrl = getPublicAppUrl();
  const session = await getOwnerSession(request.headers);

  if (!session) {
    return redirectAndClearState(appUrl, 'error=owner_login_required');
  }

  if (error) {
    return redirectAndClearState(appUrl, 'error=google_authorization_denied');
  }

  if (!code) {
    return redirectAndClearState(appUrl, 'error=missing_code');
  }

  if (!stateMatches(savedState, returnedState)) {
    return redirectAndClearState(appUrl, 'error=invalid_oauth_state');
  }

  try {
    await handleOAuthCallback(code, session.user.id);
    return redirectAndClearState(appUrl, 'auth=success');
  } catch {
    // Provider and database errors can contain internal details; expose only
    // a stable status code in the browser redirect.
    return redirectAndClearState(appUrl, 'error=drive_connection_failed');
  }
}
