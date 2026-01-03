import { NextRequest, NextResponse } from 'next/server';
import { loginWithAccessToken, setSession } from '../../../../lib/auth';

export async function POST(req: NextRequest) {
  const { access_token, username } = await req.json();
  if (!access_token || !username) {
    return NextResponse.json({ error: '인증 정보가 부족합니다.' }, { status: 400 });
  }

  try {
    const user = await loginWithAccessToken(access_token, username);

    if ('pending' in user && (user as any).pending) {
      return NextResponse.json(
        { error: '관리자 승인 대기 중입니다. 관리자에게 승인 요청하세요.' },
        { status: 403 }
      );
    }

    return setSession(req, user as any);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || '로그인 실패' }, { status: 400 });
  }
}
