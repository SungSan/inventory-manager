import { IronSessionOptions, getIronSession } from 'iron-session';
import { cookies } from 'next/headers';

type Role = 'admin' | 'operator' | 'viewer';

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
    secure: true,
    sameSite: 'lax'
  }
};

export async function getSession() {
  const cookieStore = cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}
