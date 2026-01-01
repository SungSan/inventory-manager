import type { IronSession } from 'iron-session';
import { IronSessionOptions, getIronSession as getIronSessionNode } from 'iron-session';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export type Role = 'admin' | 'operator' | 'viewer';

export type SessionData = IronSession;

const sessionPassword = process.env.SESSION_PASSWORD;
const cookieName = process.env.SESSION_COOKIE_NAME || 'inventory_session';

if (!sessionPassword) {
  throw new Error('SESSION_PASSWORD must be set');
}

export const sessionOptions: IronSessionOptions = {
  password: sessionPassword,
  cookieName,
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
};

export async function getSession(): Promise<SessionData> {
  const cookieStore = cookies();
  const req = new Request('http://localhost', {
    headers: { cookie: cookieStore.toString() }
  });
  const res = new Response();
  return getIronSessionNode(req, res, sessionOptions);
}

export async function getSessionFromRequest(
  req: NextRequest,
  res: NextResponse = NextResponse.next()
): Promise<{
  session: SessionData;
  response: NextResponse;
}> {
  const session = await getIronSessionNode(req, res, sessionOptions);
  return { session, response: res };
}
