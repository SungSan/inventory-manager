import { NextResponse } from 'next/server';
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

    const { error: userError } = await supabaseAdmin.from('users').upsert({
      id: authId,
      email,
      role: 'viewer',
      approved: false,
      active: false,
    });

    if (userError) {
      return NextResponse.json(
        { ok: false, step: 'upsert_users', error: userError.message },
        { status: 500 }
      );
    }

    const { error: profileError } = await supabaseAdmin.from('user_profiles').upsert({
      user_id: authId,
      username: normalizedUsername,
      approved: false,
      role: 'viewer',
      full_name: fullName,
      department: dept,
      contact: contactInfo,
      purpose: userPurpose,
      requested_at: new Date().toISOString(),
      approved_at: null,
      approved_by: null,
    });

    if (profileError) {
      return NextResponse.json(
        { ok: false, step: 'upsert_user_profiles', error: profileError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, pending: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, step: 'register', error: err?.message || '계정 생성 실패' }, { status: 400 });
  }
}
