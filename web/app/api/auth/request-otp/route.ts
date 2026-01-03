import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { deriveEmail, normalizeUsername } from '../../../../lib/auth';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const rawId = (body as any).id ?? (body as any).username;
    if (!rawId || typeof rawId !== 'string') {
      return NextResponse.json({ ok: false, message: 'ID를 입력하세요.' }, { status: 400 });
    }

    const normalized = normalizeUsername(rawId);
    const email = deriveEmail(normalized);

    const { data, error } = await supabaseAdmin.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
      },
    });

    if (error) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 400 });
    }

    const otp = (data as any)?.properties?.email_otp;
    return NextResponse.json({ ok: true, message: 'OTP 전송 완료. 이메일을 확인하세요.', otp });
  } catch (err: any) {
    return NextResponse.json({ ok: false, message: err?.message || 'OTP 요청 실패' }, { status: 500 });
  }
}
