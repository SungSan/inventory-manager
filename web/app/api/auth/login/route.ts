import { NextRequest, NextResponse } from 'next/server';
import { loginWithUsername, setSession } from '../../../../lib/auth';

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();
  if (!username || !password) {
    return NextResponse.json({ error: 'ID와 비밀번호를 입력하세요.' }, { status: 400 });
  }

  try {
    const user = await loginWithUsername(username, password);

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
