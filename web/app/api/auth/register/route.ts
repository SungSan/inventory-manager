import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../../../../lib/supabase';

const CORPORATE_DOMAIN = 'sound-wave.co.kr';

function normalizeUsername(raw: string) {
  const username = raw.trim();
  if (!username || /\s/.test(username) || username.includes('@')) {
    throw new Error('유효한 사내 ID를 입력하세요. 공백이나 @ 문자를 포함할 수 없습니다.');
  }
  return username.toLowerCase();
}

export async function POST(req: Request) {
  const { username, name, department, contact, purpose, password } = await req.json();
  const normalizedUsername = normalizeUsername((username ?? '').toString());
  const fullName = (name ?? '').toString().trim();
  const dept = (department ?? '').toString().trim();
  const contactInfo = (contact ?? '').toString().trim();
  const userPurpose = (purpose ?? '').toString().trim();

  if (!fullName || !dept) {
    return NextResponse.json({ error: '성함과 부서를 입력하세요.' }, { status: 400 });
  }

  if (!password || password.toString().length < 8) {
    return NextResponse.json({ error: '비밀번호를 8자 이상 입력하세요.' }, { status: 400 });
  }

  const email = `${normalizedUsername}@${CORPORATE_DOMAIN}`;

  try {
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: password.toString(),
      email_confirm: true,
      user_metadata: {
        username: normalizedUsername,
        full_name: fullName,
        department: dept,
        contact: contactInfo,
        purpose: userPurpose,
        role: 'viewer',
      },
    });

    if (authError) {
      throw new Error(authError.message);
    }

    const authId = authData?.user?.id;
    if (!authId) {
      throw new Error('auth user id 생성에 실패했습니다.');
    }

    const passwordHash = await bcrypt.hash(password.toString(), 10);

    await supabaseAdmin.from('users').upsert({
      id: authId,
      email,
      role: 'viewer',
      approved: false,
      active: true,
      full_name: fullName || email,
      department: dept,
      contact: contactInfo,
      purpose: userPurpose,
      password_hash: passwordHash,
    });

    await supabaseAdmin.from('user_profiles').upsert({
      user_id: authId,
      username: normalizedUsername,
      approved: false,
      role: 'viewer',
      requested_at: new Date().toISOString(),
      approved_at: null,
      approved_by: null,
    });

    return NextResponse.json({ ok: true, pending: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || '계정 생성 실패' }, { status: 400 });
  }
}
