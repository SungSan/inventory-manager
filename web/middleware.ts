import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const publicPaths = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/register',
  '/api/auth/me',
  '/auth/callback',
  '/',
];
const cookieName = process.env.SESSION_COOKIE_NAME || 'inventory_session';

export function middleware(req: NextRequest) {
  if (publicPaths.some((p) => req.nextUrl.pathname === p)) return NextResponse.next();

  const hasSession = Boolean(req.cookies.get(cookieName)?.value);
  if (!hasSession) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
