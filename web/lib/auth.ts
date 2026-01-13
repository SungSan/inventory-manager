import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from './supabase';
import { getSession, getSessionFromRequest, Role, SessionData, sessionMaxAgeMs } from './session';
import type { NextRequest } from 'next/server';

const CORPORATE_DOMAIN = 'sound-wave.co.kr';
const SPECIAL_EMAIL = 'tksdlvkxl@gmail.com';
const SPECIAL_USERNAME = 'tksdlvkxl';
const APPROVAL_ERROR = 'PENDING_APPROVAL';

const supabaseAuthUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAuthKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseAuthUrl || !supabaseAuthKey) {
  throw new Error('SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL와 SUPABASE_ANON_KEY 환경 변수가 필요합니다.');
}

const supabaseAuth = createClient(supabaseAuthUrl, supabaseAuthKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { 'x-application-name': 'inventory-web-auth' } },
});

export function normalizeUsername(raw: string) {
  const username = raw.trim();
  if (!username || /\s/.test(username)) {
    throw new Error('유효한 사내 ID를 입력하세요. 공백을 포함할 수 없습니다.');
  }
  return username.toLowerCase();
}

export function deriveEmail(username: string) {
  if (username.includes('@')) {
    return username.toLowerCase();
  }
  return `${username}@${CORPORATE_DOMAIN}`;
}

