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
  const { username, name, department, contact, purpose, password, access_token } = await req.json();
  const normalizedUsername = normalizeUsername((username ?? '').toString());
  const fullName = (name ?? '').toString().trim();
  const dept = (department ?? '').toString().trim();
  const contactInfo = (contact ?? '').toString().trim();
  const userPurpose = (purpose ?? '').toString().trim();

  if (!access_token) {
    return NextResponse.json({ error: 'OTP 인증 후 다시 시도하세요.' }, { status: 400 });
  }

  if (!fullName || !dept) {
    return NextResponse.json({ error: '성함과 부서를 입력하세요.' }, { status: 400 });
  }

  if (!password || password.toString().length < 8) {
    return NextResponse.json({ error: '비밀번호를 8자 이상 입력하세요.' }, { status: 400 });
  }

  const email = `${normalizedUsername}@${CORPORATE_DOMAIN}`;

  try {
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(access_token);
    if (authError || !authData?.user) {
      throw new Error(authError?.message || 'OTP 인증 정보를 확인할 수 없습니다.');
    }

    if (!authData.user.email || authData.user.email.toLowerCase() !== email.toLowerCase()) {
      throw new Error('ID와 이메일이 일치하지 않습니다.');
    }

    const authId = authData.user.id;

    const passwordHash = await bcrypt.hash(password.toString(), 10);

    await supabaseAdmin.from('users').upsert({
      id: authId,
      email,
      role: 'pending',
      active: false,
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
      role: 'pending',
      requested_at: new Date().toISOString(),
      approved_at: null,
      approved_by: null,
    });

    return NextResponse.json({ ok: true, pending: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || '계정 생성 실패' }, { status: 400 });
  }
}
