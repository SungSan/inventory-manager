import type { IronSession } from 'iron-session';
import { IronSessionOptions, getIronSession as getIronSessionNode } from 'iron-session';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export type Role = 'admin' | 'operator' | 'viewer';

export type SessionData = IronSession;

const sessionPassword = process.env.SESSION_PASSWORD;
const cookieName = process.env.SESSION_COOKIE_NAME || 'inventory_session';
const sessionTtlSeconds = 60 * 30; // 30 minutes

if (!sessionPassword) {
  throw new Error('SESSION_PASSWORD must be set');
}

export const sessionOptions: IronSessionOptions = {
  password: sessionPassword,
  cookieName,
  ttl: sessionTtlSeconds,
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: sessionTtlSeconds,
  }
};

export async function getSession(): Promise<SessionData> {
  const cookieStore = cookies();
  const req = new Request('http://localhost', {
    headers: { cookie: cookieStore.toString() }
  });
  const res = new Response();
  const session = await getIronSessionNode(req, res, sessionOptions);

  if (session.expiresAt && Date.now() > Number(session.expiresAt)) {
    await session.destroy();
  }

  return session;
}

export async function getSessionFromRequest(
  req: NextRequest,
  res: NextResponse = NextResponse.next()
): Promise<{
  session: SessionData;
  response: NextResponse;
}> {
  const session = await getIronSessionNode(req, res, sessionOptions);

  if (session.expiresAt && Date.now() > Number(session.expiresAt)) {
    await session.destroy();
  }

  return { session, response: res };
}