export async function loginWithUsername(rawUsername: string, password: string) {
  if (!password) {
    throw new Error('비밀번호를 입력하세요.');
  }

  const trimmedInput = rawUsername.trim();
  if (!trimmedInput) {
    throw new Error('사내 ID를 입력하세요.');
  }

  if (/\s/.test(trimmedInput)) {
    throw new Error('사내 ID에는 공백을 포함할 수 없습니다.');
  }

  const rawLower = trimmedInput.toLowerCase();
  const special = rawLower === SPECIAL_EMAIL || rawLower === SPECIAL_USERNAME;
  const hasDomain = trimmedInput.includes('@');
  const normalizedUsername = special
    ? SPECIAL_USERNAME
    : hasDomain
      ? trimmedInput.split('@')[0].toLowerCase()
      : normalizeUsername(trimmedInput);
  if (!normalizedUsername) {
    throw new Error('유효한 사내 ID를 입력하세요.');
  }
  const email = special ? SPECIAL_EMAIL : deriveEmail(hasDomain ? trimmedInput : normalizedUsername);

  const { data: authResult, error: authError } = await supabaseAuth.auth.signInWithPassword({
    email,
    password,
  });

  if (authError) {
    throw new Error(authError.message || '로그인에 실패했습니다.');
  }

  const authUser = authResult?.user;
  if (!authUser) {
    throw new Error('인증 정보를 확인할 수 없습니다.');
  }

  const { data: userRow, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, email, role, approved, active')
    .eq('id', authUser.id)
    .maybeSingle();

  if (userError && userError.code !== 'PGRST116') {
    throw new Error(userError.message);
  }

  let ensuredUser = userRow ?? null;

  if (!ensuredUser) {
    const { data: insertedUser, error: insertUserError } = await supabaseAdmin
      .from('users')
      .upsert({
        id: authUser.id,
        email,
        role: 'viewer',
        approved: false,
        active: false,
      })
      .select('id, email, role, approved, active')
      .single();

    if (insertUserError) {
      throw new Error(insertUserError.message);
    }

    ensuredUser = insertedUser;
  }

  const profilePayload = {
    user_id: authUser.id,
    username: normalizedUsername,
    role: (ensuredUser?.role as Role | undefined) ?? 'viewer',
    approved: ensuredUser?.approved ?? false,
    full_name: (authUser.user_metadata as any)?.full_name ?? '',
    department: (authUser.user_metadata as any)?.department ?? '',
    contact: (authUser.user_metadata as any)?.contact ?? '',
    purpose: (authUser.user_metadata as any)?.purpose ?? '',
    requested_at: new Date().toISOString(),
    approved_at: ensuredUser?.approved ? new Date().toISOString() : null,
    approved_by: null,
  };

  await supabaseAdmin.from('user_profiles').upsert(profilePayload);

  const bypassApproval = authUser.email?.toLowerCase() === SPECIAL_EMAIL || special;
  const approvedFlag = bypassApproval ? true : ensuredUser?.approved ?? false;

  if (!approvedFlag) {
    const err = new Error('관리자 승인 대기 중입니다. 관리자에게 승인 요청하세요.');
    (err as any).code = APPROVAL_ERROR;
    throw err;
  }

  if (ensuredUser && ensuredUser.active === false) {
    throw new Error('비활성화된 계정입니다. 관리자에게 문의하세요.');
  }

  const role: Role = (ensuredUser?.role as Role) ?? (special ? 'admin' : 'viewer');

  await supabaseAdmin
    .from('users')
    .upsert({
      id: authUser.id,
      email,
      role,
      approved: approvedFlag,
      active: ensuredUser?.active ?? true,
    });

  return {
    id: authUser.id,
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
    .select('id, email, role, approved, active')
    .eq('id', authUser.user.id)
    .maybeSingle();

  if (userError && userError.code !== 'PGRST116') {
    throw new Error(userError.message);
  }

  let ensuredUser = userRow ?? null;

  if (!ensuredUser) {
    const { data: insertedUser, error: insertUserError } = await supabaseAdmin
      .from('users')
      .upsert({
        id: authUser.user.id,
        email,
        role: 'viewer',
        approved: false,
        active: false,
      })
      .select('id, email, role, approved, active')
      .single();

    if (insertUserError) {
      throw new Error(insertUserError.message);
    }

    ensuredUser = insertedUser;
  }

  const profilePayload = {
    user_id: authUser.user.id,
    username: username,
    role: (ensuredUser?.role as Role | undefined) ?? 'viewer',
    approved: ensuredUser?.approved ?? false,
    full_name: (authUser.user.user_metadata as any)?.full_name ?? '',
    department: (authUser.user.user_metadata as any)?.department ?? '',
    contact: (authUser.user.user_metadata as any)?.contact ?? '',
    purpose: (authUser.user.user_metadata as any)?.purpose ?? '',
    requested_at: new Date().toISOString(),
    approved_at: ensuredUser?.approved ? new Date().toISOString() : null,
    approved_by: null,
  };

  await supabaseAdmin.from('user_profiles').upsert(profilePayload);

  const bypassApproval = authUser.user.email?.toLowerCase() === SPECIAL_EMAIL || special;
  const approvedFlag = bypassApproval ? true : ensuredUser?.approved ?? false;

  if (!approvedFlag) {
    const err = new Error('관리자 승인 대기 중입니다. 관리자에게 승인 요청하세요.');
    (err as any).code = APPROVAL_ERROR;
    throw err;
  }

  if (ensuredUser && ensuredUser.active === false) {
    throw new Error('비활성화된 계정입니다. 관리자에게 문의하세요.');
  }

  const nextRole: Role = (ensuredUser?.role as Role) ?? (bypassApproval ? 'admin' : 'viewer');

  await supabaseAdmin
    .from('users')
    .upsert({
      id: authUser.user.id,
      email,
      role: nextRole,
      approved: approvedFlag,
      active: ensuredUser?.active ?? true,
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
  if (!session.userId) {
    console.error({ step: 'missing_session_user', sessionUserId: session.userId, sessionRole: session.role });
    return NextResponse.json({ error: 'forbidden', step: 'missing_session_user' }, { status: 403 });
  }

  const { data: userRow, error } = await supabaseAdmin
    .from('users')
    .select('id, role, approved, active')
    .eq('id', session.userId)
    .maybeSingle();

  if (error) {
    console.error({ step: 'load_user', userId: session.userId, error });
    return NextResponse.json(
      { error: error.message, step: 'load_user', details: (error as any)?.details ?? null },
      { status: 500 }
    );
  }

  if (!userRow) {
    console.error({ step: 'missing_user', userId: session.userId });
    return NextResponse.json({ error: 'forbidden', step: 'missing_user' }, { status: 403 });
  }

  const role: Role = (userRow.role as Role) ?? (session.role as Role);

  if (userRow.approved === false) {
    console.error({ step: 'not_approved', userId: session.userId, dbUser: userRow });
    return NextResponse.json({ error: 'forbidden', step: 'not_approved' }, { status: 403 });
  }

  if (userRow.active === false) {
    console.error({ step: 'inactive', userId: session.userId, dbUser: userRow });
    return NextResponse.json({ error: 'forbidden', step: 'inactive' }, { status: 403 });
  }

  if (!roles.includes(role)) {
    console.error({ step: 'insufficient_role', userId: session.userId, role, required: roles });
    return NextResponse.json({ error: 'forbidden', step: 'insufficient_role' }, { status: 403 });
  }

  session.role = role;
  return handler(session);
}
