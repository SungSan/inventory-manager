import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/session';

export async function GET() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ authenticated: false });
  }

  return NextResponse.json({
    authenticated: true,
    userId: session.userId,
    email: session.email ?? null,
    role: session.role ?? null,
    expiresAt: session.expiresAt ?? null
  });
}
