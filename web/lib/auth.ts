import { NextResponse } from 'next/server';
import { supabaseAdmin } from './supabase';
import { getSession, getSessionFromRequest, Role, SessionData, sessionMaxAgeMs } from './session';
import type { NextRequest } from 'next/server';

const CORPORATE_DOMAIN = 'sound-wave.co.kr';
const SPECIAL_EMAIL = 'tksdlvkxl@gmail.com';
const SPECIAL_USERNAME = 'tksdlvkxl';
const APPROVAL_ERROR = 'PENDING_APPROVAL';

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

async function verifyPassword(email: string, password: string) {
  const { data, error } = await supabaseAdmin.rpc('verify_login', {
    p_email: email,
    p_password: password,
  });

  if (error) {
    throw new Error(error.message || '비밀번호 검증에 실패했습니다.');
  }

  if (!data || (Array.isArray(data) && data.length === 0)) {
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return row as { id: string; email: string; role: Role };
}

export async function loginWithUsername(rawUsername: string, password: string) {
  if (!password) {
    throw new Error('비밀번호를 입력하세요.');
  }

  const rawLower = rawUsername.trim().toLowerCase();
  const special = rawLower === SPECIAL_EMAIL || rawLower === SPECIAL_USERNAME;
  const username = special ? SPECIAL_USERNAME : normalizeUsername(rawUsername);
  const email = special ? SPECIAL_EMAIL : deriveEmail(username);

  const { data: userRow, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, email, role, active, approved')
    .eq('email', email)
    .single();

  if (userError && userError.code !== 'PGRST116') {
    throw new Error(userError.message);
  }

  const approvedFlag = special ? true : userRow?.approved ?? false;

  if (!approvedFlag) {
    const err = new Error('관리자 승인 대기 중입니다. 관리자에게 승인 요청하세요.');
    (err as any).code = APPROVAL_ERROR;
    throw err;
  }

  const verified = await verifyPassword(email, password);

  if (!verified) {
    throw new Error('ID 또는 비밀번호가 올바르지 않습니다.');
  }

  if (userRow && userRow.active === false) {
    throw new Error('비활성화된 계정입니다. 관리자에게 문의하세요.');
  }

  const role: Role = (userRow?.role as Role) ?? (special ? 'admin' : 'viewer');

  await supabaseAdmin
    .from('users')
    .upsert({
      id: userRow?.id ?? verified.id,
      email,
      role,
      approved: approvedFlag,
      active: userRow?.active ?? true,
    });

  return {
    id: userRow?.id ?? verified.id,
    email,
    role,
  };
}

export async function loginWithAccessToken(
  accessToken: string,
  rawUsername: string
): Promise<{ id: string; email: string; role: Role }> {
  const rawLower = rawUsername.trim().toLowerCase();
  const special = rawLower === SPECIAL_EMAIL || rawLower === SPECIAL_USERNAME;
  const username = special ? SPECIAL_USERNAME : normalizeUsername(rawUsername);
  const email = special ? SPECIAL_EMAIL : deriveEmail(username);

  const { data: authUser, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
  if (authError || !authUser?.user) {
    throw new Error(authError?.message || '인증 토큰이 유효하지 않습니다.');
  }

  if (
    !authUser.user.email ||
    (authUser.user.email.toLowerCase() !== email.toLowerCase() && authUser.user.email.toLowerCase() !== SPECIAL_EMAIL)
  ) {
    throw new Error('ID와 이메일이 일치하지 않습니다. @ 문자를 포함하지 않는 사내 ID만 입력하세요.');
  }

  const { data: userRow, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, email, role, active, approved')
    .eq('id', authUser.user.id)
    .single();

  if (userError && userError.code !== 'PGRST116') {
    throw new Error(userError.message);
  }

  const bypassApproval = authUser.user.email?.toLowerCase() === SPECIAL_EMAIL || special;
  const approvedFlag = bypassApproval ? true : userRow?.approved ?? false;

  if (!approvedFlag) {
    const err = new Error('관리자 승인 대기 중입니다. 관리자에게 승인 요청하세요.');
    (err as any).code = APPROVAL_ERROR;
    throw err;
  }

  const nextRole: Role = (userRow?.role as Role) ?? (bypassApproval ? 'admin' : 'viewer');

  await supabaseAdmin
    .from('users')
    .upsert({
      id: authUser.user.id,
      email,
      role: nextRole,
      approved: approvedFlag,
      active: userRow?.active ?? true,
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
