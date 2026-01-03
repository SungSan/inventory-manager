import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { normalizeUsername, deriveEmail } from '../../../../lib/auth';

export async function POST(req: Request) {
  const { username, password } = await req.json();

  try {
    const normalized = normalizeUsername((username ?? '').toString());
    const email = deriveEmail(normalized);

    if (!password || password.toString().length < 8) {
      throw new Error('비밀번호를 8자 이상 입력하세요.');
    }

    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'signup',
      email,
      password: password.toString(),
    });

    if (error || !data) {
      throw new Error(error?.message || 'OTP 생성에 실패했습니다.');
    }

    // Also trigger the managed email to ensure users receive the code in their inbox.
    await supabaseAdmin.auth.resend({ type: 'signup', email });

    return NextResponse.json({ ok: true, otp: data.properties?.email_otp ?? null });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'OTP 생성 실패' }, { status: 400 });
  }
}
