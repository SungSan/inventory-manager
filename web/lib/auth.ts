import { NextResponse } from 'next/server';
import { supabaseAdmin } from './supabase';
import { getSession, getSessionFromRequest, Role, SessionData, sessionMaxAgeMs } from './session';
import type { NextRequest } from 'next/server';

const CORPORATE_DOMAIN = 'sound-wave.co.kr';

export function normalizeUsername(raw: string) {
  const username = raw.trim();
  if (!username || /\s/.test(username) || username.includes('@')) {
    throw new Error('유효한 사내 ID를 입력하세요. 공백이나 @ 문자를 포함할 수 없습니다.');
  }
  return username.toLowerCase();
}

export function deriveEmail(username: string) {
  return `${username}@${CORPORATE_DOMAIN}`;
}

export async function loginWithUsername(rawUsername: string) {
  const username = normalizeUsername(rawUsername);
  const email = deriveEmail(username);

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, approved, role')
    .eq('username', username)
    .single();

  if (profileError) {
    throw new Error(profileError.message || '사용자 정보를 찾을 수 없습니다.');
  }

  if (!profile || profile.approved === false || profile.role === 'pending') {
    return { pending: true, email };
  }

  const userId = profile.user_id;
  const { data: userRow, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, email, role, active, full_name, department, contact, purpose')
    .eq('id', userId)
    .single();

  if (userError && userError.code !== 'PGRST116') {
    throw new Error(userError.message);
  }

  const role: Role = (userRow?.role as Role) ?? (profile.role as Role) ?? 'viewer';

  if (userRow && userRow.active === false) {
    throw new Error('비활성화된 계정입니다. 관리자에게 문의하세요.');
  }

  await supabaseAdmin
    .from('users')
    .upsert({
      id: userId,
      email,
      role,
      active: true,
      full_name: userRow?.full_name || email,
      department: userRow?.department || '',
      contact: userRow?.contact || '',
      purpose: userRow?.purpose || '',
    });

  return {
    id: userId,
    email,
    role,
  };
}

export async function loginWithAccessToken(
  accessToken: string,
  rawUsername: string
): Promise<{ pending: true; email: string } | { id: string; email: string; role: Role }> {
  const username = normalizeUsername(rawUsername);
  const email = deriveEmail(username);

  const { data: authUser, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
  if (authError || !authUser?.user) {
    throw new Error(authError?.message || '인증 토큰이 유효하지 않습니다.');
  }

  if (!authUser.user.email || authUser.user.email.toLowerCase() !== email.toLowerCase()) {
    throw new Error('ID와 이메일이 일치하지 않습니다. @ 문자를 포함하지 않는 사내 ID만 입력하세요.');
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .select('approved, role, username')
    .eq('user_id', authUser.user.id)
    .single();

  if (profileError && profileError.code !== 'PGRST116') {
    throw new Error(profileError.message);
  }

  if (!profile || profile.approved === false || profile.role === 'pending') {
    return { pending: true, email };
  }

  const nextRole: Role = (profile.role as Role) ?? 'viewer';

  const metadata = authUser.user.user_metadata || {};

  await supabaseAdmin
    .from('users')
    .upsert({
      id: authUser.user.id,
      email,
      role: nextRole,
      active: true,
      full_name: metadata.full_name || email,
      department: metadata.department || '',
      contact: metadata.contact || '',
      purpose: metadata.purpose || '',
    });

  return {
    id: authUser.user.id,
    email,
    role: nextRole,
  };
}

export async function requireRole(roles: Role[]) {
  const session = await getSession();
  if (!session.userId || !session.role || !roles.includes(session.role as Role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return null;
}

export async function setSession(req: NextRequest, user: { id: string; email: string; role: Role }) {
  const { session, response } = await getSessionFromRequest(
    req,
    NextResponse.json({ ok: true, role: user.role })
  );
  session.userId = user.id;
  session.email = user.email;
  session.role = user.role;
  session.expiresAt = Date.now() + sessionMaxAgeMs;
  await session.save();
  return response;
}

export async function clearSession(req: NextRequest) {
  const { session, response } = await getSessionFromRequest(req, NextResponse.json({ ok: true }));
  await session.destroy();
  return response;
}

export async function withAuth(roles: Role[], handler: (session: SessionData) => Promise<NextResponse>) {
  const session = await getSession();
  if (!session.userId || !session.role || !roles.includes(session.role as Role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return handler(session);
}
