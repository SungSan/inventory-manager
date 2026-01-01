import { NextResponse } from 'next/server';
import { verifyLogin, setSession } from '../../../../lib/auth';

export async function POST(req: Request) {
  const { email, password } = await req.json();
  if (!email || !password) return NextResponse.json({ error: 'missing' }, { status: 400 });
  const user = await verifyLogin(email, password);
  if (!user) return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });
  await setSession(user);
  return NextResponse.json({ ok: true, role: user.role });
}
