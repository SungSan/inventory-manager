import { NextRequest, NextResponse } from 'next/server';
import { verifyLogin, setSession } from '../../../../lib/auth';
import { supabaseAdmin } from '../../../../lib/supabase';

export async function POST(req: NextRequest) {
  const { identifier, email, password } = await req.json();
  const loginId = (identifier ?? email ?? '').toString().trim();
  if (!loginId || !password) return NextResponse.json({ error: 'missing' }, { status: 400 });
  const user = await verifyLogin(loginId, password);
  if (!user) {
    const { data: existing, error } = await supabaseAdmin
      .from('users')
      .select('active')
      .eq('email', loginId.toLowerCase())
      .limit(1);

    if (!error && existing && existing.length > 0 && existing[0].active === false) {
      return NextResponse.json({ error: '관리자 승인 후 사용 가능합니다. 권한 요청을 위해 관리자에게 문의하세요.' }, { status: 403 });
    }

    return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });
  }
  return setSession(req, user);
}
