import type { IronSession } from 'iron-session';
import { IronSessionOptions, getIronSession as getIronSessionNode } from 'iron-session';
import { getIronSession as getIronSessionEdge } from 'iron-session/edge';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export type Role = 'admin' | 'operator' | 'viewer';

export type SessionData = {
  userId?: string;
  email?: string;
  role?: Role;
};

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

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = cookies();
  return getIronSessionNode<SessionData>(cookieStore, sessionOptions);
}

export async function getSessionFromRequest(req: NextRequest): Promise<{
  session: IronSession<SessionData>;
  response: NextResponse;
}> {
  const res = NextResponse.next();
  const session = await getIronSessionEdge<SessionData>(req, res, sessionOptions);
  return { session, response: res };
}
