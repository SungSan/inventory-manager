import { NextRequest, NextResponse } from 'next/server';
import { loginWithUsername, setSession } from '../../../../lib/auth';

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();
  if (!username || !password) {
    return NextResponse.json({ error: 'ID와 비밀번호를 입력하세요.' }, { status: 400 });
  }

  try {
    const user = await loginWithUsername(username, password);

    return setSession(req, user as any);
  } catch (err: any) {
    const message = err?.message || '로그인 실패';
    const status = err?.code === 'PENDING_APPROVAL' ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
