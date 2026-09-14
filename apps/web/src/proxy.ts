import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIES = ['__Host-smarttag_session', 'smarttag_session'];

/**
 * Optimistic route protection: visitors without a session cookie are sent to the login page
 * before any application page renders. This is a UX measure only — the API validates the session
 * and authorizes every request server-side.
 */
export function proxy(request: NextRequest) {
  const hasSessionCookie = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (hasSessionCookie) {
    return NextResponse.next();
  }
  const loginUrl = new URL('/login', request.url);
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (next !== '/') {
    loginUrl.searchParams.set('next', next);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!login|api/|_next/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
