import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionFromRequest } from './lib/session';

const publicPaths = ['/api/auth/login', '/api/auth/logout', '/'];

export async function middleware(req: NextRequest) {
  if (publicPaths.some((p) => req.nextUrl.pathname === p)) return NextResponse.next();
  const { session, response } = await getSessionFromRequest(req);
  if (!session.userId) {
    return NextResponse.redirect(new URL('/', req.url));
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
