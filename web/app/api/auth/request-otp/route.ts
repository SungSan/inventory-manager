import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { deriveEmail, normalizeUsername } from '../../../../lib/auth';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');

function methodNotAllowed() {
  return NextResponse.json({ ok: false, error: 'Method Not Allowed' }, { status: 405 });
}

export async function GET() {
  return methodNotAllowed();
}

export async function PUT() {
  return methodNotAllowed();
}

export async function PATCH() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}

export async function POST(req: NextRequest) {
  try {
    if (!SITE_URL) {
      return NextResponse.json(
        { ok: false, error: 'NEXT_PUBLIC_SITE_URL이 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const rawId =
      (body as any).id ??
      (body as any).username ??
      (body as any).emailLocalPart ??
      (body as any).user ??
      '';

    if (!rawId || typeof rawId !== 'string') {
      return NextResponse.json({ ok: false, error: 'ID를 입력하세요.' }, { status: 400 });
    }

    let username: string;
    try {
      username = normalizeUsername(rawId);
    } catch (err: any) {
      return NextResponse.json({ ok: false, error: err?.message || '유효하지 않은 ID입니다.' }, { status: 400 });
    }

    const email = deriveEmail(username);
    const emailRedirectTo = `${SITE_URL}/auth/callback`;

    const { data, error } = await supabaseAdmin.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo,
      },
    });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    const otp = (data as any)?.properties?.email_otp;
    return NextResponse.json({ ok: true, message: 'OTP 전송 완료. 이메일을 확인하세요.', otp });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'OTP 요청 실패' }, { status: 500 });
  }
}
