import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from './supabase';
import { getSession, getSessionFromRequest, Role, SessionData, sessionMaxAgeMs } from './session';
import type { NextRequest } from 'next/server';
import { headers } from 'next/headers';

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

type UserProfileSyncInput = {
  userId: string;
  username: string;
  role: Role;
  approved: boolean;
  full_name: string;
  department: string;
  contact: string;
  purpose: string;
};

async function syncUserProfile(payload: UserProfileSyncInput) {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id')
    .eq('user_id', payload.userId)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (!existing) {
    const insertPayload = {
      user_id: payload.userId,
      username: payload.username,
      role: payload.role,
      approved: payload.approved,
      full_name: payload.full_name,
      department: payload.department,
      contact: payload.contact,
      purpose: payload.purpose,
      requested_at: new Date().toISOString(),
      approved_at: payload.approved ? new Date().toISOString() : null,
      approved_by: null,
    };
    const { error: insertError } = await supabaseAdmin.from('user_profiles').insert(insertPayload);
    if (insertError) throw new Error(insertError.message);
  } else {
    const updatePayload = {
      username: payload.username,
      role: payload.role,
      approved: payload.approved,
      full_name: payload.full_name,
      department: payload.department,
      contact: payload.contact,
      purpose: payload.purpose,
    };
    const { error: updateError } = await supabaseAdmin
      .from('user_profiles')
      .update(updatePayload)
      .eq('user_id', payload.userId);
    if (updateError) throw new Error(updateError.message);
  }
}

function isCorporateEmail(email: string) {
  const value = String(email ?? '').trim().toLowerCase();
  return value.endsWith(`@${CORPORATE_DOMAIN}`);
}

function toUsername(email: string) {
  const value = String(email ?? '').trim().toLowerCase();
  const at = value.indexOf('@');
  return at >= 0 ? value.slice(0, at) : value;
}

function isSpecialAccount(email: string) {
  const e = String(email ?? '').trim().toLowerCase();
  const u = toUsername(e);
  return e === SPECIAL_EMAIL || u === SPECIAL_USERNAME;
}

async function ensureUserRow(params: { userId: string; email: string; username: string }) {
  const { userId, email, username } = params;

  const { data: existing, error } = await supabaseAdmin
    .from('users')
    .select('id, role, approved, active')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (existing) return existing;

  const approved = isSpecialAccount(email) ? true : false;
  const role: Role = isSpecialAccount(email) ? 'admin' : 'viewer';

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('users')
    .insert({
      id: userId,
      email,
      username,
      role,
      approved,
      active: true,
      created_at: new Date().toISOString(),
    })
    .select('id, role, approved, active')
    .single();

  if (insertError) {
    throw new Error(insertError.message);
  }

  // user_profiles도 동기화 (없으면 생성)
  await syncUserProfile({
    userId,
    username,
    role,
    approved,
    full_name: '',
    department: '',
    contact: '',
    purpose: '',
  });

  return inserted;
}

/**
 * ✅ 추가: 모바일 앱용 Bearer 토큰을 SessionData 형태로 변환
 * - Authorization: Bearer <supabase access_token> 이 있으면 우선 적용
 * - 없으면 기존 쿠키 기반 getSession() 흐름 그대로
 */
async function getSessionFromBearerHeader(): Promise<SessionData | null> {
  const h = headers();
  const auth = h.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;

  const token = auth.slice('Bearer '.length).trim();
  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;

  const user = data.user;
  const userId = user.id;
  const email = user.email ?? null;

  // 세션 객체(웹처럼 쿠키 저장은 하지 않음: 앱은 토큰을 들고 있음)
  const now = Date.now();
  const session: SessionData = {
    userId,
    email,
    role: 'viewer', // DB users.role로 최종 확정됨 (withAuth에서 덮어씀)
    expiresAt: now + sessionMaxAgeMs,
    save: async () => {},
    destroy: async () => {},
  };

  return session;
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const email = String(body?.email ?? '').trim().toLowerCase();
  const password = String(body?.password ?? '');
  const full_name = String(body?.full_name ?? '');
  const department = String(body?.department ?? '');
  const contact = String(body?.contact ?? '');
  const purpose = String(body?.purpose ?? '');

  if (!email || !password) {
    return NextResponse.json({ error: 'email/password required' }, { status: 400 });
  }

  if (!isCorporateEmail(email) && !isSpecialAccount(email)) {
    return NextResponse.json({ error: 'corporate email required' }, { status: 403 });
  }

  const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (!data?.user) {
    return NextResponse.json({ error: 'login failed' }, { status: 401 });
  }

  const userId = data.user.id;
  const username = toUsername(email);

  try {
    const userRow = await ensureUserRow({ userId, email, username });

    // 승인 안 된 계정은 로그인은 되지만 접근은 막는 정책이면 여기서 처리
    if (userRow.approved === false) {
      return NextResponse.json({ error: APPROVAL_ERROR }, { status: 403 });
    }

    // 세션 저장(웹 쿠키 기반)
    const session = await getSessionFromRequest(req);
    session.userId = userId;
    session.email = email;
    session.role = (userRow.role as Role) ?? 'viewer';
    session.expiresAt = Date.now() + sessionMaxAgeMs;
    await session.save();

    // user_profiles 동기화(요청 폼 값 저장)
    await syncUserProfile({
      userId,
      username,
      role: (userRow.role as Role) ?? 'viewer',
      approved: userRow.approved !== false,
      full_name,
      department,
      contact,
      purpose,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}

export async function DELETE() {
  const session = await getSession();
  await session.destroy();
  return NextResponse.json({ ok: true });
}

export async function withAuth(roles: Role[], handler: (session: SessionData) => Promise<NextResponse>) {
  // ✅ 추가: Bearer 세션 우선(앱)
  const bearerSession = await getSessionFromBearerHeader();
  const session = bearerSession ?? (await getSession());

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
