import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from './supabase';
import { getSession, SessionData } from './session';

export type Role = 'admin' | 'operator' | 'viewer';

export async function verifyLogin(email: string, password: string) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, email, password_hash, role, active')
    .eq('email', email.toLowerCase())
    .single();

  if (error || !data || !data.active) return null;
  const ok = await bcrypt.compare(password, data.password_hash);
  if (!ok) return null;
  return { id: data.id as string, email: data.email as string, role: data.role as Role };
}

export async function requireRole(roles: Role[]) {
  const session = await getSession();
  if (!session.userId || !session.role || !roles.includes(session.role as Role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return null;
}

export async function setSession(user: { id: string; email: string; role: Role }) {
  const session = await getSession();
  session.userId = user.id;
  session.email = user.email;
  session.role = user.role;
  await session.save();
}

export async function clearSession() {
  const session = await getSession();
  await session.destroy();
}

export async function withAuth(roles: Role[], handler: (session: SessionData) => Promise<NextResponse>) {
  const session = await getSession();
  if (!session.userId || !session.role || !roles.includes(session.role as Role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return handler(session);
}
