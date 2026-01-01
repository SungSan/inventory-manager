import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSession } from './lib/session';

const publicPaths = ['/api/auth/login', '/api/auth/logout', '/'];

export async function middleware(req: NextRequest) {
  if (publicPaths.some((p) => req.nextUrl.pathname === p)) return NextResponse.next();
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.redirect(new URL('/', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
