import { NextRequest, NextResponse } from 'next/server';
import { verifyLogin, setSession } from '../../../../lib/auth';

export async function POST(req: NextRequest) {
  const { identifier, email, password } = await req.json();
  const loginId = (identifier ?? email ?? '').toString().trim();
  if (!loginId || !password) return NextResponse.json({ error: 'missing' }, { status: 400 });
  const user = await verifyLogin(loginId, password);
  if (!user) return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });
  return setSession(req, user);
}
